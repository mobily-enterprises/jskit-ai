import { createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  DEFAULT_IMAGE_UPLOAD_POLICY,
  normalizeMimeType,
  normalizeUploadPolicy
} from "../../shared/uploadPolicy.js";

function createUploadFieldError(fieldName, message) {
  const normalizedFieldName = String(fieldName || "").trim() || "file";
  return createValidationError({
    [normalizedFieldName]: String(message || "").trim() || "Upload is invalid."
  });
}

async function readUploadBuffer(
  stream,
  {
    maxBytes = DEFAULT_IMAGE_UPLOAD_POLICY.maxUploadBytes,
    fieldName = "file",
    label = "File"
  } = {}
) {
  if (!stream || typeof stream.on !== "function") {
    throw new TypeError("Upload stream is required.");
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of stream) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bufferChunk.length;

    if (total > maxBytes) {
      throw createUploadFieldError(
        fieldName,
        `${label} file is too large. Maximum allowed size is ${Math.floor(maxBytes / (1024 * 1024))}MB.`
      );
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    throw createUploadFieldError(fieldName, `${label} file is empty.`);
  }

  return Buffer.concat(chunks);
}

function validateUploadMimeType(
  mimeType,
  policy = DEFAULT_IMAGE_UPLOAD_POLICY,
  {
    fieldName = "file",
    label = "File"
  } = {}
) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const resolvedPolicy = normalizeUploadPolicy(policy);
  if (resolvedPolicy.allowedMimeTypes.length > 0 && !resolvedPolicy.allowedMimeTypes.includes(normalizedMimeType)) {
    throw createUploadFieldError(
      fieldName,
      `${label} must be one of: ${resolvedPolicy.allowedMimeTypes.join(", ")}.`
    );
  }

  return normalizedMimeType;
}

export {
  createUploadFieldError,
  normalizeUploadPolicy,
  readUploadBuffer,
  validateUploadMimeType
};
