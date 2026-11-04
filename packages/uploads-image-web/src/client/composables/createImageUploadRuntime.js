import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_IMAGE_COMPRESSOR_OPTIONS,
  DEFAULT_IMAGE_DASHBOARD_OPTIONS,
  DEFAULT_IMAGE_EDITOR_OPTIONS,
  DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  DEFAULT_IMAGE_UPLOAD_MAX_BYTES
} from "../../shared/imageUploadDefaults.js";
import { parseUploadResponse } from "../support/parseUploadResponse.js";
import { closeDashboard, stopImageEditor } from "../support/uppyPlugins.js";
import { useJskitText } from "../i18n.js";

function ignoreUploadEvent() {}

/** @param {import("../types.js").ImageUploadRuntimeOptions} options */
function createImageUploadRuntime({
  endpoint = "",
  method = "POST",
  fieldName = "file",
  withCredentials = true,
  maxNumberOfFiles = 1,
  allowedMimeTypes = DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  maxUploadBytes = DEFAULT_IMAGE_UPLOAD_MAX_BYTES,
  note = "",
  dashboardOptions = {},
  imageEditorOptions = {},
  compressorOptions = {},
  parseResponse = parseUploadResponse,
  resolveRequestHeaders,
  onSelectedFileNameChanged = ignoreUploadEvent,
  onUploadSuccess,
  onInvalidResponse = ignoreUploadEvent,
  onUploadError,
  onRestrictionFailed,
  onUnavailable = ignoreUploadEvent,
  dependencies: {
    UppyClass = Uppy,
    DashboardPlugin = Dashboard,
    ImageEditorPlugin = ImageEditor,
    CompressorPlugin = Compressor,
    XHRUploadPlugin = XHRUpload
  } = {}
}) {
  let uploadUppy = null;

  const normalizedAllowedMimeTypes =
    Array.isArray(allowedMimeTypes) && allowedMimeTypes.length > 0
      ? allowedMimeTypes.map((value) => String(value || "").trim()).filter(Boolean)
      : [...DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES];
  const normalizedMaxUploadBytes =
    Number.isInteger(maxUploadBytes) && maxUploadBytes > 0 ? maxUploadBytes : DEFAULT_IMAGE_UPLOAD_MAX_BYTES;
  const normalizedEndpoint = String(endpoint || "").trim();
  const normalizedFieldName = String(fieldName || "file").trim() || "file";
  const normalizedMethod = String(method || "POST").trim().toUpperCase() || "POST";
  const dashboardNote =
    String(note || "").trim() ||
    useJskitText().t("jskit.uploads.imageUpload.note", {
      types: normalizedAllowedMimeTypes.join(", "),
      maxMb: Math.floor(normalizedMaxUploadBytes / (1024 * 1024))
    });

  function emitSelectedFileName(fileName) {
    onSelectedFileNameChanged(String(fileName || ""));
  }

  function setup() {
    if (typeof window === "undefined") {
      return;
    }

    if (uploadUppy) {
      return;
    }

    const uppy = new UppyClass({
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: Number.isInteger(maxNumberOfFiles) && maxNumberOfFiles > 0 ? maxNumberOfFiles : 1,
        allowedFileTypes: [...normalizedAllowedMimeTypes],
        maxFileSize: normalizedMaxUploadBytes
      }
    });

    uppy.use(DashboardPlugin, {
      ...DEFAULT_IMAGE_DASHBOARD_OPTIONS,
      ...normalizeObject(dashboardOptions),
      note: dashboardNote,
      doneButtonHandler: () => {
        closeDashboard(uppy);
      }
    });

    uppy.use(ImageEditorPlugin, {
      ...DEFAULT_IMAGE_EDITOR_OPTIONS,
      ...normalizeObject(imageEditorOptions)
    });

    uppy.use(CompressorPlugin, {
      ...DEFAULT_IMAGE_COMPRESSOR_OPTIONS,
      ...normalizeObject(compressorOptions)
    });

    uppy.use(XHRUploadPlugin, {
      endpoint: normalizedEndpoint,
      method: normalizedMethod,
      formData: true,
      fieldName: normalizedFieldName,
      withCredentials: withCredentials !== false,
      onBeforeRequest: async (xhr) => {
        const headers = normalizeObject(await resolveRequestHeaders({ xhr, uppy }));
        for (const [headerName, headerValue] of Object.entries(headers)) {
          if (headerValue == null) {
            continue;
          }
          xhr.setRequestHeader(headerName, String(headerValue));
        }
      },
      getResponseData: parseResponse
    });

    uppy.on("file-added", (file) => {
      emitSelectedFileName(file?.name || "");
    });

    uppy.on("file-removed", () => {
      emitSelectedFileName("");
    });

    uppy.on("file-editor:complete", (file) => {
      emitSelectedFileName(file?.name || "");
      stopImageEditor(uppy);
    });

    uppy.on("file-editor:cancel", () => {
      stopImageEditor(uppy);
    });

    uppy.on("dashboard:modal-closed", () => {
      stopImageEditor(uppy);
    });

    uppy.on("upload-success", (file, response) => {
      const data = response?.body;
      if (!data || typeof data !== "object") {
        onInvalidResponse({
          file,
          response,
          uppy
        });
        return;
      }

      onUploadSuccess({
        data,
        file,
        response,
        uppy
      });

      emitSelectedFileName("");
    });

    uppy.on("upload-error", (file, error, response) => {
      onUploadError({
        file,
        error,
        response,
        uppy
      });
    });

    uppy.on("restriction-failed", (file, error) => {
      onRestrictionFailed({
        file,
        error,
        uppy
      });
    });

    uppy.on("complete", (result) => {
      const successfulCount = Array.isArray(result?.successful) ? result.successful.length : 0;
      if (successfulCount <= 0) {
        return;
      }

      try {
        uppy.clear();
      } catch {
        // Upload succeeded; ignore clear timing issues.
      }
    });

    uploadUppy = uppy;
  }

  function openEditor() {
    setup();

    if (!uploadUppy) {
      onUnavailable();
      return;
    }

    const dashboard = uploadUppy.getPlugin("Dashboard");
    if (dashboard) {
      dashboard.openModal();
    }
  }

  function destroy() {
    if (!uploadUppy) {
      return;
    }

    uploadUppy.destroy();
    uploadUppy = null;
  }

  return Object.freeze({
    destroy,
    openEditor,
    setup
  });
}

export { createImageUploadRuntime };
