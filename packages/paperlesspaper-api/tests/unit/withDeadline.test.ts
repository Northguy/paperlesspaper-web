import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "../../src/utils/withDeadline";

describe("request deadlines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts a hung request and rejects even when the transport ignores cancellation", async () => {
    let signal: AbortSignal;
    const result = withDeadline(
      (s) => {
        signal = s;
        return new Promise(() => {});
      },
      "Upload",
      100,
    );
    const assertion = expect(result).rejects.toThrow(
      "Upload timed out after 100ms",
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears deadlines for both successful and failed requests", async () => {
    await expect(withDeadline(async () => "ok", "Upload")).resolves.toBe("ok");
    await expect(
      withDeadline(async () => {
        throw new Error("offline");
      }, "Upload"),
    ).rejects.toThrow("offline");
    expect(vi.getTimerCount()).toBe(0);
  });
});
