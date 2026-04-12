import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createUploadStorageService,
  detectCommonMimeTypeFromBuffer
} from "@jskit-ai/uploads-runtime/server/storage/createUploadStorageService";

const AVATAR_STORAGE_PREFIX = "users/avatars";

function buildAvatarStorageKey(userId) {
  const normalizedUserId = normalizeRecordId(userId, { fallback: null });
  if (!normalizedUserId) {
    throw new TypeError("Avatar storage requires a valid user id.");
  }

  return `${AVATAR_STORAGE_PREFIX}/${normalizedUserId}/avatar`;
}

function createService({ storage } = {}) {
  const uploadStorageService = createUploadStorageService({
    storage,
    mimeTypeDetector: detectCommonMimeTypeFromBuffer
  });

  async function saveAvatar({ userId, buffer }) {
    return uploadStorageService.saveFile({
      storageKey: buildAvatarStorageKey(userId),
      buffer
    });
  }

  async function readAvatar(storageKey) {
    return uploadStorageService.readFile(storageKey);
  }

  async function deleteAvatar(storageKey) {
    await uploadStorageService.deleteFile(storageKey);
  }

  return Object.freeze({
    saveAvatar,
    readAvatar,
    deleteAvatar
  });
}

const __testables = Object.freeze({
  buildAvatarStorageKey,
  detectAvatarMimeTypeFromBuffer: detectCommonMimeTypeFromBuffer
});

export { createService, __testables };
