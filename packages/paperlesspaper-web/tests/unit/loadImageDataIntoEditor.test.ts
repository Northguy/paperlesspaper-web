import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fromURL = vi.hoisted(() => vi.fn());
const prepareImage = vi.hoisted(() => vi.fn());
vi.mock("fabric", () => ({ FabricImage: { fromURL } }));
vi.mock("../../src/components/Epaper/Integrations/ImageEditor/imageDataUrl", () => ({
  prepareImageUrlForEditor: prepareImage,
}));
vi.mock("../../src/components/Epaper/Integrations/ImageEditor/editorImageSources", () => ({
  getFabricImageSrc: vi.fn(),
  prepareFabricImageForEditorPreview: vi.fn(),
  setEditorImageSourceMetadata: vi.fn(),
}));
import loadImageDataIntoEditor from "../../src/components/Epaper/Integrations/ImageEditor/loadImageDataIntoEditor";

describe("API image editor fallback", () => {
  const image = { width: 800, height: 480, set: vi.fn(), scaleX: 1, scaleY: 1 };
  const canvas = {
    loadFromJSON: vi.fn(), getObjects: vi.fn(() => []),
    clear: vi.fn(), add: vi.fn(), renderAll: vi.fn(), backgroundColor: "",
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fromURL.mockResolvedValue(image);
    prepareImage.mockImplementation(async ({ imageUrl }) => ({ previewUrl: imageUrl, fullUrl: imageUrl }));
    canvas.loadFromJSON.mockResolvedValue(canvas);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([undefined, null, ""])("opens the original image without passing missing canvas data to Fabric (%s)", async (data) => {
    const request = vi.fn().mockResolvedValueOnce({ data }).mockResolvedValue({ data: { signedUrl: "https://example.test/original.png" } });
    await loadImageDataIntoEditor({ fabricCanvas: canvas, generateImageUrlAlt: request, paperId: "api-image", size: { width: 480, height: 800 } });
    expect(canvas.loadFromJSON).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
    expect(canvas.add).toHaveBeenCalledWith(image);
    expect(image.scaleX).toBe(480 / 800);
    expect(image.scaleY).toBe(800 / 480);
  });

  it("falls back after the canvas endpoint fails and tries the device image if the original is missing", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ error: { status: 500 } })
      .mockResolvedValueOnce({ error: { status: 404 } })
      .mockResolvedValueOnce({ data: { signedUrl: "https://example.test/image.png" } });
    await loadImageDataIntoEditor({ fabricCanvas: canvas, generateImageUrlAlt: request, paperId: "api-image", size: { width: 800, height: 480 } });
    expect(request.mock.calls.map(([arg]) => arg.body.kind)).toEqual(["editable.json", "original.png", ".png"]);
    expect(canvas.add).toHaveBeenCalledWith(image);
  });

  it("stops after both fallback images fail", async () => {
    const failure = new Error("Image missing");
    const request = vi.fn().mockResolvedValue({ error: failure });
    await expect(loadImageDataIntoEditor({ fabricCanvas: canvas, generateImageUrlAlt: request, paperId: "api-image", size: { width: 800, height: 480 } })).rejects.toThrow("Image missing");
    expect(request).toHaveBeenCalledTimes(3);
    expect(canvas.add).not.toHaveBeenCalled();
  });

  it("preserves a valid editable canvas without replacing it with a flat image", async () => {
    const data = { objects: [], version: "7.1.0" };
    const request = vi.fn().mockResolvedValue({ data });
    await loadImageDataIntoEditor({ fabricCanvas: canvas, generateImageUrlAlt: request, paperId: "edited-image", size: { width: 800, height: 480 } });
    expect(canvas.loadFromJSON).toHaveBeenCalledWith(data);
    expect(request).toHaveBeenCalledOnce();
    expect(canvas.clear).not.toHaveBeenCalled();
  });
});
