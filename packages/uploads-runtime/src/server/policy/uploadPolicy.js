import { createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  DEFAULT_IMAGE_UPLOAD_POLICY,
  normalizeMimeType,
  normalizeUploadPolicy
} from "../../shared/uploadPolicy.js";

// message is the English text; code and params let a client show it in the
// user's language. The label param stays the caller's own word ("Avatar").
function createUploadFieldError(fieldName, message, { code = "", params = {} } = {}) {
  const normalizedFieldName = String(fieldName || "").trim() || "file";
  const normalizedMessage = String(message || "").trim();
  return createValidationError({
    [normalizedFieldName]: normalizedMessage
      ? { code, params, message: normalizedMessage }
      : { code: "uploads.file.invalid", params: {}, message: "Upload is invalid." }
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
      const maxMb = Math.floor(maxBytes / (1024 * 1024));
      throw createUploadFieldError(
        fieldName,
        `${label} file is too large. Maximum allowed size is ${maxMb}MB.`,
        { code: "uploads.file.tooLarge", params: { label, maxMb } }
      );
    }

    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    throw createUploadFieldError(fieldName, `${label} file is empty.`, {
      code: "uploads.file.empty",
      params: { label }
    });
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
    const types = resolvedPolicy.allowedMimeTypes.join(", ");
    throw createUploadFieldError(fieldName, `${label} must be one of: ${types}.`, {
      code: "uploads.file.typeNotAllowed",
      params: { label, types }
    });
  }

  return normalizedMimeType;
}

export {
  createUploadFieldError,
  normalizeUploadPolicy,
  readUploadBuffer,
  validateUploadMimeType
};
