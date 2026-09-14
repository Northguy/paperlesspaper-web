# Slideshow worker outage, 11 September 2026

## Production evidence

Read on 14 September from Bull Board and MongoDB; all timestamps below are UTC.

- Last completed `papersCronjob`: started 08:23:17, finished 08:24:15 on 11 September. It prepared 11 slides and 7 dynamic integrations with no recorded errors.
- The next job, `repeat:schedule:papersCronjob:1789115237330`, started at 08:27:17 and never completed. Its device claims continued until 08:27:55.
- One device claim remains `processing`. Its upload attempt `43eee2d9-3a7c-4e57-9eaa-8f7388673331` was saved at 08:27:56 with status `started`, no finish timestamp and no failures.
- Queue inspection on 14 September showed zero active, one waiting and one overdue delayed job. The device scheduling queue continued completing jobs normally.

The exact original blocking operation cannot be identified from the old logs: they saved the initial state and final outcome, but not intermediate stages. The upload path contained unbounded Axios GET/POST/PUT operations and S3 operations. The papers processor had concurrency one and awaited every device in each batch, without a processor deadline. A single unresolved upload could therefore occupy the processor indefinitely. BullMQ lock renewal/stalled recovery is not an execution timeout.

## Changes

- Bound image downloads and uploads to 60 seconds, passing cancellation to Axios, S3 requests, multipart uploads and S3 response streams. Auth0 requests also have a 60-second timeout.
- Persist intermediate upload stages. Bound diagnostic writes to five seconds so diagnostic logging cannot indefinitely block image delivery.
- Explicitly flag failed IoT uploads, and propagate them through the paper service. Keep the slideshow position on failure; release the cronjob claim for a retry.
- A watchdog checks every 30 seconds. A local job exceeding ten minutes, or a queue without finished jobs for fifteen minutes, becomes unhealthy and exits the API process within two seconds. The watchdog reads shared queue history to allow multiple replicas. It also works when its Redis lookup never resolves.
- `/health` returns 503 if production cronjobs are disabled, uninitialized or the watchdog has fired. A Docker healthcheck also detects a blocked event loop from a separate process.
- Fatal watchdog errors are written to logs and submitted to the existing Sentry API. Sentry delivery requires an initialized Sentry client; this must be verified in deployment.

Do not replace the watchdog with `Promise.race(cronjobPapers(...), timeout)`: that leaves the original processor running and able to upload stale images after a replacement has begun.

## Deployment and recovery

Production hosting access was not available during implementation. The checked-in Fly.io app could not be accessed using the configured account. No production restart, queue mutation or deployment has been performed.

1. Before restarting, capture container logs around 11 September 08:27 UTC and Redis worker/lock events if retained. Preserve the existing running image reference for rollback.
2. Identify the actual production service and verify automatic replacement on process exit and on unhealthy status. A standalone Docker healthcheck alone does **not** restart a container; Swarm or another supervisor must handle replacement. Verify the runtime port, startup grace period and Sentry configuration.
3. Stop/replace the stuck API process with the reviewed fix. Do not run a competing processor while the old process can still upload. Do not flush Redis or delete slideshow data. Existing stale claims are eligible for recovery after fifteen minutes or on a new predicted sync.
4. Verify `/health`, then run `node scripts/check-papers-cronjob.mjs` from the API package directory. This check uses existing environment credentials without printing them and is read-only; exit code 1 means stale/missing/paused/erroring slideshow processing.
5. Observe at least two consecutive four-minute scheduler cycles. Confirm fresh job completion timestamps, no lingering `processing` claims, and new `cronjob-slideshow` upload logs. Actual frame display changes remain subject to device wakeup schedules.
6. In staging, inject a never-answering download/upload and confirm cancellation. Inject an unresolved processor and confirm supervisor replacement. Monitor the queue externally as well as `/health`; an in-process watchdog cannot help if the entire host is down.

The workspace already contained unrelated changes and additional slideshow corrections. Review the deployment diff explicitly instead of publishing the whole dirty workspace indiscriminately.

## Validation

115 tests passed across the unit suite and the slideshow, papers cronjob, device scheduling and scheduler integration suites, including hung transport cancellation, S3 stream destruction, next-upload recovery, unchanged slideshow position on failure, and worker/queue watchdog behavior. The broad TypeScript check is not clean: the repository has missing declarations/modules and existing service typing errors; no successful full typecheck is claimed.

References: [BullMQ timeout jobs](https://docs.bullmq.io/patterns/timeout-jobs), [BullMQ stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs), [AWS SDK HTTP handler configuration](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-configuring-maxsockets.html).
