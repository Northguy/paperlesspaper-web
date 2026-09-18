import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  specs: [] as any[],
  authenticate: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@internetderdinge/api", async () => {
  const { Router } = await import("express");
  const { z } = await import("zod");
  const { extendZodWithOpenApi } =
    await import("@asteasolutions/zod-to-openapi");
  extendZodWithOpenApi(z);
  state.auth.mockReturnValue(state.authenticate);
  return {
    ApiError: class extends Error {
      constructor(
        public statusCode: number,
        message: string,
      ) {
        super(message);
      }
    },
    auth: state.auth,
    validateDevice: vi.fn(),
    zObjectIdFor: () => z.string().regex(/^[a-f0-9]{24}$/i),
    uploadSingleImageFromWebsiteSchema: {},
    buildRouterAndDocs: (_router: unknown, specs: any[]) => {
      state.specs = specs;
    },
    catchAsync: (handler: unknown) => handler,
    createDevicesRoute: () => Router(),
  };
});
vi.mock("../../src/devices/deviceRegistration.service.js", () => ({
  registerDevice: vi.fn(),
  getRegistrationStatus: vi.fn(),
}));
vi.mock("../../src/devices/devices.controller", () => ({ default: {} }));

import "../../src/devices/devices.route";
import { validateAdminOrSupport } from "../../src/middlewares/validateAdminOrSupport.js";
import { deleteDeviceByDeviceIdSchema } from "../../src/devices/devices.validation.js";

const claim = "https://memo.wirewire.de/roles";

describe("device deactivation route authorization", () => {
  it("authenticates requests and restricts deactivation to admin or support", () => {
    const route = state.specs.find(
      (spec) =>
        spec.method === "delete" && spec.path === "/by-device-id/:deviceId",
    );
    expect(route.validate).toEqual([
      state.authenticate,
      validateAdminOrSupport,
    ]);
    expect(state.auth).toHaveBeenCalledWith();
    expect(route.requestSchema).toBe(deleteDeviceByDeviceIdSchema);
  });

  it.each([["admin"], ["support"], ["user", "support"]])(
    "allows role claim %j for preview and execution",
    (...roles) => {
      for (const dryRun of ["true", "false"]) {
        const next = vi.fn();
        validateAdminOrSupport(
          { auth: { [claim]: roles }, query: { dryRun } } as any,
          {} as any,
          next,
        );
        expect(next).toHaveBeenCalledExactlyOnceWith();
      }
    },
  );

  it.each([
    undefined,
    {},
    { [claim]: [] },
    { [claim]: ["user"] },
    { [claim]: "support" },
    { roles: ["support"] },
  ])("rejects missing, ordinary or malformed role claims: %j", (auth) => {
    const next = vi.fn();
    validateAdminOrSupport({ auth } as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("accepts the historical id in the strict query schema for preview and execution", () => {
    for (const dryRun of ["true", "false"]) {
      const query = {
        dryRun,
        previousDeviceObjectId: "507f1f77bcf86cd799439011",
        confirmationToken: "a".repeat(64),
      };
      expect(deleteDeviceByDeviceIdSchema.query.strict().parse(query)).toEqual(
        query,
      );
    }
    expect(
      deleteDeviceByDeviceIdSchema.query.safeParse({
        previousDeviceObjectId: "invalid",
      }).success,
    ).toBe(false);
  });
});
