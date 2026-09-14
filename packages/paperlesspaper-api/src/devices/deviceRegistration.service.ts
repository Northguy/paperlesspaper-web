import {
  ApiError,
  Device,
  iotDevicesService,
  usersService,
} from "@internetderdinge/api";
import { deviceByDeviceName } from "@paperlesspaper/helpers";
import mongoose from "mongoose";
import httpStatus from "http-status";
import Paper from "../papers/papers.model.js";

type RegistrationInput = {
  organization: string;
  enable: boolean;
  patient?: string | null;
  paper?: string | null;
};

const belongsTo = (device: any, organization: string) =>
  device && String(device.organization) === organization;

const isConfirmed = (status: any) =>
  status?.success !== false &&
  status?.activation_status === "success" &&
  typeof status.key === "string" &&
  status.key.trim().length > 0;

// Never expose the activation secret (or arbitrary upstream fields) to clients.
const publicStatus = (status: any) => ({
  activation_status: status.activation_status,
  type: status.type,
  lastReachableAgo: status.lastReachableAgo,
  registrationCompleted: false,
});

async function readStatus(deviceId: string, organization: string) {
  const status = await iotDevicesService.activateDevice(
    deviceId,
    organization,
    false
  );
  if (!status || status.success === false || !status.activation_status) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Could not verify device activation"
    );
  }
  return status;
}

export async function getRegistrationStatus(
  deviceId: string,
  organization: string
) {
  // Global lookup: a device assigned to another organization is not an orphan.
  const device = await Device.findOne({ deviceId });
  const status = await readStatus(deviceId, organization);
  return {
    available: true,
    mode:
      belongsTo(device, organization) && isConfirmed(status)
        ? "already_registered"
        : device && !belongsTo(device, organization)
        ? "takeover"
        : "activation",
  };
}

async function completeRegistration(deviceId: string, body: RegistrationInput) {
  const session = await mongoose.startSession();
  let createdDevice: any;
  try {
    await session.withTransaction(async () => {
      const previous = await Device.findOne({ deviceId }).session(session);
      if (belongsTo(previous, body.organization)) {
        createdDevice = previous;
        return;
      }

      const replacement = new Device({
        deviceId,
        organization: body.organization,
        kind: deviceByDeviceName(deviceId)?.id,
        patient: body.patient || undefined,
        paper: body.paper || undefined,
      });
      await replacement.validate();

      if (previous) {
        // A new database id keeps old upload logs, image paths and outstanding
        // deactivation receipts attached to the old assignment, not the new owner.
        await Paper.updateMany(
          { deviceId: previous._id },
          { $unset: { deviceId: 1 } },
          { session }
        );
        await Device.deleteOne(
          { _id: previous._id, organization: previous.organization },
          { session }
        );
      }
      await replacement.save({ session });
      createdDevice = replacement;
    });
  } finally {
    await session.endSession();
  }
  return createdDevice;
}

export async function registerDevice(
  deviceId: string,
  body: RegistrationInput
) {
  // Validate all target references before starting a physical ownership change.
  if (body.patient) {
    const patient = await usersService.getById(body.patient);
    if (!belongsTo(patient, body.organization)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Patient is not part of the organization"
      );
    }
  }
  if (body.paper) {
    const paper = await Paper.findById(body.paper);
    if (!belongsTo(paper, body.organization)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Paper is not part of the organization"
      );
    }
  }

  let status = await readStatus(deviceId, body.organization);
  if (body.enable) {
    const existing = await Device.findOne({ deviceId });
    if (!existing && status.activation_status === "success") {
      // Repair a confirmed orphan only when explicitly starting a new attempt,
      // never while polling or merely inspecting availability.
      const reset = await iotDevicesService.activateDevice(
        deviceId,
        body.organization,
        false,
        true
      );
      if (reset?.activation_status !== "reset" || reset.success === false) {
        throw new ApiError(
          httpStatus.BAD_GATEWAY,
          "Could not reset unassigned device"
        );
      }
    }
    if (
      existing &&
      ["reset", "timeout", "unclaimed"].includes(status.activation_status)
    ) {
      // A definitively inactive IoT device can have a stale local assignment.
      // Pending, a missing key, or an upstream failure must never enter this path.
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Paper.updateMany(
            { deviceId: existing._id },
            { $unset: { deviceId: 1 } },
            { session }
          );
          await Device.deleteOne(
            { _id: existing._id, organization: existing.organization },
            { session }
          );
        });
      } finally {
        await session.endSession();
      }
    }
    status = await iotDevicesService.activateDevice(
      deviceId,
      body.organization,
      true
    );
  }

  if (!status || status.success === false) {
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Could not verify device activation"
    );
  }
  if (!isConfirmed(status)) {
    return {
      ...publicStatus(status),
      // IoT's global success is NOT a successful registration for this caller.
      activation_status:
        status.activation_status === "success"
          ? "timeout"
          : status.activation_status,
    };
  }

  // The IoT ownership change cannot share our Mongo transaction. If Mongo fails,
  // polling can safely retry completion using fresh proof for the target org.
  const createdDevice = await completeRegistration(deviceId, body);
  return {
    ...publicStatus(status),
    registrationCompleted: true,
    createdDevice,
  };
}
