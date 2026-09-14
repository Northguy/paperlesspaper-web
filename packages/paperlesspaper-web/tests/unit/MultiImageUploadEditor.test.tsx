// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  params: {
    organization: "org",
    page: "calendar",
    entry: "new",
    kind: "device",
  },
  device: null as any,
  create: vi.fn(),
  upload: vi.fn(),
  update: vi.fn(),
  exportImage: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  queryDevice: vi.fn(),
}));
vi.mock("react-router-dom", () => ({
  useParams: () => mocks.params,
  useHistory: () => ({ push: mocks.push, replace: mocks.replace }),
  useLocation: () => ({ search: "?frameKind=openpaper13&shareTargetId=keep" }),
}));
vi.mock("helpers/useUsers", () => ({
  useActiveUserDevice: () => ({ data: mocks.device }),
}));
vi.mock("ducks/devices", () => ({
  devicesApi: {
    useGetAllDevicesQuery: () => ({
      data: [{ id: "frame-1", name: "Living room", kind: "openpaper13" }],
    }),
    useGetSingleDevicesQuery: (...args: any[]) => mocks.queryDevice(...args),
  },
}));
vi.mock("ducks/ePaper/papersApi", () => ({
  papersApi: {
    useCreateSinglePapersMutation: () => [mocks.create],
    useUploadSingleImageMutation: () => [mocks.upload],
    useUpdateSinglePapersMutation: () => [mocks.update],
  },
}));
vi.mock("helpers/useQs", () => ({ default: () => ({}) }));
vi.mock("helpers/shareTarget", () => ({ getShareTargetPayload: () => null }));
vi.mock("components/OverlayLoading", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  Trans: ({ children }: any) => children,
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("@progressiveui/react", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Modal: ({
    children,
    onRequestSubmit,
    primaryButtonText,
    primaryButtonDisabled,
  }: any) => (
    <div>
      {children}
      <button onClick={onRequestSubmit} disabled={primaryButtonDisabled}>
        {primaryButtonText}
      </button>
    </div>
  ),
  Story: ({ children }: any) => <div>{children}</div>,
  Callout: ({ children }: any) => <div role="alert">{children}</div>,
  Select: ({ id, labelText, children, ...props }: any) => (
    <label>
      {labelText}
      <select id={id} {...props}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({ text, value }: any) => <option value={value}>{text}</option>,
}));
vi.mock(
  "../../src/components/Epaper/Integrations/ImageEditor/imageDataUrl",
  () => ({
    prepareImageFileForEditor: async () => "data:image/png;base64,test",
  })
);
vi.mock(
  "../../src/components/Epaper/Integrations/ImageEditor/ImageEditor",
  () => ({
    default: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({
        exportImageData: mocks.exportImage,
      }));
      return null;
    }),
  })
);
import MultiImageUploadEditor from "../../src/components/Epaper/Integrations/MultiImageUploadEditor/MultiImageUploadEditor";
import { useActiveDevice } from "../../src/helpers/devices/useDevices";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = (node: React.ReactNode) => act(() => root.render(node));
const upload = () =>
  act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Upload images"
    )!;
    button.click();
  });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.params.entry = "new";
  mocks.device = null;
  mocks.exportImage.mockResolvedValue({
    dataDirect: new Blob(["device"]),
    dataOriginal: new Blob(["original"]),
    dataEditable: "{}",
    meta: { orientation: "landscape", dithering: "custom" },
  });
  mocks.create.mockImplementation(() => ({
    unwrap: async () => ({ id: `paper-${mocks.create.mock.calls.length}` }),
  }));
  mocks.upload.mockImplementation(() => ({ unwrap: async () => ({}) }));
  mocks.update.mockImplementation(() => ({ unwrap: async () => ({}) }));
});
afterEach(() => act(() => root.unmount()));

it("lets the library user select a frame and preserves the share query", () => {
  render(<MultiImageUploadEditor />);
  act(() => {
    const select = container.querySelector("select")!;
    select.value = "frame-1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(mocks.replace).toHaveBeenCalledWith({
    pathname: "/org/calendar/device/frame-1/new/image-multi-upload",
    search: "?frameKind=openpaper13&shareTargetId=keep",
  });
});
it("does not fetch the route placeholder as a device", () => {
  const Probe = () => {
    useActiveDevice();
    return null;
  };
  render(<Probe />);
  expect(mocks.queryDevice).toHaveBeenLastCalledWith("new", { skip: true });
  mocks.params.entry = "frame-1";
  render(<Probe />);
  expect(mocks.queryDevice).toHaveBeenLastCalledWith("frame-1", {
    skip: false,
  });
});
async function selectFiles(names: string[]) {
  mocks.device = { id: "frame-1", kind: "openpaper13" };
  render(<MultiImageUploadEditor />);
  await act(async () => {
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: names.map(
        (name) => new File(["image"], name, { type: "image/png" })
      ),
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll("img")).toHaveLength(names.length);
}
it("stores the exported orientation and editor settings", async () => {
  await selectFiles(["one.png"]);
  await upload();
  expect(mocks.push).toHaveBeenCalled();
  expect(mocks.create.mock.calls[0][0].values.meta).toMatchObject({
    orientation: "landscape",
    dithering: "custom",
    frameKind: "openpaper13",
  });
  expect(mocks.upload.mock.calls[0][0].body.getAll("picture")).toHaveLength(2);
});
it("keeps failed images and retries without duplicating completed or created papers", async () => {
  let attempts = 0;
  mocks.upload.mockImplementation(() => ({
    unwrap: async () => {
      if (++attempts === 2) throw new Error("offline");
      return {};
    },
  }));
  await selectFiles(["one.png", "two.png"]);
  await upload();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(container.querySelectorAll("img")).toHaveLength(1);
  await upload();
  expect(mocks.push).toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.upload).toHaveBeenCalledTimes(3);
  expect(mocks.upload.mock.calls[2][0].id).toBe(
    mocks.upload.mock.calls[1][0].id
  );
});
it("does not create an empty paper when the editor cannot export", async () => {
  mocks.exportImage.mockResolvedValue(null);
  await selectFiles(["one.png"]);
  await upload();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
