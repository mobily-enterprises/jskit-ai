import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { registerMultipartSupport } from "../multipart/registerMultipartSupport.js";
import { readSingleMultipartFile } from "../multipart/readSingleMultipartFile.js";
import {
  createUploadFieldError,
  readUploadBuffer,
  validateUploadMimeType
} from "../policy/uploadPolicy.js";
import {
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer,
  normalizeStorageKey
} from "../storage/createUploadStorageService.js";

const uploads = Object.freeze({
  readSingleMultipartFile,
  createUploadFieldError,
  readUploadBuffer,
  validateUploadMimeType,
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer,
  normalizeStorageKey
});

const UploadsProvider = defineProvider({
  id: "runtime.uploads",
  requires: {
    fastify: "runtime.fastify"
  },
  provides: {
    uploads: "runtime.uploads"
  },
  setup() {
    return { uploads };
  },
  async boot({ fastify }) {
    await registerMultipartSupport(fastify);
  }
});

export { UploadsProvider };
