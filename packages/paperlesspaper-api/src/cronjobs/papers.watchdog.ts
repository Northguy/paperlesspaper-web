import { withDeadline } from "../utils/withDeadline";

export const PAPERS_JOB_TIMEOUT_MS = 10 * 60_000;
export const PAPERS_QUEUE_TIMEOUT_MS = 15 * 60_000;
const CHECK_INTERVAL_MS = 30_000;

/** A timed-out processor must be terminated, not raced and left running:
 * otherwise it can upload stale images after the next job has started. */
export const createPapersWatchdog = ({
  readLastFinishedAt,
  onUnhealthy,
}: {
  readLastFinishedAt: () => Promise<number | null>;
  onUnhealthy: (error: Error) => void;
}) => {
  let lastFinishedAt = Date.now();
  let active: { id?: string; startedAt: number } | undefined;
  let checking = false;
  let unhealthy = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const fail = (message: string) => {
    if (unhealthy) return;
    unhealthy = true;
    onUnhealthy(new Error(message));
  };

  const check = async () => {
    if (unhealthy) return;
    if (active && Date.now() - active.startedAt >= PAPERS_JOB_TIMEOUT_MS) {
      fail(
        `Papers job ${
          active.id || "unknown"
        } exceeded ${PAPERS_JOB_TIMEOUT_MS}ms; terminating stuck processor`,
      );
      return;
    }
    if (checking) return;
    checking = true;
    try {
      // Read shared queue history so another replica completing jobs counts too.
      const finishedAt = await withDeadline(
        () => readLastFinishedAt(),
        "Papers watchdog queue check",
        10_000,
      );
      if (finishedAt && finishedAt <= Date.now()) {
        lastFinishedAt = Math.max(lastFinishedAt, finishedAt);
      }
    } catch {
      // An unavailable Redis must not disable the independent liveness check.
    } finally {
      checking = false;
    }
    if (Date.now() - lastFinishedAt >= PAPERS_QUEUE_TIMEOUT_MS) {
      fail(
        `Papers queue has not finished a job for ${PAPERS_QUEUE_TIMEOUT_MS}ms; restarting worker`,
      );
    }
  };

  return {
    isHealthy: () => !unhealthy,
    start() {
      if (timer) return;
      lastFinishedAt = Date.now();
      timer = setInterval(() => {
        void check();
      }, CHECK_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    check,
    async run<T>(
      id: string | undefined,
      operation: () => Promise<T>,
    ): Promise<T> {
      active = { id, startedAt: Date.now() };
      try {
        return await operation();
      } finally {
        active = undefined;
        lastFinishedAt = Date.now();
      }
    },
  };
};
