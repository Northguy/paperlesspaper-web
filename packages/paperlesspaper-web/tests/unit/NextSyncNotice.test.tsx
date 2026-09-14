// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({ Trans: ({ i18nKey, values, children }: any) =>
  i18nKey ? i18nKey.replace("{{nextSync}}", values.nextSync) : children,
}));
import NextSyncNotice from "../../src/components/Epaper/Integrations/IntegrationWrapper/NextSyncNotice";

let element: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
  element = document.createElement("div");
  root = createRoot(element);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
const render = (nextDeviceSync: unknown, active = true) => act(() => {
  root.render(<NextSyncNotice nextDeviceSync={nextDeviceSync} active={active} />);
});
it("crosses zero without counting elapsed seconds as a future sync", () => {
  render("2026-09-09T10:00:02Z");
  expect(element.textContent).toBe("Next sync in 2s.");
  act(() => vi.advanceTimersByTime(2000));
  expect(element.textContent).toBe("Updating now...");
  act(() => vi.advanceTimersByTime(59000));
  expect(element.textContent).toBe("Updating now...");
  act(() => vi.advanceTimersByTime(1000));
  expect(element.textContent).toBe("The next sync will happen automatically.");
});
it.each([null, undefined, "", "invalid", Infinity])("handles missing or invalid sync %s", (value) => {
  render(value);
  expect(element.textContent).toBe("The next sync will happen automatically.");
  expect(vi.getTimerCount()).toBe(0);
});
it.each([1788948002, "1788948002", 1788948002000])("accepts timestamp %s", value => {
  render(value);
  expect(element.textContent).toBe("Next sync in 2s.");
});
it("stops its timer when closed and uses the current time when reopened", () => {
  render("2026-09-09T10:00:02Z");
  render("2026-09-09T10:00:02Z", false);
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(3000));
  render("2026-09-09T10:00:02Z");
  expect(element.textContent).toBe("Updating now...");
});
it("restarts the countdown when the device reports its next sync", () => {
  render("2026-09-09T09:59:59Z");
  expect(element.textContent).toBe("Updating now...");
  render("2026-09-09T10:00:20Z");
  expect(element.textContent).toBe("Next sync in 20s.");
});
