// Read-only production check. Does not enqueue jobs, claim devices or upload images.
import dotenv from "dotenv";

dotenv.config({ path: ".env.production", quiet: true });

try {
  if (!process.env.API_URL || !process.env.BULL_BOARD_PASSWORD) {
    throw new Error("API_URL and BULL_BOARD_PASSWORD are required");
  }
  const url = new URL("/admin/queues/api/queues", process.env.API_URL);
  url.searchParams.set("activeQueue", "paperlesspaperPapersCronjobs");
  url.searchParams.set("status", "completed");
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.BULL_BOARD_USERNAME || "admin"}:${process.env.BULL_BOARD_PASSWORD}`).toString("base64")}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Queue check returned HTTP ${response.status}`);
  const data = await response.json();
  const queue = data.queues?.find((entry) => entry.name === "paperlesspaperPapersCronjobs");
  if (!queue) throw new Error("Papers queue is missing");
  const latest = queue.jobs?.[0];
  const ageMs = latest?.finishedOn ? Date.now() - latest.finishedOn : null;
  const errors = latest?.returnValue?.meta?.errors?.length || 0;
  const healthy = ageMs !== null && ageMs >= 0 && ageMs < 15 * 60_000 && !queue.isPaused && errors === 0;
  console.log(JSON.stringify({
    healthy,
    checkedAt: new Date().toISOString(),
    lastCompletedAt: latest?.finishedOn ? new Date(latest.finishedOn).toISOString() : null,
    minutesSinceCompletion: ageMs === null ? null : Math.round(ageMs / 6000) / 10,
    paused: queue.isPaused,
    counts: queue.counts,
    lastRun: latest?.returnValue?.meta ? {
      durationMs: latest.returnValue.meta.durationMs,
      actions: latest.returnValue.meta.actions,
      errors,
    } : null,
  }, null, 2));
  process.exitCode = healthy ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Queue check failed");
  process.exitCode = 1;
}
