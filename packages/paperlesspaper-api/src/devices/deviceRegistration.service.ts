import {
  ApiError,
  Device,
  iotDevicesService,
  usersService,
} from "@internetderdinge/api";
import { deviceByDeviceName } from "@paperlesspaper/helpers";
import httpStatus from "http-status";
import Paper from "../papers/papers.model.js";
import { resetDeviceImageCache } from "../iotdevice/deviceImageCache.js";

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

async function activateDevice(
  ...args: Parameters<typeof iotDevicesService.activateDevice>
) {
  try {
    return await iotDevicesService.activateDevice(...args);
  } catch {
    // The shared IoT client labels transport failures as 404. This is an
    // upstream verification failure, not proof that the frame is unknown.
    throw new ApiError(
      httpStatus.BAD_GATEWAY,
      "Could not verify device activation"
    );
  }
}

async function readStatus(deviceId: string, organization: string) {
  const status = await activateDevice(
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
  const previous = await Device.findOne({ deviceId });
  if (belongsTo(previous, body.organization)) return previous;

  const replacement = new Device({
    deviceId,
    organization: body.organization,
    kind: deviceByDeviceName(deviceId)?.id,
    patient: body.patient || undefined,
    paper: body.paper || undefined,
  });
  await replacement.validate();

  // Clear before saving so a failed deletion is retried by the next completion.
  // Also covers an orphan or a retry after the old assignment was removed.
  await resetDeviceImageCache(deviceId);
  if (previous) {
    await detachAssignment(previous);
  }
  try {
    await replacement.save();
  } catch (error) {
    // Concurrent completion for the same verified owner can hit the serial's
    // unique index. Return that assignment; never accept a different owner.
    if (error?.code === 11000) {
      const concurrent = await Device.findOne({ deviceId });
      if (belongsTo(concurrent, body.organization)) return concurrent;
    }
    throw error;
  }
  return replacement;
}

async function detachAssignment(previous: any) {
  // Deliberately sequential for standalone MongoDB. A partial failure is
  // surfaced to the caller; papers are preserved even if a later write fails.
  await Paper.updateMany(
    { deviceId: previous._id },
    { $unset: { deviceId: 1 } }
  );
  await Device.deleteOne({
    _id: previous._id,
    organization: previous.organization,
  });
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
  // Fresh organization-specific proof is enough to finish (or retry) storage.
  // In particular, a lost response / failed save must not reset an owned orphan.
  if (body.enable && !isConfirmed(status)) {
    const existing = await Device.findOne({ deviceId });
    if (!existing && status.activation_status === "success") {
      // Repair a confirmed orphan only when explicitly starting a new attempt,
      // never while polling or merely inspecting availability.
      const reset = await activateDevice(
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
      await detachAssignment(existing);
    }
    status = await activateDevice(
      deviceId,
      body.organization,
      true
    );
  }

  if (!status || status.success === false || !status.activation_status) {
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

  // Completion is not atomic. If a write fails, polling can retry with fresh
  // IoT proof; already detached paper links are not restored.
  const createdDevice = await completeRegistration(deviceId, body);
  return {
    ...publicStatus(status),
    registrationCompleted: true,
    createdDevice,
  };
}
