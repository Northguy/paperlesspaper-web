import React from "react";
import { InlineLoading } from "@progressiveui/react";
import { Trans, useTranslation } from "react-i18next";

import { getOriginFromUrl } from "./manifest";
import type {
  OpenIntegrationAppToPluginMessage,
  OpenIntegrationPluginToAppMessage,
} from "./types";

type Props = {
  url: string;
  expectedOrigin?: string | null;
  height?: number;
  onHeight?: (height: number) => void;
  onSettingsUpdate?: (settingsPatch: Record<string, any>) => void;
  onConnectionRequest?: () => Promise<{ grant: string }>;
  initMessage: OpenIntegrationAppToPluginMessage;
  redirectMessage?: OpenIntegrationAppToPluginMessage;
};

export default function OpenIntegrationSettingsIframe({
  url,
  expectedOrigin,
  height,
  onHeight,
  onSettingsUpdate,
  onConnectionRequest,
  initMessage,
  redirectMessage,
}: Props) {
  const { t } = useTranslation();
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  const origin = expectedOrigin ?? getOriginFromUrl(url);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current) return;
      if (event.source !== iframeRef.current.contentWindow) return;

      // Strict origin check when possible.
      if (origin && event.origin !== origin) return;

      const data = event.data as OpenIntegrationPluginToAppMessage;
      if (!data || typeof data !== "object") return;

      if (
        data.source === "paperlesspaper-plugin" &&
        data.type === "REQUEST_CONNECTION" &&
        typeof data.payload?.requestId === "string" &&
        data.payload.requestId.length <= 100
      ) {
        const reply = (payload: Record<string, unknown>) => {
          (event.source as Window)?.postMessage(
            {
              source: "paperlesspaper-app",
              type: "CONNECTION_GRANT",
              payload: { requestId: data.payload.requestId, ...payload },
            },
            event.origin
          );
        };
        if (!onConnectionRequest) reply({ error: "Content push unavailable" });
        else
          void onConnectionRequest()
            .then(reply)
            .catch(() => reply({ error: "Save the paper and reconnect" }));
      }

      if (
        data.source === "paperlesspaper-plugin" &&
        data.type === "SET_HEIGHT"
      ) {
        const next = Number(data.payload?.height);
        if (Number.isFinite(next) && next > 0) onHeight?.(next);
      }

      if (
        data.source === "paperlesspaper-plugin" &&
        data.type === "UPDATE_SETTINGS" &&
        data.payload &&
        typeof data.payload === "object"
      ) {
        onSettingsUpdate?.(data.payload);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, onHeight, onSettingsUpdate, onConnectionRequest]);

  const post = React.useCallback(
    (msg: OpenIntegrationAppToPluginMessage) => {
      const win = iframeRef.current?.contentWindow;

      if (!win) return;
      win.postMessage(msg, origin || "*");

      // Backwards compatibility for very simple plugins
      if (msg.type === "INIT") {
        win.postMessage({ cmd: "message", data: msg.payload }, origin || "*");
      }
      if (msg.type === "REDIRECT") {
        win.postMessage({ cmd: "redirect", data: msg.payload }, origin || "*");
      }
    },
    [origin]
  );

  React.useEffect(() => {
    if (!loaded) return;
    post(initMessage);
    if (redirectMessage) post(redirectMessage);
  }, [loaded, post, initMessage, redirectMessage]);

  return (
    <div>
      {!loaded && (
        <div style={{ padding: 12 }}>
          <InlineLoading description={<Trans>Loading integration…</Trans>} />
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={url}
        onLoad={() => setLoaded(true)}
        style={{
          width: "100%",
          height: height ? `${height}px` : "520px",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 8,
        }}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        referrerPolicy="no-referrer"
        title={t("Integration Settings")}
      />
    </div>
  );
}
