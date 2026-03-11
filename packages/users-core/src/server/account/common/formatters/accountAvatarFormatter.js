import { createHash } from "node:crypto";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { DEFAULT_USER_SETTINGS } from "../../../../shared/settings.js";

function createGravatarUrl(email, size = 64) {
  const normalizedEmail = normalizeLowerText(email);
  const hash = createHash("sha256").update(normalizedEmail).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=${Number(size) || 64}`;
}

function accountAvatarFormatter(profile, settings) {
  const size = Number(settings?.avatarSize || DEFAULT_USER_SETTINGS.avatarSize);
  const uploadedUrl = null;
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
