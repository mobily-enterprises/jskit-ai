import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { DEFAULT_IMAGE_UPLOAD_POLICY } from "@jskit-ai/uploads-runtime/shared";
import {
  normalizeUploadPolicy,
  readUploadBuffer,
  validateUploadMimeType
} from "@jskit-ai/uploads-runtime/server/policy/uploadPolicy";
import { resolveUserProfile } from "../common/services/accountContextService.js";

const DEFAULT_AVATAR_POLICY = DEFAULT_IMAGE_UPLOAD_POLICY;

function resolveAvatarPolicy(policy = {}) {
  return normalizeUploadPolicy(policy, DEFAULT_AVATAR_POLICY);
}

async function readAvatarBuffer(stream, { maxBytes = DEFAULT_AVATAR_POLICY.maxUploadBytes } = {}) {
  return readUploadBuffer(stream, {
    maxBytes,
    fieldName: "avatar",
    label: "Avatar"
  });
}

function createService({ usersRepository, avatarStorageService, avatarPolicy } = {}) {
  if (!usersRepository) {
    throw new TypeError("avatarService requires usersRepository.");
  }
  if (!avatarStorageService) {
    throw new TypeError("avatarService requires avatarStorageService.");
  }

  const resolvedAvatarPolicy = resolveAvatarPolicy(avatarPolicy);

  async function resolveProfile(user) {
    const profile = await resolveUserProfile(usersRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }
    return profile;
  }

  async function uploadForUser(user, payload = {}) {
    const profile = await resolveProfile(user);
    validateUploadMimeType(payload?.mimeType, resolvedAvatarPolicy, {
      fieldName: "avatar",
      label: "Avatar"
    });

    const buffer = await readAvatarBuffer(payload.stream, {
      maxBytes: resolvedAvatarPolicy.maxUploadBytes
    });

    const avatarVersionMs = Date.now();
    const avatarVersion = String(avatarVersionMs);
    const savedAvatar = await avatarStorageService.saveAvatar({
      userId: profile.id,
      buffer
    });

    const updatedProfile = await usersRepository.updateAvatarById(profile.id, {
      avatarStorageKey: savedAvatar.storageKey,
      avatarVersion,
      avatarUpdatedAt: new Date(avatarVersionMs)
    });

    return Object.freeze({
      profile: updatedProfile
    });
  }

  async function clearForUser(user) {
    const profile = await resolveProfile(user);
    if (profile.avatarStorageKey) {
      await avatarStorageService.deleteAvatar(profile.avatarStorageKey);
    }
    return usersRepository.clearAvatarById(profile.id);
  }

  async function readForUser(user) {
    const profile = await resolveProfile(user);
    if (!profile.avatarStorageKey) {
      return null;
    }

    return avatarStorageService.readAvatar(profile.avatarStorageKey);
  }

  return Object.freeze({
    uploadForUser,
    clearForUser,
    readForUser
  });
}

const __testables = Object.freeze({
  resolveAvatarPolicy,
  readAvatarBuffer
});

export { createService, __testables };
