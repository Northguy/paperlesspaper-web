import fs from "node:fs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { expect, it, vi } from "vitest";

// Manual opt-in only. Local Mongo writes, real IoT calls for one authorized frame.
const hardware = vi.hoisted(() => ({
  serial: "epd7-e4b0634f3354",
  sourceOrganization: "63821843d6eeb3a3555836ee",
  organization: "6a5ca57c781f5d50017b9cc2",
  token: "",
  env: {} as Record<string, string>,
  calls: [] as Array<{ enable: boolean; reset: boolean; status: string; keyPresent: boolean }>,
}));
vi.mock("@internetderdinge/api", async () => {
  const { default: Device } = await import("@internetderdinge/api/src/devices/devices.model.ts");
  return {
    Device,
    ApiError: class extends Error { constructor(public statusCode: number, message: string) { super(message); } },
    usersService: { getById: async () => { throw new Error("User lookup is outside this hardware test"); } },
    paginate: () => {}, toJSON: () => {},
    iotDevicesService: {
      activateDevice: async (deviceName: string, organizationName: string, enable = true, reset = false) => {
        const ownershipRead = process.env.HARDWARE_STAGE === "ownership" && !enable && organizationName === hardware.sourceOrganization;
        if (deviceName !== hardware.serial || (organizationName !== hardware.organization && !ownershipRead) || reset) {
          throw new Error("Hardware test only permits this frame and organization, without API reset");
        }
        if (enable && process.env.HARDWARE_STAGE !== "start" && process.env.HARDWARE_STAGE !== "repeat") {
          throw new Error("Activation requires the explicit start/repeat stage");
        }
        const response = await fetch(new URL("activatedevice", hardware.env.IOT_API_URL_EPAPER), {
          method: "POST",
          headers: { Authorization: `Bearer ${hardware.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ deviceName, organizationName, enable, reset }),
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`IoT request failed: HTTP ${response.status}`);
        const result = await response.json();
        const summary = { organization:organizationName, enable, reset, status: result.activation_status, keyPresent: typeof result.key === "string" && result.key.length > 0 };
        hardware.calls.push(summary);
        console.log("IOT_STATE", JSON.stringify(summary));
        return result;
      },
    },
  };
});

import { Device, iotDevicesService } from "@internetderdinge/api";
import Paper from "../../src/papers/papers.model.js";
import { getRegistrationStatus, registerDevice } from "../../src/devices/deviceRegistration.service.js";

it.skipIf(process.env.HARDWARE_DEVICE_ID !== hardware.serial)("runs one explicitly selected hardware activation stage", async () => {
  const stage = process.env.HARDWARE_STAGE;
  if (!["inspect", "start", "poll", "repeat", "ownership"].includes(stage!)) throw new Error("Unknown hardware stage");
  const localUrl = process.env.HARDWARE_LOCAL_MONGODB_URL!;
  const parsed = new URL(localUrl);
  if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.startsWith("/paperless-hardware-test-")) {
    throw new Error("Hardware test writes require an isolated localhost database");
  }
  hardware.env = dotenv.parse(fs.readFileSync("packages/paperlesspaper-api/.env.production"));
  const source = new mongoose.mongo.MongoClient(hardware.env.MONGODB_URL, { serverSelectionTimeoutMS:10000 });
  try {
    await source.connect();
    const sourceDb = source.db();
    const original = await sourceDb.collection("devices").findOne({ deviceId: hardware.serial }, {
      projection: { _id:1, deviceId:1, organization:1, kind:1, paper:1, "meta.name":1 },
    });
    if (!original || String(original.organization) !== hardware.sourceOrganization) throw new Error("Source assignment changed; re-inspect before testing");
    const target = await sourceDb.collection("organizations").findOne({ _id:new mongoose.mongo.ObjectId(hardware.organization) }, { projection:{ _id:1, name:1 } });
    if (!target) throw new Error("Target organization does not exist");
    console.log("TARGET_ORGANIZATION", JSON.stringify({ id:String(target._id), name:target.name }));
    const sourcePapers = await sourceDb.collection("papers").find({ deviceId: original._id }).project({ _id:1, deviceId:1, organization:1 }).toArray();
    await mongoose.connect(localUrl, { serverSelectionTimeoutMS:10000 });
    await Device.init();
    if (stage === "inspect" && await Device.countDocuments({}) === 0) {
      await Device.collection.insertOne(original);
      if (sourcePapers.length) await Paper.collection.insertMany(sourcePapers);
    }

    const e = hardware.env;
    const auth = await fetch(`https://${e.AUTH0_MANAGEMENT_DOMAIN}/oauth/token`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ grant_type:"client_credentials", client_id:e.AUTH0_MANAGEMENT_CLIENT_ID,
        client_secret:e.AUTH0_MANAGEMENT_CLIENT_SECRET, audience:e.AUTH0_AUDIENCE||e.AUTH0_MANAGEMENT_AUDIENCE||"localhost:3000/" }),
      signal:AbortSignal.timeout(15000),
    });
    if (!auth.ok) throw new Error(`Authentication failed: HTTP ${auth.status}`);
    hardware.token = (await auth.json()).access_token;
    if (!hardware.token) throw new Error("No authentication token returned");

    const before = await Device.findOne({ deviceId:hardware.serial });
    let result = stage === "inspect"
      ? await getRegistrationStatus(hardware.serial, hardware.organization)
      : await registerDevice(hardware.serial, { organization:hardware.organization, enable: stage === "start" || stage === "repeat" });
    const pollUntil = Date.now() + Math.min(40000, Math.max(0, Number(process.env.HARDWARE_POLL_MS) || 0));
    while (stage === "poll" && result.activation_status === "pending" && Date.now() < pollUntil) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      result = await registerDevice(hardware.serial, { organization:hardware.organization, enable:false });
    }
    console.log("LOCAL_RESULT", JSON.stringify({
      stage, result,
      localDevices:await Device.countDocuments({ deviceId:hardware.serial }),
      localPapers:await Paper.countDocuments({}),
      linkedLocalPapers:await Paper.countDocuments({ deviceId:{ $exists:true } }),
    }));
    expect(JSON.stringify(result)).not.toMatch(/"key"\s*:/);
    if (stage === "ownership") {
      expect(result.registrationCompleted).toBe(true);
      const previousOwner = await iotDevicesService.activateDevice(hardware.serial, hardware.sourceOrganization, false, false);
      expect(typeof previousOwner.key === "string" && previousOwner.key.length > 0).toBe(false);
      expect(await Device.countDocuments({ deviceId:hardware.serial })).toBe(1);
      expect(String((await Device.findOne({ deviceId:hardware.serial }))?.organization)).toBe(hardware.organization);
    }
    if (stage === "repeat") {
      expect(result.registrationCompleted).toBe(true);
      expect(String(result.createdDevice?._id)).toBe(String(before?._id));
    }

    // Verify that the live database assignment and all its references stayed intact.
    const current = await sourceDb.collection("devices").findOne({ _id:original._id });
    expect(String(current?.organization)).toBe(hardware.sourceOrganization);
    const remainingPapers = await sourceDb.collection("papers").find({ deviceId:original._id }).project({ _id:1 }).toArray();
    expect(remainingPapers.map(p=>String(p._id)).sort()).toEqual(sourcePapers.map(p=>String(p._id)).sort());
    console.log("PRODUCTION_PRESERVED", JSON.stringify({ deviceId:String(original._id), linkedPapers:remainingPapers.length }));
  } finally {
    hardware.token = "";
    await mongoose.disconnect();
    await source.close();
  }
}, 60000);
