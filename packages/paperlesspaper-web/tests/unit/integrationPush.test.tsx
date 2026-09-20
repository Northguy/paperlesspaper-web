// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@progressiveui/react", () => ({ InlineLoading: () => null }));
vi.mock("react-i18next", () => ({
  Trans: ({ children }: any) => children,
  useTranslation: () => ({ t: (s: string) => s }),
}));
import OpenIntegrationSettingsIframe from "../../src/components/Epaper/Integrations/OpenIntegrationEditor/OpenIntegrationSettingsIframe";
import { samePushIntegration } from "../../src/helpers/integrationPush";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let dispose = () => {};
afterEach(() => dispose());
async function setup() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const grant = vi.fn().mockResolvedValue({ grant: "one-time-code" });
  await act(async () =>
    root.render(
      <OpenIntegrationSettingsIframe
        url="https://integration.example/settings.html"
        expectedOrigin="https://integration.example"
        onConnectionRequest={grant}
        initMessage={{
          source: "paperlesspaper-app",
          type: "INIT",
          payload: {
            settings: {},
            nativeSettings: {},
            device: {},
            app: {},
            paper: { id: "paper" },
          },
        }}
      />
    )
  );
  const frame = container.querySelector("iframe")!;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  dispose = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { frame, grant, post };
}
it("returns a one-time grant only to the expected iframe and origin", async () => {
  const { frame, grant, post } = await setup();
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://integration.example",
        data: {
          source: "paperlesspaper-plugin",
          type: "REQUEST_CONNECTION",
          payload: { requestId: "request" },
        },
      })
    )
  );
  expect(grant).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith(
    {
      source: "paperlesspaper-app",
      type: "CONNECTION_GRANT",
      payload: { requestId: "request", grant: "one-time-code" },
    },
    "https://integration.example"
  );
});
it("ignores messages from a different origin or window", async () => {
  const { frame, grant } = await setup();
  const data = {
    source: "paperlesspaper-plugin",
    type: "REQUEST_CONNECTION",
    payload: { requestId: "request" },
  };
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://evil.example",
        data,
      })
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin: "https://integration.example",
        data,
      })
    );
  });
  expect(grant).not.toHaveBeenCalled();
});
it("keeps server errors and credentials out of the plugin response", async () => {
  const { frame, grant, post } = await setup();
  grant.mockRejectedValue(new Error("private server details"));
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://integration.example",
        data: {
          source: "paperlesspaper-plugin",
          type: "REQUEST_CONNECTION",
          payload: { requestId: "request" },
        },
      })
    )
  );
  expect(post.mock.calls[0][0].payload).toEqual({
    requestId: "request",
    error: "Save the paper and reconnect",
  });
});
it("does not forward preview content after unsaved renderer changes", () => {
  const saved = {
    kind: "plugin",
    meta: {
      pluginConfigUrl: "https://integration.example/config.json",
      pluginManifest: {
        renderPage: "./render.html",
        capabilities: { contentPush: {} },
      },
    },
  };
  expect(
    samePushIntegration(saved, saved, "https://integration.example/render.html")
  ).toBe(true);
  expect(
    samePushIntegration(
      {
        ...saved,
        meta: {
          ...saved.meta,
          pluginRenderPage: "https://evil.example/render",
        },
      },
      saved,
      "https://evil.example/render"
    )
  ).toBe(false);
  expect(
    samePushIntegration(
      saved,
      undefined,
      "https://integration.example/render.html"
    )
  ).toBe(false);
});
