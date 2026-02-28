import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError, createValidationError } from "@jskit-ai/server-runtime-core/errors";
import { resolveProfileIdentity } from "./profileIdentity.js";

const DEFAULT_AVATAR_POLICY = Object.freeze({
  allowedMimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  maxUploadBytes: 5 * 1024 * 1024,
  uploadDimensionOptions: Object.freeze([128, 256, 384, 512]),
  defaultUploadDimension: 256,
  size: Object.freeze({
    min: 32,
    max: 128,
    default: 64
  })
});

function resolveAvatarPolicy(policy = {}) {
  const source = policy && typeof policy === "object" ? policy : {};
  const sourceSize = source.size && typeof source.size === "object" ? source.size : {};

  const allowedMimeTypes =
    Array.isArray(source.allowedMimeTypes) && source.allowedMimeTypes.length > 0
      ? source.allowedMimeTypes
          .map((value) => String(value || "").trim().toLowerCase())
          .filter((value) => value.length > 0)
      : [...DEFAULT_AVATAR_POLICY.allowedMimeTypes];

  const uploadDimensionOptions =
    Array.isArray(source.uploadDimensionOptions) && source.uploadDimensionOptions.length > 0
      ? source.uploadDimensionOptions
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : [...DEFAULT_AVATAR_POLICY.uploadDimensionOptions];

  const normalizedMaxUploadBytes = Number(source.maxUploadBytes);
  const maxUploadBytes =
    Number.isInteger(normalizedMaxUploadBytes) && normalizedMaxUploadBytes > 0
      ? normalizedMaxUploadBytes
      : DEFAULT_AVATAR_POLICY.maxUploadBytes;

  const normalizedDefaultUploadDimension = Number(source.defaultUploadDimension);
  const defaultUploadDimension =
    Number.isInteger(normalizedDefaultUploadDimension) && uploadDimensionOptions.includes(normalizedDefaultUploadDimension)
      ? normalizedDefaultUploadDimension
      : DEFAULT_AVATAR_POLICY.defaultUploadDimension;

  const normalizedMinSize = Number(sourceSize.min);
  const minSize =
    Number.isInteger(normalizedMinSize) && normalizedMinSize > 0 ? normalizedMinSize : DEFAULT_AVATAR_POLICY.size.min;

  const normalizedMaxSize = Number(sourceSize.max);
  const maxSizeCandidate =
    Number.isInteger(normalizedMaxSize) && normalizedMaxSize >= minSize ? normalizedMaxSize : DEFAULT_AVATAR_POLICY.size.max;
  const maxSize = Math.max(minSize, maxSizeCandidate);

  const normalizedDefaultSize = Number(sourceSize.default);
  const defaultSizeCandidate =
    Number.isInteger(normalizedDefaultSize) && normalizedDefaultSize > 0
      ? normalizedDefaultSize
      : DEFAULT_AVATAR_POLICY.size.default;
  const defaultSize = Math.min(maxSize, Math.max(minSize, defaultSizeCandidate));

  return {
    allowedMimeTypes,
    maxUploadBytes,
    uploadDimensionOptions,
    defaultUploadDimension,
    size: {
      min: minSize,
      max: maxSize,
      default: defaultSize
    }
  };
}

function normalizeUploadDimension(value, avatarPolicy = DEFAULT_AVATAR_POLICY) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !avatarPolicy.uploadDimensionOptions.includes(parsed)) {
    return avatarPolicy.defaultUploadDimension;
  }

  return parsed;
}

function normalizeAvatarSize(value, avatarPolicy = DEFAULT_AVATAR_POLICY) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return avatarPolicy.size.default;
  }

  if (parsed < avatarPolicy.size.min) {
    return avatarPolicy.size.min;
  }

  if (parsed > avatarPolicy.size.max) {
    return avatarPolicy.size.max;
  }

  return parsed;
}

function normalizeEmailForHash(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function createGravatarUrl(email, size) {
  const normalizedEmail = normalizeEmailForHash(email);
  const hash = createHash("sha256").update(normalizedEmail).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=${size}`;
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

function buildAvatarResponse(profile, { avatarStorageService, avatarSize, avatarPolicy = DEFAULT_AVATAR_POLICY }) {
  const normalizedSize = normalizeAvatarSize(avatarSize, avatarPolicy);
  const uploadedUrl = avatarStorageService.toPublicUrl(profile.avatarStorageKey, profile.avatarVersion);
  const gravatarUrl = createGravatarUrl(profile.email, normalizedSize);

  return {
    uploadedUrl,
    gravatarUrl,
    effectiveUrl: uploadedUrl || gravatarUrl,
    hasUploadedAvatar: Boolean(uploadedUrl),
    size: normalizedSize,
    version: profile.avatarVersion || null
  };
}

function createService({ userProfilesRepository, avatarStorageService, avatarPolicy } = {}) {
  const resolvedAvatarPolicy = resolveAvatarPolicy(avatarPolicy);

  function serviceBuildAvatarResponse(profile, { avatarSize }) {
    return buildAvatarResponse(profile, {
      avatarStorageService,
      avatarSize,
      avatarPolicy: resolvedAvatarPolicy
    });
  }

  async function uploadForUser(user, payload) {
    const mimeType = String(payload?.mimeType || "").toLowerCase();
    if (!resolvedAvatarPolicy.allowedMimeTypes.includes(mimeType)) {
      throw validationError({
        avatar: `Avatar must be one of: ${resolvedAvatarPolicy.allowedMimeTypes.join(", ")}.`
      });
    }

    const uploadDimension = normalizeUploadDimension(payload?.uploadDimension, resolvedAvatarPolicy);
    const inputBuffer = await readAvatarBuffer(payload.stream, {
      maxBytes: resolvedAvatarPolicy.maxUploadBytes
    });

    let processed;
    try {
      processed = await sharp(inputBuffer, {
        failOnError: true
      })
        .rotate()
        .resize(uploadDimension, uploadDimension, {
          fit: "cover",
          position: "center"
        })
        .webp({
          quality: 86,
          effort: 4
        })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw validationError({
        avatar: "Avatar image could not be processed. Upload a valid image file."
      });
    }

    const avatarVersion = Date.now();
    const saved = await avatarStorageService.saveAvatar({
      userId: user.id,
      buffer: processed.data,
      avatarVersion
    });

    const updatedProfile = await userProfilesRepository.updateAvatarById(user.id, {
      avatarStorageKey: saved.storageKey,
      avatarVersion: saved.avatarVersion,
      avatarUpdatedAt: new Date(avatarVersion)
    });

    return {
      profile: updatedProfile,
      image: {
        mimeType: "image/webp",
        bytes: processed.info?.size || processed.data.length,
        width: processed.info?.width || uploadDimension,
        height: processed.info?.height || uploadDimension
      }
    };
  }

  async function clearForUser(user) {
    const identity = resolveProfileIdentity(user);
    if (!identity) {
      throw new AppError(404, "User profile was not found.");
    }
    if (typeof userProfilesRepository.findByIdentity !== "function") {
      throw new Error("userProfilesRepository.findByIdentity is required.");
    }
    const profile = await userProfilesRepository.findByIdentity(identity);

    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    if (profile.avatarStorageKey) {
      await avatarStorageService.deleteAvatar(profile.avatarStorageKey);
    }

    const updatedProfile = await userProfilesRepository.clearAvatarById(profile.id);
    return updatedProfile;
  }

  return {
    uploadForUser,
    clearForUser,
    buildAvatarResponse: serviceBuildAvatarResponse
  };
}

const __testables = {
  validationError,
  resolveAvatarPolicy,
  normalizeUploadDimension,
  normalizeAvatarSize,
  normalizeEmailForHash,
  createGravatarUrl,
  readAvatarBuffer,
  buildAvatarResponse
};

export { createService, __testables };
