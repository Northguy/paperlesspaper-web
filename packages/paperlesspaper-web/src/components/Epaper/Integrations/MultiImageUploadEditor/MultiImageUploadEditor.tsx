import React from "react";
import {
  Button,
  Callout,
  Modal,
  Select,
  SelectItem,
  Story,
} from "@progressiveui/react";
import { Trans, useTranslation } from "react-i18next";
import { useHistory, useLocation, useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import OverlayLoading from "components/OverlayLoading";
import { devicesApi } from "ducks/devices";
import { papersApi } from "ducks/ePaper/papersApi";
import { useActiveUserDevice } from "helpers/useUsers";
import { prepareImageFileForEditor } from "../ImageEditor/imageDataUrl";
import ImageEditor, { ImageEditorHandle } from "../ImageEditor/ImageEditor";
import useQs from "helpers/useQs";
import {
  getShareTargetImageDataUrl,
  getShareTargetPayload,
} from "helpers/shareTarget";

type EditorParams = {
  organization: string;
  page: string;
  entry: string;
};

type SelectedImage = {
  id: string;
  file?: File;
  fileName: string;
  imageUrl: string;
};

export default function MultiImageUploadEditor() {
  const history = useHistory();
  const location = useLocation();
  const params = useParams<EditorParams>();
  const { shareTargetId } = useQs();
  const { t } = useTranslation();
  const activeUserDevices = useActiveUserDevice();

  const devices = devicesApi.useGetAllDevicesQuery(
    { organizationId: params.organization },
    { skip: !params.organization || Boolean(activeUserDevices.data?.id) }
  );
  const [uploadError, setUploadError] = React.useState(false);
  const createdPaperIds = React.useRef<Record<string, string>>({});
  const [updatePaper] = papersApi.useUpdateSinglePapersMutation();
  const [createPaper] = papersApi.useCreateSinglePapersMutation();
  const [uploadSingleImage] = papersApi.useUploadSingleImageMutation();

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const inlineEditorRefs = React.useRef<
    Record<string, ImageEditorHandle | null>
  >({});
  const modalEditorRefs = React.useRef<
    Record<string, ImageEditorHandle | null>
  >({});
  const [isUploading, setIsUploading] = React.useState(false);
  const [editingImageId, setEditingImageId] = React.useState<string | null>(
    null
  );
  const [selectedImages, setSelectedImages] = React.useState<SelectedImage[]>(
    []
  );

  const overviewUrl = `/${params.organization}/${params.page}/device/${params.entry}`;

  const openPicker = () => {
    inputRef.current?.click();
  };

  const selectDevice = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const device = devices.data?.find((item) => item.id === event.target.value);
    if (!device) return;
    const query = new URLSearchParams(location.search);
    query.set("frameKind", device.kind);
    history.replace({
      pathname: `/${params.organization}/${params.page}/device/${device.id}/new/image-multi-upload`,
      search: `?${query.toString()}`,
    });
  };

  const uploadImagesAsNewPapers = async () => {
    if (
      isUploading ||
      !activeUserDevices.data?.id ||
      selectedImages.length === 0
    )
      return;

    setIsUploading(true);
    setUploadError(false);

    try {
      for (const selectedImage of selectedImages) {
        const editorData =
          (await modalEditorRefs.current[
            selectedImage.id
          ]?.exportImageData()) ||
          (await inlineEditorRefs.current[selectedImage.id]?.exportImageData());
        if (!editorData) throw new Error("Image editor is not ready");

        const values = {
          organization: params.organization,
          kind: "image",
          deviceId: activeUserDevices.data.id,
          meta: {
            id: uuidv4(),
            lut: "default",
            ...editorData.meta,
            frameKind: activeUserDevices.data.kind,
          },
        };
        let paperId = createdPaperIds.current[selectedImage.id];
        if (paperId) {
          await updatePaper({ id: paperId, values }).unwrap();
        } else {
          const paper = await createPaper({ values }).unwrap();
          if (!paper?.id) throw new Error("Could not create image");
          paperId = paper.id;
          createdPaperIds.current[selectedImage.id] = paperId;
        }

        const formData = new FormData();
        formData.append(
          "picture",
          editorData.dataDirect,
          selectedImage.fileName
        );
        formData.append(
          "picture",
          editorData.dataOriginal,
          selectedImage.fileName
        );
        formData.append("pictureEditable", editorData.dataEditable);

        await uploadSingleImage({
          id: paperId,
          body: formData,
          deviceId: activeUserDevices.data.id,
        }).unwrap();

        // Remove only completed uploads so a retry cannot duplicate them.
        delete createdPaperIds.current[selectedImage.id];
        setSelectedImages((previous) =>
          previous.filter((image) => image.id !== selectedImage.id)
        );
      }

      history.push(overviewUrl);
    } catch (error) {
      console.error("Multi image upload failed", error);
      setUploadError(true);
    } finally {
      setIsUploading(false);
    }
  };

  const onFilesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files || []);

    const validFiles = files.filter((file) =>
      Boolean(file.type && file.type.startsWith("image/"))
    );

    if (files.length > 0 && validFiles.length === 0) {
      window.alert(
        t("imageOnly", "Only image files are supported. Please select images.")
      );
      return;
    }

    const nextSelected: SelectedImage[] = await Promise.all(
      validFiles.map(async (file) => {
        const imageUrl = await prepareImageFileForEditor(file);

        return {
          id: uuidv4(),
          file,
          fileName: file.name,
          imageUrl,
        };
      })
    );

    if (nextSelected.length > 0) {
      setSelectedImages((previous) => [...previous, ...nextSelected]);
    }

    if (event.target) {
      event.target.value = "";
    }
  };

  const removeImage = (id: string) => {
    delete inlineEditorRefs.current[id];
    delete modalEditorRefs.current[id];
    if (editingImageId === id) {
      setEditingImageId(null);
    }
    setSelectedImages((previous) =>
      previous.filter((image) => image.id !== id)
    );
  };

  React.useEffect(() => {
    let isMounted = true;
    const payload = getShareTargetPayload(shareTargetId);
    if (!payload?.images?.length) return;

    void Promise.all(
      payload.images.map(async (image) => ({
        id: uuidv4(),
        fileName: image.name || "shared-image.png",
        imageUrl: await getShareTargetImageDataUrl(image),
      }))
    ).then((sharedImages) => {
      if (!isMounted) return;

      setSelectedImages((previous) => {
        if (previous.length > 0) return previous;

        return sharedImages;
      });
    });

    return () => {
      isMounted = false;
    };
  }, [shareTargetId]);

  React.useEffect(() => {
    return () => {
      inlineEditorRefs.current = {};
      modalEditorRefs.current = {};
    };
  }, []);

  return (
    <>
      {isUploading && (
        <OverlayLoading
          description={<Trans>Uploading images and creating papers...</Trans>}
          fullscreen
        />
      )}

      <Modal
        open
        modalHeading={<Trans>Multi Image Upload</Trans>}
        primaryButtonText={<Trans>Upload images</Trans>}
        primaryButtonDisabled={
          isUploading ||
          !activeUserDevices.data?.id ||
          selectedImages.length === 0
        }
        secondaryButtonText={<Trans>Add images</Trans>}
        kindMobile="fullscreen"
        overscrollBehavior="inside"
        onRequestClose={() => {
          if (!isUploading) history.push(overviewUrl);
        }}
        onRequestSubmit={uploadImagesAsNewPapers}
        onSecondarySubmit={() => {
          if (!isUploading && activeUserDevices.data?.id) openPicker();
        }}
      >
        <Story>
          {!activeUserDevices.data?.id && (
            <Select
              id="multi-upload-device"
              labelText={<Trans>Select picture frame</Trans>}
              value=""
              onChange={selectDevice}
              disabled={devices.isLoading}
            >
              <SelectItem value="" text={t("Select picture frame")} />
              {(devices.data || []).map((device) => (
                <SelectItem
                  key={device.id}
                  value={device.id}
                  text={device.name || device.deviceId || device.id}
                />
              ))}
            </Select>
          )}
          {uploadError && (
            <Callout kind="error" title={<Trans>Upload failed</Trans>}>
              <Trans>
                Some images could not be uploaded. Please try again.
                Successfully uploaded images have been removed from this list.
              </Trans>
            </Callout>
          )}
          <p>
            <Trans>
              Select multiple images from your device. Every uploaded image will
              create a separate new paper.
            </Trans>
          </p>
          {selectedImages.length > 0 && (
            <p>
              {selectedImages.length} <Trans>image(s) selected</Trans>
            </p>
          )}
          <Button
            kind="secondary"
            onClick={openPicker}
            disabled={isUploading || !activeUserDevices.data?.id}
          >
            <Trans>Select images</Trans>
          </Button>
          {selectedImages.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {selectedImages.map((image) => (
                <div key={image.id} style={{ marginBottom: 16 }}>
                  <img
                    src={image.imageUrl}
                    alt={image.fileName}
                    style={{ width: "100%", maxWidth: 360 }}
                  />
                  <ImageEditor
                    ref={(instance) => {
                      inlineEditorRefs.current[image.id] = instance;
                    }}
                    open={false}
                    image={image.imageUrl}
                    inline={true}
                  />
                  <div style={{ marginTop: 8 }}>
                    <Button
                      kind="secondary"
                      onClick={() => setEditingImageId(image.id)}
                      disabled={isUploading}
                    >
                      <Trans>Edit</Trans>
                    </Button>
                    <Button
                      kind="danger-ghost"
                      onClick={() => removeImage(image.id)}
                      disabled={isUploading}
                    >
                      <Trans>Remove</Trans>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {selectedImages.map((image) => (
            <ImageEditor
              key={`editor-${image.id}`}
              ref={(instance) => {
                modalEditorRefs.current[image.id] = instance;
              }}
              open={editingImageId === image.id}
              image={image.imageUrl}
              onRequestCloseOverride={() => setEditingImageId(null)}
            />
          ))}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={onFilesSelected}
          />
        </Story>
      </Modal>
    </>
  );
}
