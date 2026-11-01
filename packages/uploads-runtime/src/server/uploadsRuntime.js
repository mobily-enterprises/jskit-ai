import { readSingleMultipartFile } from "./multipart/readSingleMultipartFile.js";
import {
  createUploadFieldError,
  readUploadBuffer,
  validateUploadMimeType
} from "./policy/uploadPolicy.js";
import {
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer,
  normalizeStorageKey
} from "./storage/createUploadStorageService.js";

/** The upload operations features reach through the `runtime.uploads` capability. */
function createUploadsRuntime() {
  return Object.freeze({
    readSingleMultipartFile,
    createUploadFieldError,
    readUploadBuffer,
    validateUploadMimeType,
    createUploadStorageService,
    detectCommonMimeTypeFromBuffer,
    normalizeStorageKey
  });
}

export { createUploadsRuntime };
