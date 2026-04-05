import {
  DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  DEFAULT_IMAGE_UPLOAD_MAX_BYTES
} from "./imageUploadDefaults.js";

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAllowedMimeTypes(values = [], fallback = []) {
  const source = Array.isArray(values) ? values : [];
  const normalized = source
    .map(normalizeMimeType)
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);

  if (normalized.length > 0) {
    return Object.freeze(normalized);
  }

  const fallbackValues = Array.isArray(fallback) ? fallback : [];
  return Object.freeze(
    fallbackValues
      .map(normalizeMimeType)
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
  );
}

function normalizeMaxUploadBytes(value, fallback = DEFAULT_IMAGE_UPLOAD_MAX_BYTES) {
  const normalized = Number(value);
  if (Number.isInteger(normalized) && normalized > 0) {
    return normalized;
  }

  return Number.isInteger(fallback) && fallback > 0 ? fallback : DEFAULT_IMAGE_UPLOAD_MAX_BYTES;
}

function normalizeUploadPolicy(policy = {}, defaults = {}) {
  const source = policy && typeof policy === "object" ? policy : {};
  const fallback = defaults && typeof defaults === "object" ? defaults : {};

  return Object.freeze({
    allowedMimeTypes: normalizeAllowedMimeTypes(source.allowedMimeTypes, fallback.allowedMimeTypes),
    maxUploadBytes: normalizeMaxUploadBytes(source.maxUploadBytes, fallback.maxUploadBytes)
  });
}

const DEFAULT_IMAGE_UPLOAD_POLICY = Object.freeze({
  allowedMimeTypes: DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  maxUploadBytes: DEFAULT_IMAGE_UPLOAD_MAX_BYTES
});

export {
  DEFAULT_IMAGE_UPLOAD_ALLOWED_MIME_TYPES,
  DEFAULT_IMAGE_UPLOAD_MAX_BYTES,
  DEFAULT_IMAGE_UPLOAD_POLICY,
  normalizeAllowedMimeTypes,
  normalizeMaxUploadBytes,
  normalizeMimeType,
  normalizeUploadPolicy
};
