import { createHash } from "node:crypto";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { DEFAULT_USER_SETTINGS } from "../../../shared/settings.js";

const ACCOUNT_AVATAR_FILE_PATH = "/api/settings/profile/avatar";

function createGravatarUrl(email, size = 64) {
  const normalizedEmail = normalizeLowerText(email);
  const hash = createHash("sha256").update(normalizedEmail).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=${Number(size) || 64}`;
}

function createUploadedAvatarUrl(profile = {}) {
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
  const uploadedUrl = createUploadedAvatarUrl(profile);
  const gravatarUrl = createGravatarUrl(profile?.email, size);

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
