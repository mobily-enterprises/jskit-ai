import {
  DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  DEFAULT_IMAGE_UPLOAD_MAX_BYTES
} from "@jskit-ai/uploads-runtime/shared";

const DEFAULT_IMAGE_EDITOR_OPTIONS = Object.freeze({
  quality: 0.9
});

const DEFAULT_IMAGE_COMPRESSOR_OPTIONS = Object.freeze({
  quality: 0.84,
  limit: 1
});

const DEFAULT_IMAGE_DASHBOARD_OPTIONS = Object.freeze({
  inline: false,
  closeAfterFinish: false,
  showProgressDetails: true,
  proudlyDisplayPoweredByUppy: false,
  hideUploadButton: false
});

export {
  DEFAULT_IMAGE_COMPRESSOR_OPTIONS,
  DEFAULT_IMAGE_DASHBOARD_OPTIONS,
  DEFAULT_IMAGE_EDITOR_OPTIONS,
  DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  DEFAULT_IMAGE_UPLOAD_MAX_BYTES
};
