import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { resolveUserProfile } from "../common/services/accountContextService.js";

const DEFAULT_AVATAR_POLICY = Object.freeze({
  allowedMimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  maxUploadBytes: 5 * 1024 * 1024
});

function resolveAvatarPolicy(policy = {}) {
  const source = policy && typeof policy === "object" ? policy : {};
  const allowedMimeTypes =
    Array.isArray(source.allowedMimeTypes) && source.allowedMimeTypes.length > 0
      ? source.allowedMimeTypes
          .map((value) => String(value || "").trim().toLowerCase())
          .filter((value) => value.length > 0)
      : [...DEFAULT_AVATAR_POLICY.allowedMimeTypes];
  const normalizedMaxUploadBytes = Number(source.maxUploadBytes);
  const maxUploadBytes =
    Number.isInteger(normalizedMaxUploadBytes) && normalizedMaxUploadBytes > 0
      ? normalizedMaxUploadBytes
      : DEFAULT_AVATAR_POLICY.maxUploadBytes;

  return Object.freeze({
    allowedMimeTypes: Object.freeze(allowedMimeTypes),
    maxUploadBytes
  });
}

async function readAvatarBuffer(stream, { maxBytes = DEFAULT_AVATAR_POLICY.maxUploadBytes } = {}) {
  if (!stream || typeof stream.on !== "function") {
    throw new TypeError("Avatar upload stream is required.");
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.length;

    if (total > maxBytes) {
      throw createValidationError({
        avatar: `Avatar file is too large. Maximum allowed size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`
      });
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    throw createValidationError({
      avatar: "Avatar file is empty."
    });
  }

  return Buffer.concat(chunks);
}

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
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
    const mimeType = normalizeMimeType(payload?.mimeType);
    if (!resolvedAvatarPolicy.allowedMimeTypes.includes(mimeType)) {
      throw createValidationError({
        avatar: `Avatar must be one of: ${resolvedAvatarPolicy.allowedMimeTypes.join(", ")}.`
      });
    }

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
