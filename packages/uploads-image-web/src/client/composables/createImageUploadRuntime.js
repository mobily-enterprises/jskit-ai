import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import {
  DEFAULT_IMAGE_COMPRESSOR_OPTIONS,
  DEFAULT_IMAGE_DASHBOARD_OPTIONS,
  DEFAULT_IMAGE_EDITOR_OPTIONS,
  DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  DEFAULT_IMAGE_UPLOAD_MAX_BYTES
} from "../../shared/imageUploadDefaults.js";
import { parseUploadResponse } from "../support/parseUploadResponse.js";
import { stopImageEditor } from "../support/stopImageEditor.js";

function normalizeObject(value) {
  return value && typeof value === "object" ? value : {};
}

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
  resolveRequestHeaders = null,
  onSelectedFileNameChanged = null,
  onUploadSuccess = null,
  onInvalidResponse = null,
  onUploadError = null,
  onRestrictionFailed = null,
  onUnavailable = null,
  dependencies = {}
} = {}) {
  const UppyClass = dependencies.UppyClass || Uppy;
  const DashboardPlugin = dependencies.DashboardPlugin || Dashboard;
  const ImageEditorPlugin = dependencies.ImageEditorPlugin || ImageEditor;
  const CompressorPlugin = dependencies.CompressorPlugin || Compressor;
  const XHRUploadPlugin = dependencies.XHRUploadPlugin || XHRUpload;
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
    `Accepted: ${normalizedAllowedMimeTypes.join(", ")}, max ${Math.floor(normalizedMaxUploadBytes / (1024 * 1024))}MB`;

  function emitSelectedFileName(fileName) {
    if (typeof onSelectedFileNameChanged === "function") {
      onSelectedFileNameChanged(String(fileName || ""));
    }
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
        const dashboard = uppy.getPlugin("Dashboard");
        if (dashboard && typeof dashboard.closeModal === "function") {
          dashboard.closeModal();
        }
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
        const headers =
          typeof resolveRequestHeaders === "function"
            ? normalizeObject(await resolveRequestHeaders({ xhr, uppy }))
            : {};
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
        if (typeof onInvalidResponse === "function") {
          onInvalidResponse({
            file,
            response,
            uppy
          });
        }
        return;
      }

      if (typeof onUploadSuccess === "function") {
        onUploadSuccess({
          data,
          file,
          response,
          uppy
        });
      }

      emitSelectedFileName("");
    });

    uppy.on("upload-error", (file, error, response) => {
      if (typeof onUploadError === "function") {
        onUploadError({
          file,
          error,
          response,
          uppy
        });
      }
    });

    uppy.on("restriction-failed", (file, error) => {
      if (typeof onRestrictionFailed === "function") {
        onRestrictionFailed({
          file,
          error,
          uppy
        });
      }
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

    const uppy = uploadUppy;
    if (!uppy) {
      if (typeof onUnavailable === "function") {
        onUnavailable();
      }
      return;
    }

    const dashboard = uppy.getPlugin("Dashboard");
    if (dashboard && typeof dashboard.openModal === "function") {
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
