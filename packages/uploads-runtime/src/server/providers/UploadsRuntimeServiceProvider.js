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

const UPLOADS_RUNTIME_SERVER_API = Object.freeze({
  registerMultipartSupport,
  readSingleMultipartFile,
  createUploadFieldError,
  readUploadBuffer,
  validateUploadMimeType,
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer,
  normalizeStorageKey
});

class UploadsRuntimeServiceProvider {
  static id = "runtime.uploads";

  static dependsOn = ["runtime.server"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("UploadsRuntimeServiceProvider requires application singleton().");
    }

    app.singleton("runtime.uploads", () => UPLOADS_RUNTIME_SERVER_API);
  }

  async boot(app) {
    await registerMultipartSupport(app);
  }
}

export { UploadsRuntimeServiceProvider };
