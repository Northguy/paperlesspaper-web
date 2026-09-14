import React from "react";
import { Button, InlineLoading, Item, Tag } from "@progressiveui/react";
import moment from "moment";
import { Trans } from "react-i18next";

import JsonViewer from "components/JsonViewer";
import { devicesApi } from "ducks/devices";

type DeviceUploadLog = {
  _id?: string;
  attemptId: string;
  status: "started" | "skipped" | "uploaded" | "partial" | "failed";
  reason: string;
  trigger: string;
  similarityPercentage?: number | null;
  durationMs?: number | null;
  pipeline?: {
    source?: string;
    requestStartedAt?: string;
    uploadStartedAt?: string;
    deviceShadowSettings?: {
      attempted?: boolean;
      outcome?: "completed" | "error" | "not-run";
    };
    timings?: Record<string, number>;
  };
  stages?: Record<
    string,
    {
      status?: string;
      durationMs?: number | null;
      reason?: string;
    }
  >;
  render?: {
    renderer?: string;
    outcome?: "success" | "error";
    durationMs?: number | null;
    url?: string;
    viewport?: {
      width?: number;
      height?: number;
      orientation?: string;
      kind?: string;
    };
    initPayloadSent?: boolean;
    legacyDataPayloadSent?: boolean;
    networkIdle?: {
      outcome?: "idle" | "timeout-or-error" | "not-checked";
      error?: { message?: string };
    };
    readiness?: {
      outcome?:
        | "website-has-loaded"
        | "timeout"
        | "legacy-delay"
        | "not-checked";
      waitDurationMs?: number | null;
      timeoutMs?: number | null;
      protocolDetected?: boolean;
      loadingElementDetectedBeforeInit?: boolean;
      loadedElementDetectedBeforeInit?: boolean;
      loadingElementDetectedAfterInit?: boolean;
      loadedElementDetectedAfterInit?: boolean;
      websiteHasLoadedDetected?: boolean | null;
      error?: { message?: string };
    };
    pageState?: {
      status?: "ready" | "error" | "loading" | "unknown";
      hasErrorElement?: boolean;
      errorText?: string;
    };
    timings?: Record<string, number>;
    error?: { message?: string };
  };
  startedAt: string;
};

const statusType = (status: DeviceUploadLog["status"]) => {
  if (status === "uploaded") return "success";
  if (status === "failed") return "error";
  if (status === "partial" || status === "skipped") return "warning";
  return undefined;
};

const formatSimilarity = (similarityPercentage?: number | null) => {
  if (similarityPercentage === null || similarityPercentage === undefined) {
    return "n/a";
  }

  return `${similarityPercentage.toFixed(2)}%`;
};

const formatDuration = (durationMs?: number | null) => {
  if (durationMs === null || durationMs === undefined) return "n/a";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1_000).toFixed(2)}s`;
};

const formatReadiness = (render?: DeviceUploadLog["render"]) => {
  const readiness = render?.readiness;
  if (!readiness?.outcome || readiness.outcome === "not-checked") {
    return "n/a";
  }

  const duration = formatDuration(readiness.waitDurationMs);
  if (readiness.outcome === "website-has-loaded") {
    return `website-has-loaded (${duration})`;
  }
  if (readiness.outcome === "timeout") {
    return (
      <Trans
        i18nKey="Timeout after {{duration}}"
        values={{ duration: formatDuration(readiness.timeoutMs) }}
      />
    );
  }
  return <Trans i18nKey="Legacy delay ({{duration}})" values={{ duration }} />;
};

const timingLabels: Record<string, string> = {
  browserMs: "Browser acquisition/startup",
  pageCreationMs: "Page creation",
  viewportMs: "Viewport setup",
  navigationMs: "DOM navigation",
  networkIdleMs: "Network idle wait",
  adBlockMs: "Ad blocking",
  preInitDelayMs: "Pre-INIT delay",
  markerCheckBeforeInitMs: "Marker check before INIT",
  markerRecheckBeforeInitMs: "Marker recheck after network idle",
  legacyDataDispatchMs: "Legacy data dispatch",
  initDispatchMs: "INIT dispatch",
  markerCheckAfterInitMs: "Marker check after INIT",
  readinessWaitMs: "Readiness wait",
  pageStateCheckMs: "Final page-state check",
  customCssMs: "Custom CSS",
  screenshotMs: "Screenshot",
  totalMs: "Total Puppeteer render",
};

const timingOrder = Object.keys(timingLabels);

const pipelineTimingLabels: Record<string, string> = {
  controllerSetupMs: "Paper/settings/device setup",
  deviceShadowSettingsMs: "AWS device-shadow settings",
  paperAndDeviceLookupMs: "Paper/device reload",
  integrationPreparationMs: "Integration preparation",
  renderMs: "Website render wall time",
  ditherMs: "E-paper dithering",
  currentFrameSnapshotMs: "Current-frame snapshot check",
  preUploadMs: "All work before device upload",
  uploadMs: "Device upload pipeline",
  totalMs: "Full server pipeline",
};

const pipelineTimingOrder = Object.keys(pipelineTimingLabels);

const formatBoolean = (value?: boolean | null) => {
  if (value === undefined || value === null) return "n/a";
  return value ? <Trans>Yes</Trans> : <Trans>No</Trans>;
};

function RenderLoadingIndicators({
  render,
}: {
  render?: DeviceUploadLog["render"];
}) {
  if (!render) return null;

  const timings = Object.entries(render.timings || {}).sort(
    ([left], [right]) => {
      const leftIndex = timingOrder.indexOf(left);
      const rightIndex = timingOrder.indexOf(right);
      return (
        (leftIndex < 0 ? timingOrder.length : leftIndex) -
        (rightIndex < 0 ? timingOrder.length : rightIndex)
      );
    },
  );
  const readiness = render.readiness;
  const viewport = render.viewport;

  return (
    <details>
      <summary>
        <Trans>Loading indicators</Trans> ({timings.length})
      </summary>
      <ul>
        <li>
          <Trans>Render outcome:</Trans> {render.outcome || "n/a"}
        </li>
        <li>
          <Trans>Viewport:</Trans> {viewport?.width || "?"}×
          {viewport?.height || "?"} · {viewport?.orientation || "?"} ·{" "}
          {viewport?.kind || "?"}
        </li>
        <li>
          <Trans>INIT payload sent:</Trans>{" "}
          {formatBoolean(render.initPayloadSent)}
        </li>
        <li>
          <Trans>Legacy data payload sent:</Trans>{" "}
          {formatBoolean(render.legacyDataPayloadSent)}
        </li>
        <li>
          <Trans>Network idle:</Trans> {render.networkIdle?.outcome || "n/a"}
        </li>
        <li>
          <Trans>Readiness protocol detected:</Trans>{" "}
          {formatBoolean(readiness?.protocolDetected)}
        </li>
        <li>
          <Trans>Loading marker before INIT:</Trans>{" "}
          {formatBoolean(readiness?.loadingElementDetectedBeforeInit)}
        </li>
        <li>
          <Trans>Loaded marker before INIT:</Trans>{" "}
          {formatBoolean(readiness?.loadedElementDetectedBeforeInit)}
        </li>
        <li>
          <Trans>Loading marker after INIT:</Trans>{" "}
          {formatBoolean(readiness?.loadingElementDetectedAfterInit)}
        </li>
        <li>
          <Trans>Loaded marker after INIT:</Trans>{" "}
          {formatBoolean(readiness?.loadedElementDetectedAfterInit)}
        </li>
        <li>
          <Trans>website-has-loaded detected:</Trans>{" "}
          {formatBoolean(readiness?.websiteHasLoadedDetected)}
        </li>
        <li>
          <Trans>Readiness outcome:</Trans> {formatReadiness(render)}
        </li>
        <li>
          <Trans>Final page state:</Trans> {render.pageState?.status || "n/a"}
        </li>
        <li>
          <Trans>Error element present:</Trans>{" "}
          {formatBoolean(render.pageState?.hasErrorElement)}
        </li>
        {render.pageState?.errorText && (
          <li>
            <Trans>Page error:</Trans> {render.pageState.errorText}
          </li>
        )}
        {render.networkIdle?.error?.message && (
          <li>
            <Trans>Network-idle error:</Trans>{" "}
            {render.networkIdle.error.message}
          </li>
        )}
        {readiness?.error?.message && (
          <li>
            <Trans>Readiness error:</Trans> {readiness.error.message}
          </li>
        )}
        {render.error?.message && (
          <li>
            <Trans>Render error:</Trans> {render.error.message}
          </li>
        )}
        {timings.map(([key, durationMs]) => (
          <li key={key}>
            {timingLabels[key] ? <Trans>{timingLabels[key]}</Trans> : key}:{" "}
            {formatDuration(durationMs)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PipelineLoadingIndicators({
  pipeline,
  stages,
}: Pick<DeviceUploadLog, "pipeline" | "stages">) {
  if (!pipeline && !stages) return null;

  const timings = Object.entries(pipeline?.timings || {}).sort(
    ([left], [right]) => {
      const leftIndex = pipelineTimingOrder.indexOf(left);
      const rightIndex = pipelineTimingOrder.indexOf(right);
      return (
        (leftIndex < 0 ? pipelineTimingOrder.length : leftIndex) -
        (rightIndex < 0 ? pipelineTimingOrder.length : rightIndex)
      );
    },
  );
  const stageTimings = Object.entries(stages || {}).filter(
    ([, stage]) => stage.durationMs !== undefined && stage.durationMs !== null,
  );

  return (
    <details>
      <summary>
        <Trans>Full pipeline indicators</Trans> (
        {timings.length + stageTimings.length})
      </summary>
      <ul>
        <li>
          <Trans>Source:</Trans> {pipeline?.source || "n/a"}
        </li>
        <li>
          <Trans>Device-shadow settings:</Trans>{" "}
          {pipeline?.deviceShadowSettings?.outcome || "n/a"}
        </li>
        {timings.map(([key, durationMs]) => (
          <li key={key}>
            {pipelineTimingLabels[key] ? (
              <Trans>{pipelineTimingLabels[key]}</Trans>
            ) : (
              key
            )}
            : {formatDuration(durationMs)}
          </li>
        ))}
        {stageTimings.map(([key, stage]) => (
          <li key={`stage-${key}`}>
            <Trans
              i18nKey="Upload stage {{stage}} ({{status}}):"
              values={{ stage: key, status: stage.status || "n/a" }}
            />{" "}
            {formatDuration(stage.durationMs)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function DeviceUploadLogs({ id }: { id?: string }) {
  const { data, isError, isFetching, refetch } =
    devicesApi.useGetUploadLogsQuery(
      { id, limit: 50 },
      {
        skip: !id,
        refetchOnMountOrArgChange: true,
      },
    );
  const logs = (data?.results || []) as DeviceUploadLog[];

  return (
    <>
      <h3>
        <Trans>Upload attempts</Trans>
      </h3>
      <p>
        <Trans>
          Recent frame upload decisions, triggers, Puppeteer timings, readiness
          checks, similarity checks and failures for this device.
        </Trans>
      </p>
      <Button kind="secondary" disabled={isFetching} onClick={() => refetch()}>
        <Trans>Refresh</Trans>
      </Button>
      <br />
      <br />

      {isFetching && logs.length === 0 ? (
        <InlineLoading
          description={<Trans>Upload attempts loading...</Trans>}
        />
      ) : isError ? (
        <Trans>Upload attempts could not be loaded.</Trans>
      ) : logs.length > 0 ? (
        logs.map((log) => (
          <Item
            kind="horizontal"
            wrapper="repeater"
            key={log.attemptId || log._id}
            title={
              <>
                <Tag type={statusType(log.status)}>{log.status}</Tag>{" "}
                {log.reason}
              </>
            }
            subContent={
              <>
                <Trans>Trigger</Trans>: {log.trigger || "unknown"} ·{" "}
                <Trans>Similarity</Trans>:{" "}
                {formatSimilarity(log.similarityPercentage)} ·{" "}
                <Trans>Full pipeline</Trans>: {formatDuration(log.durationMs)} ·{" "}
                <Trans>Device upload</Trans>:{" "}
                {formatDuration(log.pipeline?.timings?.uploadMs)}
                <br />
                <Trans>Puppeteer render</Trans>:{" "}
                {formatDuration(log.render?.durationMs)} ·{" "}
                <Trans>Readiness</Trans>: {formatReadiness(log.render)}
              </>
            }
            additional={moment(log.startedAt).format("DD.MM.YYYY HH:mm:ss")}
          >
            <PipelineLoadingIndicators
              pipeline={log.pipeline}
              stages={log.stages}
            />
            <RenderLoadingIndicators render={log.render} />
            <JsonViewer collapsed={2} src={log} />
          </Item>
        ))
      ) : (
        <Trans>No upload attempts found.</Trans>
      )}
    </>
  );
}
