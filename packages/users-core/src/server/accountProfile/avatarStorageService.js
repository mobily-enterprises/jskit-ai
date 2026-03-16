const AVATAR_STORAGE_PREFIX = "users/avatars";
const AVATAR_MIME_TYPE_JPEG = "image/jpeg";
const AVATAR_MIME_TYPE_PNG = "image/png";
const AVATAR_MIME_TYPE_WEBP = "image/webp";
const AVATAR_MIME_TYPE_FALLBACK = "application/octet-stream";

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function buildAvatarStorageKey(userId) {
  const normalizedUserId = toPositiveInteger(userId);
  if (!normalizedUserId) {
    throw new TypeError("Avatar storage requires a positive integer user id.");
  }

  return `${AVATAR_STORAGE_PREFIX}/${normalizedUserId}/avatar`;
}

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

function detectAvatarMimeTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return AVATAR_MIME_TYPE_FALLBACK;
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return AVATAR_MIME_TYPE_JPEG;
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
    return AVATAR_MIME_TYPE_PNG;
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
    return AVATAR_MIME_TYPE_WEBP;
  }

  return AVATAR_MIME_TYPE_FALLBACK;
}

function createService({ storage } = {}) {
  if (!storage || typeof storage.getItemRaw !== "function" || typeof storage.setItemRaw !== "function") {
    throw new TypeError("avatarStorageService requires a storage binding with getItemRaw()/setItemRaw().");
  }

  async function saveAvatar({ userId, buffer }) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError("Avatar buffer must be a Buffer instance.");
    }

    const storageKey = buildAvatarStorageKey(userId);
    await storage.setItemRaw(storageKey, buffer);

    return Object.freeze({
      storageKey
    });
  }

  async function readAvatar(storageKey) {
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
      mimeType: detectAvatarMimeTypeFromBuffer(buffer)
    });
  }

  async function deleteAvatar(storageKey) {
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    if (!normalizedStorageKey || typeof storage.removeItem !== "function") {
      return;
    }

    await storage.removeItem(normalizedStorageKey);
  }

  return Object.freeze({
    saveAvatar,
    readAvatar,
    deleteAvatar
  });
}

const __testables = Object.freeze({
  buildAvatarStorageKey,
  detectAvatarMimeTypeFromBuffer
});

export { createService, __testables };
