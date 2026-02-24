const DEFAULT_AVATAR_UPLOAD_POLICY = Object.freeze({
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  maxUploadBytes: 5 * 1024 * 1024,
  uploadDimensionOptions: [128, 256, 384, 512],
  defaultUploadDimension: 256
});

function normalizeStringArray(values, fallback) {
  if (!Array.isArray(values)) {
    return [...fallback];
  }

  const normalized = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveIntegerArray(values, fallback) {
  if (!Array.isArray(values)) {
    return [...fallback];
  }

  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeAvatarUploadPolicy(policy = {}) {
  const source = policy && typeof policy === "object" ? policy : {};
  return {
    allowedMimeTypes: normalizeStringArray(source.allowedMimeTypes, DEFAULT_AVATAR_UPLOAD_POLICY.allowedMimeTypes),
    maxUploadBytes: normalizePositiveInteger(source.maxUploadBytes, DEFAULT_AVATAR_UPLOAD_POLICY.maxUploadBytes),
    uploadDimensionOptions: normalizePositiveIntegerArray(
      source.uploadDimensionOptions,
      DEFAULT_AVATAR_UPLOAD_POLICY.uploadDimensionOptions
    ),
    defaultUploadDimension: normalizePositiveInteger(
      source.defaultUploadDimension,
      DEFAULT_AVATAR_UPLOAD_POLICY.defaultUploadDimension
    )
  };
}

export { DEFAULT_AVATAR_UPLOAD_POLICY, normalizeAvatarUploadPolicy };
