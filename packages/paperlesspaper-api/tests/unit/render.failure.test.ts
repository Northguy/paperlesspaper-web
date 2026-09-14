import { beforeEach, describe, expect, it, vi } from "vitest";

const { page } = vi.hoisted(() => ({ page: {
  setViewport: vi.fn(), goto: vi.fn(), evaluate: vi.fn(),
  waitForSelector: vi.fn(), screenshot: vi.fn(), close: vi.fn(),
} }));
vi.mock("puppeteer", () => ({ default: { launch: vi.fn(async () => ({
  on: vi.fn(), isConnected: () => true, newPage: async () => page,
})) } }));
vi.mock("../../src/render/adBlock.service", () => ({ adBlock: vi.fn() }));
import renderService from "../../src/render/render.service";

const render = () => renderService.generateImageFromUrl({
  url: "https://apps.paperlesspaper.de/weather", kind: "epd7",
  paper: { kind: "plugin" },
});

describe("failed page rendering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    page.goto.mockResolvedValue({ ok: () => true });
    page.evaluate
      .mockResolvedValueOnce({ loading: true, loaded: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ loading: true, loaded: false })
      .mockResolvedValueOnce({ status: "ready", hasErrorElement: false })
      .mockResolvedValueOnce(null);
    page.screenshot.mockResolvedValue(Buffer.from("rendered image"));
  });

  it("rejects HTTP failures before taking a screenshot and closes the page", async () => {
    page.goto.mockResolvedValue({ ok: () => false, status: () => 503 });
    const result = await render();
    expect(result.buffer).toBeNull();
    expect(result.diagnostics.error?.message).toContain("HTTP 503");
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("does not save a loading screen when readiness times out", async () => {
    page.waitForSelector.mockRejectedValue(new Error("timeout"));
    const result = await render();
    expect(result.buffer).toBeNull();
    expect(result.diagnostics.readiness.outcome).toBe("timeout");
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalledOnce();
  });

  it("still captures a page that finishes loading", async () => {
    const result = await render();
    expect(result.buffer?.toString()).toBe("rendered image");
    expect(result.diagnostics.outcome).toBe("success");
    expect(page.close).toHaveBeenCalledOnce();
  });
});
