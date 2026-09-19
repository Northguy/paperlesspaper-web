// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import IntegrationPreview from "../../src/components/Epaper/Overview/IntegrationPreview";

vi.mock("@progressiveui/react", () => ({ Button: "button", Empty: "div" }));
vi.mock("react-i18next", () => ({ Trans: "span", useTranslation: () => ({ t: (s: string) => s }) }));

it("keeps fresh calendar events after initialization, updates and iframe reloads", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const initData = { meta: { calendarData: { events: [] } } };
  const first = [{ summary: "Design review" }];
  const second = [{ summary: "Prototype check" }];
  const render = (events: unknown[]) => act(() => root.render(
    <IntegrationPreview initData={initData} calendarPostData={{ events }}
      onSelectWebsite={() => {}} scale={1} shouldShowEmptyMessage={false}
      size={{ width: 800, height: 480 } as any} url="https://apps.paperlesspaper.de/google-calendar" />
  ));
  try {
    render(first);
    const iframe = container.querySelector("iframe")!;
    let displayedEvents: unknown[] = [];
    vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation((message: any) => {
      const data = message.data;
      displayedEvents = data.calendarData?.events ?? data.meta?.calendarData?.events ?? displayedEvents;
    });
    act(() => iframe.dispatchEvent(new Event("load")));
    expect(displayedEvents).toEqual(first);
    render(second);
    expect(displayedEvents).toEqual(second);
    act(() => iframe.dispatchEvent(new Event("load")));
    expect(displayedEvents).toEqual(second);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  }
});
