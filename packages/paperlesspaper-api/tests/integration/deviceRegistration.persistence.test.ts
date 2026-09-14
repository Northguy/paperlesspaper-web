import mongoose from "mongoose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const iot = vi.hoisted(() => ({ activateDevice: vi.fn() }));
vi.mock("@internetderdinge/api", async () => {
  const { default: RealDevice } = await import(
    "@internetderdinge/api/src/devices/devices.model.ts"
  );
  return {
    ApiError: class extends Error {
      constructor(public statusCode: number, message: string) {
        super(message);
      }
    },
    Device: RealDevice,
    iotDevicesService: iot,
    usersService: { getById: vi.fn(async () => null) },
    paginate: () => {},
    toJSON: () => {},
  };
});

import { Device } from "@internetderdinge/api";
import Paper from "../../src/papers/papers.model.js";
import {
  getRegistrationStatus,
  registerDevice,
} from "../../src/devices/deviceRegistration.service.js";

const url = process.env.REGISTRATION_TEST_MONGODB_URL;
describe.skipIf(!url)("device registration MongoDB persistence", () => {
  const deviceId = "epd7-registration-test";
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  const body = { organization: String(orgB), enable: false };
  const confirmed = {
    success: true,
    activation_status: "success",
    key: "SECRET",
  };
  let previous: any;
  let paper: any;

  beforeAll(async () => {
    if (!new URL(url!).pathname.startsWith("/paperless-registration-test-")) {
      throw new Error(
        "Use a disposable database named paperless-registration-test-*"
      );
    }
    await mongoose.connect(url!);
    await Device.init();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    iot.activateDevice.mockReset();
    await Device.deleteMany({});
    await Paper.deleteMany({});
    previous = await Device.create({
      deviceId,
      organization: orgA,
      kind: "epd7",
      meta: { secret: "old-content" },
      payment: { customer: "old-customer" },
    });
    paper = await Paper.create({
      organization: orgA,
      deviceId: previous._id,
      name: "Keep this paper",
    });
  });

  it("allows checking a foreign device without resetting or exposing its owner", async () => {
    iot.activateDevice.mockResolvedValue({
      activation_status: "success",
      success: true,
    });
    expect(await getRegistrationStatus(deviceId, String(orgB))).toEqual({
      available: true,
      mode: "takeover",
    });
    expect(iot.activateDevice).toHaveBeenCalledExactlyOnceWith(
      deviceId,
      String(orgB),
      false
    );
    expect((await Device.findOne({ deviceId }))?.organization).toEqual(orgA);
  });

  it("starts a takeover without resetting or removing the existing assignment", async () => {
    iot.activateDevice
      .mockResolvedValueOnce({ activation_status: "success" })
      .mockResolvedValueOnce({ activation_status: "pending" });
    expect(
      await registerDevice(deviceId, { ...body, enable: true })
    ).toMatchObject({
      activation_status: "pending",
      registrationCompleted: false,
    });
    expect(iot.activateDevice.mock.calls).toEqual([
      [deviceId, String(orgB), false],
      [deviceId, String(orgB), true],
    ]);
    expect((await Paper.findById(paper._id))?.deviceId).toEqual(previous._id);
    expect((await Device.findOne({ deviceId }))?.organization).toEqual(orgA);
  });

  it.each(["pending", "timeout", "success", "reset"])(
    "preserves ownership and papers for unconfirmed %s",
    async (activation_status) => {
      iot.activateDevice.mockResolvedValue({
        activation_status,
        success: true,
      });
      const result = await registerDevice(deviceId, body);
      expect(result.registrationCompleted).toBe(false);
      expect(result.activation_status).toBe(
        activation_status === "success" ? "timeout" : activation_status
      );
      expect((await Device.findOne({ deviceId }))?.organization).toEqual(orgA);
      expect((await Paper.findById(paper._id))?.deviceId).toEqual(previous._id);
    }
  );

  it("transfers confirmed ownership, detaches papers without deleting them, and removes old settings", async () => {
    iot.activateDevice.mockResolvedValue(confirmed);
    const result = await registerDevice(deviceId, body);
    expect(result.registrationCompleted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    const device = await Device.findOne({ deviceId });
    expect(device?._id).not.toEqual(previous._id);
    expect(await Device.findById(previous._id)).toBeNull();
    expect(device?.organization).toEqual(orgB);
    expect(device?.meta).toBeUndefined();
    expect(device?.payment).toBeUndefined();
    expect(await Paper.countDocuments({ _id: paper._id })).toBe(1);
    expect((await Paper.findById(paper._id))?.deviceId).toBeUndefined();
    expect((await Paper.findById(paper._id))?.organization).toEqual(orgA);
    expect(iot.activateDevice).toHaveBeenCalledExactlyOnceWith(
      deviceId,
      String(orgB),
      false
    );
  });

  it("keeps repeated successful completion idempotent and preserves the new owner's papers", async () => {
    iot.activateDevice.mockResolvedValue(confirmed);
    const first = await registerDevice(deviceId, body);
    const newPaper = await Paper.create({
      organization: orgB,
      deviceId: first.createdDevice._id,
    });
    const second = await registerDevice(deviceId, body);
    expect(second.createdDevice._id).toEqual(first.createdDevice._id);
    expect(await Device.countDocuments({ deviceId })).toBe(1);
    expect((await Paper.findById(newPaper._id))?.deviceId).toEqual(
      first.createdDevice._id
    );
  });

  it("rolls back paper detachment if ownership persistence fails, and can retry completion", async () => {
    iot.activateDevice.mockResolvedValue(confirmed);
    vi.spyOn(Device.collection, "insertOne").mockRejectedValueOnce(
      new Error("storage failure")
    );
    await expect(registerDevice(deviceId, body)).rejects.toThrow(
      "storage failure"
    );
    expect((await Device.findOne({ deviceId }))?.organization).toEqual(orgA);
    expect((await Paper.findById(paper._id))?.deviceId).toEqual(previous._id);
    expect((await registerDevice(deviceId, body)).registrationCompleted).toBe(
      true
    );
    expect(
      iot.activateDevice.mock.calls.every(
        (call) => call[2] === false && call[3] !== true
      )
    ).toBe(true);
  });

  it("resets an active orphan only when starting, then activates it", async () => {
    await Device.deleteMany({});
    iot.activateDevice
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce({ activation_status: "reset" })
      .mockResolvedValueOnce({ activation_status: "pending" });
    await registerDevice(deviceId, { ...body, enable: true });
    expect(iot.activateDevice.mock.calls).toEqual([
      [deviceId, String(orgB), false],
      [deviceId, String(orgB), false, true],
      [deviceId, String(orgB), true],
    ]);
    expect(await Device.countDocuments({})).toBe(0);
  });

  it("creates a new device only after proof and never resets while polling", async () => {
    await Device.deleteMany({});
    iot.activateDevice.mockResolvedValue(confirmed);
    const result = await registerDevice(deviceId, body);
    expect(result.createdDevice.organization).toEqual(orgB);
    expect(iot.activateDevice).toHaveBeenCalledExactlyOnceWith(
      deviceId,
      String(orgB),
      false
    );
  });

  it("cleans a stale inactive assignment without deleting its papers or resetting IoT", async () => {
    iot.activateDevice
      .mockResolvedValueOnce({ activation_status: "reset" })
      .mockResolvedValueOnce({ activation_status: "pending" });
    await registerDevice(deviceId, { ...body, enable: true });
    expect(await Device.countDocuments({ deviceId })).toBe(0);
    expect(await Paper.countDocuments({ _id: paper._id })).toBe(1);
    expect((await Paper.findById(paper._id))?.deviceId).toBeUndefined();
    expect(iot.activateDevice.mock.calls).toEqual([
      [deviceId, String(orgB), false],
      [deviceId, String(orgB), true],
    ]);
  });

  it("keeps an already registered device in the same organization intact", async () => {
    iot.activateDevice.mockResolvedValue(confirmed);
    expect(await getRegistrationStatus(deviceId, String(orgA))).toMatchObject({
      mode: "already_registered",
    });
    const result = await registerDevice(deviceId, {
      organization: String(orgA),
      enable: true,
    });
    expect(result.createdDevice._id).toEqual(previous._id);
    expect(result.createdDevice.meta).toEqual({ secret: "old-content" });
    expect((await Paper.findById(paper._id))?.deviceId).toEqual(previous._id);
    expect(
      iot.activateDevice.mock.calls.every((call) => call[3] !== true)
    ).toBe(true);
  });

  it("rejects invalid target references before calling IoT", async () => {
    await expect(
      registerDevice(deviceId, {
        ...body,
        patient: String(new mongoose.Types.ObjectId()),
      })
    ).rejects.toThrow("Patient is not part");
    expect(iot.activateDevice).not.toHaveBeenCalled();
  });
});
