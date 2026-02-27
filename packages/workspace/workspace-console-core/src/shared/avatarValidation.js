import { addFieldError, createFieldErrorBag, hasFieldErrors } from "./settingsInfra.js";

function normalizeAvatarSize(value, { min = 1, max = 1024, fallback = min } = {}) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue)) {
    return Number.isInteger(fallback) ? fallback : min;
  }

  if (numericValue < min) {
    return min;
  }

  if (numericValue > max) {
    return max;
  }

  return numericValue;
}

function isAllowedAvatarMimeType(mimeType, { allowedMimeTypes = [] } = {}) {
  if (!Array.isArray(allowedMimeTypes) || allowedMimeTypes.length === 0) {
    return false;
  }

  const normalized = String(mimeType || "")
    .trim()
    .toLowerCase();
  return allowedMimeTypes.map((entry) => String(entry || "").trim().toLowerCase()).includes(normalized);
}

function validateAvatarUpload({ mimeType, bytes } = {}, { allowedMimeTypes = [], maxBytes } = {}) {
  const fieldErrors = createFieldErrorBag();

  if (!isAllowedAvatarMimeType(mimeType, { allowedMimeTypes })) {
    addFieldError(fieldErrors, "avatar", `Avatar must be one of: ${allowedMimeTypes.join(", ")}.`);
  }

  const numericBytes = Number(bytes);
  if (Number.isFinite(Number(maxBytes)) && (!Number.isFinite(numericBytes) || numericBytes < 0 || numericBytes > maxBytes)) {
    addFieldError(fieldErrors, "avatar", `Avatar file must be at most ${Number(maxBytes)} bytes.`);
  }

  return {
    valid: !hasFieldErrors(fieldErrors),
    fieldErrors
  };
}

export { isAllowedAvatarMimeType, normalizeAvatarSize, validateAvatarUpload };
