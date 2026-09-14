import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPapersWatchdog,
  PAPERS_JOB_TIMEOUT_MS,
  PAPERS_QUEUE_TIMEOUT_MS,
} from "../../src/cronjobs/papers.watchdog";

describe("papers worker watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const readLastFinishedAt = vi
      .fn<() => Promise<number | null>>()
      .mockResolvedValue(null);
    const onUnhealthy = vi.fn();
    const watchdog = createPapersWatchdog({ readLastFinishedAt, onUnhealthy });
    return { watchdog, readLastFinishedAt, onUnhealthy };
  };

  it("requests termination exactly once for an unresolved processor", async () => {
    const { watchdog, onUnhealthy } = setup();
    void watchdog.run("stuck-upload", () => new Promise(() => {}));
    vi.setSystemTime(Date.now() + PAPERS_JOB_TIMEOUT_MS);
    await watchdog.check();
    await watchdog.check();
    expect(onUnhealthy).toHaveBeenCalledOnce();
    expect(onUnhealthy.mock.calls[0][0].message).toContain("stuck-upload");
  });

  it("detects a waiting queue even without a locally active job", async () => {
    const { watchdog, onUnhealthy } = setup();
    vi.setSystemTime(Date.now() + PAPERS_QUEUE_TIMEOUT_MS);
    await watchdog.check();
    expect(onUnhealthy).toHaveBeenCalledOnce();
  });

  it("counts another replica's completed jobs as queue progress", async () => {
    const { watchdog, readLastFinishedAt, onUnhealthy } = setup();
    vi.setSystemTime(Date.now() + PAPERS_QUEUE_TIMEOUT_MS);
    readLastFinishedAt.mockResolvedValue(Date.now() - 60_000);
    await watchdog.check();
    expect(onUnhealthy).not.toHaveBeenCalled();
  });

  it("does not mistake ordinary failures or new jobs for a stuck processor", async () => {
    const { watchdog, onUnhealthy } = setup();
    await expect(
      watchdog.run("failed", async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    vi.setSystemTime(Date.now() + PAPERS_JOB_TIMEOUT_MS);
    await watchdog.run("healthy", async () => "done");
    await watchdog.check();
    expect(onUnhealthy).not.toHaveBeenCalled();
  });

  it("still terminates when the queue health lookup also hangs", async () => {
    const { watchdog, readLastFinishedAt, onUnhealthy } = setup();
    readLastFinishedAt.mockImplementation(() => new Promise(() => {}));
    watchdog.start();
    await vi.advanceTimersByTimeAsync(PAPERS_QUEUE_TIMEOUT_MS + 10_000);
    expect(onUnhealthy).toHaveBeenCalledOnce();
    watchdog.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
