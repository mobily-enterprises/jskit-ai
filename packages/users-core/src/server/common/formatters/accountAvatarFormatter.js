import { createHash } from "node:crypto";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";

const ACCOUNT_AVATAR_FILE_PATH = "/api/settings/profile/avatar";

function buildGravatarUrl(email, size) {
  const normalizedEmail = normalizeLowerText(email);
  const hash = createHash("sha256").update(normalizedEmail).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=${Number(size) || 64}`;
}

function buildUploadedAvatarUrl(profile) {
  const storageKey = String(profile?.avatarStorageKey || "").trim();
  if (!storageKey) {
    return null;
  }

  const avatarVersion = String(profile?.avatarVersion || "").trim();
  if (!avatarVersion) {
    return ACCOUNT_AVATAR_FILE_PATH;
  }

  return `${ACCOUNT_AVATAR_FILE_PATH}?v=${encodeURIComponent(avatarVersion)}`;
}

function accountAvatarFormatter(profile, settings) {
  const size = Number(settings?.avatarSize || DEFAULT_USER_SETTINGS.avatarSize);
  const uploadedUrl = buildUploadedAvatarUrl(profile);
  const gravatarUrl = buildGravatarUrl(profile?.email, size);

  return {
    uploadedUrl,
    gravatarUrl,
    effectiveUrl: uploadedUrl || gravatarUrl,
    hasUploadedAvatar: Boolean(uploadedUrl),
    size,
    version: profile?.avatarVersion || null
  };
}

export { accountAvatarFormatter };
