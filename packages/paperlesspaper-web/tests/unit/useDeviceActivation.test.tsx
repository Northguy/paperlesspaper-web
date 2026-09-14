// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeviceActivation } from "../../src/helpers/devices/useDeviceActivation";

const values = {
  id: "epd7-test",
  body: { organization: "org-b", enable: true },
};
const pending = { activation_status: "pending" };
const success = {
  activation_status: "success",
  registrationCompleted: true,
  createdDevice: { id: "db-id" },
};
const api = (...responses: any[]) =>
  vi.fn(() => ({
    unwrap: () =>
      Promise.resolve(responses.length > 1 ? responses.shift() : responses[0]),
  }));
function renderHook(callback: (props?: any) => any, options?: any) {
  const element = document.createElement("div");
  const root = createRoot(element);
  const result = { current: undefined as any };
  function Harness({ props }: any) {
    result.current = callback(props);
    return null;
  }
  const rerender = (props: any) =>
    act(() => {
      root.render(<Harness props={props} />);
    });
  rerender(options?.initialProps);
  return { result, rerender, unmount: () => act(() => root.unmount()) };
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("continues polling unchanged pending responses with the target organization", async () => {
  const register = api(pending, pending, pending, success);
  const hook = renderHook(() => useDeviceActivation(register, "org-b"));
  await act(async () => {
    await hook.result.current.start(values);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12000);
  });
  expect(register).toHaveBeenCalledTimes(4);
  expect(
    register.mock.calls
      .slice(1)
      .every(
        ([request]: any) =>
          request.body.enable === false && request.body.organization === "org-b"
      )
  ).toBe(true);
  expect(hook.result.current.response.data).toEqual(success);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(register).toHaveBeenCalledTimes(4);
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not poll or restart activation between starting and writing WLAN credentials", async () => {
  const register = api(pending, success);
  const hook = renderHook(() => useDeviceActivation(register, "org-b"));
  await act(async () => {
    await hook.result.current.start(values, true);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(register).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.resume());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(register.mock.calls[1][0].body.enable).toBe(false);
  hook.unmount();
});

it("rejects raw success without server-verified registration", async () => {
  const hook = renderHook(() =>
    useDeviceActivation(api({ activation_status: "success" }), "org-b")
  );
  await act(async () => {
    await hook.result.current.start(values);
  });
  expect(hook.result.current.response.data.activation_status).toBe("error");
  hook.unmount();
});

it("ignores a late response after cancellation", async () => {
  let resolve: (value: any) => void;
  const register = vi.fn(() => ({
    unwrap: () =>
      new Promise((r) => {
        resolve = r;
      }),
  }));
  const hook = renderHook(() => useDeviceActivation(register, "org-b"));
  let start: Promise<any>;
  act(() => {
    start = hook.result.current.start(values);
  });
  act(() => hook.result.current.cancel());
  await act(async () => {
    resolve!(success);
    await start!;
  });
  expect(hook.result.current.response).toBeUndefined();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(register).toHaveBeenCalledTimes(1);
  hook.unmount();
});

it("stops polling on organization change", async () => {
  const register = api(pending);
  const hook = renderHook(({ org }) => useDeviceActivation(register, org), {
    initialProps: { org: "org-b" },
  });
  await act(async () => {
    await hook.result.current.start(values);
  });
  hook.rerender({ org: "org-c" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(register).toHaveBeenCalledTimes(1);
  expect(hook.result.current.response).toBeUndefined();
  hook.unmount();
});

it("bounds a stuck pending response by the five-minute window", async () => {
  const hook = renderHook(() => useDeviceActivation(api(pending), "org-b"));
  await act(async () => {
    await hook.result.current.start(values);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(304000);
  });
  expect(hook.result.current.time).toBe(0);
  expect(hook.result.current.response.data.activation_status).toBe("timeout");
  hook.unmount();
});

it("retries a transient polling failure without starting another activation", async () => {
  const register = api(pending);
  const hook = renderHook(() => useDeviceActivation(register, "org-b"));
  await act(async () => {
    await hook.result.current.start(values);
  });
  register.mockImplementationOnce(() => ({
    unwrap: () => Promise.reject(new Error("offline")),
  }));
  register.mockImplementationOnce(() => ({
    unwrap: () => Promise.resolve(success),
  }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(hook.result.current.response.data).toEqual(success);
  expect(register.mock.calls[2][0].body.enable).toBe(false);
  hook.unmount();
});
