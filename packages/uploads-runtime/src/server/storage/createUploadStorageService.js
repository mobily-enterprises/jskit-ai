const MIME_TYPE_JPEG = "image/jpeg";
const MIME_TYPE_PNG = "image/png";
const MIME_TYPE_WEBP = "image/webp";
const MIME_TYPE_FALLBACK = "application/octet-stream";

function normalizeStorageKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("/") || normalized.includes("..")) {
    return "";
  }
  return normalized;
}

function detectCommonMimeTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return MIME_TYPE_FALLBACK;
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return MIME_TYPE_JPEG;
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return MIME_TYPE_PNG;
  }

  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return MIME_TYPE_WEBP;
  }

  return MIME_TYPE_FALLBACK;
}

function createUploadStorageService({ storage, mimeTypeDetector = detectCommonMimeTypeFromBuffer } = {}) {
  if (!storage || typeof storage.getItemRaw !== "function" || typeof storage.setItemRaw !== "function") {
    throw new TypeError("createUploadStorageService requires a storage binding with getItemRaw()/setItemRaw().");
  }

  async function saveFile({ storageKey, buffer }) {
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    if (!normalizedStorageKey) {
      throw new TypeError("Upload storage key is required.");
    }
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError("Upload buffer must be a Buffer instance.");
    }

    await storage.setItemRaw(normalizedStorageKey, buffer);
    return Object.freeze({
      storageKey: normalizedStorageKey
    });
  }

  async function readFile(storageKey) {
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    if (!normalizedStorageKey) {
      return null;
    }

    const value = await storage.getItemRaw(normalizedStorageKey);
    if (value == null) {
      return null;
    }

    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Object.freeze({
      storageKey: normalizedStorageKey,
      buffer,
      mimeType: mimeTypeDetector(buffer)
    });
  }

  async function deleteFile(storageKey) {
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    if (!normalizedStorageKey || typeof storage.removeItem !== "function") {
      return;
    }

    await storage.removeItem(normalizedStorageKey);
  }

  return Object.freeze({
    saveFile,
    readFile,
    deleteFile
  });
}

export {
  MIME_TYPE_FALLBACK,
  MIME_TYPE_JPEG,
  MIME_TYPE_PNG,
  MIME_TYPE_WEBP,
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer,
  normalizeStorageKey
};
