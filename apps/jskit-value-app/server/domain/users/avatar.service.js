import { createHash } from "node:crypto";
import sharp from "sharp";
import { AppError } from "../../lib/errors.js";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_SIZE,
  AVATAR_DEFAULT_UPLOAD_DIMENSION,
  AVATAR_MAX_SIZE,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_MIN_SIZE,
  AVATAR_UPLOAD_DIMENSION_OPTIONS
} from "../../../shared/avatar/index.js";

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function normalizeUploadDimension(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !AVATAR_UPLOAD_DIMENSION_OPTIONS.includes(parsed)) {
    return AVATAR_DEFAULT_UPLOAD_DIMENSION;
  }

  return parsed;
}

function normalizeAvatarSize(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return AVATAR_DEFAULT_SIZE;
  }

  if (parsed < AVATAR_MIN_SIZE) {
    return AVATAR_MIN_SIZE;
  }

  if (parsed > AVATAR_MAX_SIZE) {
    return AVATAR_MAX_SIZE;
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

async function readAvatarBuffer(stream, { maxBytes = AVATAR_MAX_UPLOAD_BYTES } = {}) {
  if (!stream || typeof stream.on !== "function") {
    throw new TypeError("Avatar upload stream is required.");
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.length;

    if (total > maxBytes) {
      throw validationError({
        avatar: `Avatar file is too large. Maximum allowed size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`
      });
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    throw validationError({
      avatar: "Avatar file is empty."
    });
  }

  return Buffer.concat(chunks);
}

function buildAvatarResponse(profile, { avatarStorageService, avatarSize }) {
  const normalizedSize = normalizeAvatarSize(avatarSize);
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

function createService({ userProfilesRepository, avatarStorageService }) {
  function serviceBuildAvatarResponse(profile, { avatarSize }) {
    return buildAvatarResponse(profile, {
      avatarStorageService,
      avatarSize
    });
  }

  async function uploadForUser(user, payload) {
    const mimeType = String(payload?.mimeType || "").toLowerCase();
    if (!AVATAR_ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw validationError({
        avatar: `Avatar must be one of: ${AVATAR_ALLOWED_MIME_TYPES.join(", ")}.`
      });
    }

    const uploadDimension = normalizeUploadDimension(payload?.uploadDimension);
    const inputBuffer = await readAvatarBuffer(payload.stream, {
      maxBytes: AVATAR_MAX_UPLOAD_BYTES
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
    const profile = await userProfilesRepository.findBySupabaseUserId(user.supabaseUserId);
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
  normalizeUploadDimension,
  normalizeAvatarSize,
  normalizeEmailForHash,
  createGravatarUrl,
  readAvatarBuffer,
  buildAvatarResponse
};

export { createService, __testables };
