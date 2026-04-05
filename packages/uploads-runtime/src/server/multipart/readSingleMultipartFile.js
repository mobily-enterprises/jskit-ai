import { createUploadFieldError } from "../policy/uploadPolicy.js";

function normalizeFieldName(value) {
  return String(value || "").trim();
}

function resolveFieldName(options = {}) {
  const normalizedFieldName = normalizeFieldName(options.fieldName);
  if (normalizedFieldName) {
    return normalizedFieldName;
  }

  const fieldNames = Array.isArray(options.fieldNames) ? options.fieldNames : [];
  if (fieldNames.length !== 1) {
    return "";
  }

  return normalizeFieldName(fieldNames[0]);
}

function resolveMaxBytes(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
}

function formatMaxSizeMb(maxBytes) {
  return Math.floor(maxBytes / (1024 * 1024));
}

function isMultipartError(error, code) {
  return String(error?.code || "").trim().toUpperCase() === String(code || "").trim().toUpperCase();
}

async function readSingleMultipartFile(request, options = {}) {
  if (!request || typeof request.file !== "function") {
    throw new TypeError("readSingleMultipartFile requires a request with file().");
  }

  const normalizedFieldName = resolveFieldName(options);
  const normalizedFieldErrorKey =
    normalizeFieldName(options.fieldErrorKey) || normalizedFieldName || "file";
  const normalizedLabel = normalizeFieldName(options.label) || "File";
  const normalizedMaxBytes = resolveMaxBytes(options.maxBytes);

  let filePart = null;

  try {
    filePart = await request.file({
      throwFileSizeLimit: true,
      limits: {
        files: 1,
        ...(normalizedMaxBytes > 0 ? { fileSize: normalizedMaxBytes } : {})
      }
    });
  } catch (error) {
    if (isMultipartError(error, "FST_REQ_FILE_TOO_LARGE") && normalizedMaxBytes > 0) {
      throw createUploadFieldError(
        normalizedFieldErrorKey,
        `${normalizedLabel} file is too large. Maximum allowed size is ${formatMaxSizeMb(normalizedMaxBytes)}MB.`
      );
    }

    if (isMultipartError(error, "FST_FILES_LIMIT")) {
      throw createUploadFieldError(normalizedFieldErrorKey, `${normalizedLabel} upload allows only one file.`);
    }

    throw error;
  }

  if (!filePart) {
    if (options.required === true) {
      throw createUploadFieldError(normalizedFieldErrorKey, `${normalizedLabel} file is required.`);
    }
    return null;
  }

  const actualFieldName = normalizeFieldName(filePart.fieldname);
  if (normalizedFieldName && actualFieldName && actualFieldName !== normalizedFieldName) {
    if (filePart.file && typeof filePart.file.resume === "function") {
      filePart.file.resume();
    }
    throw createUploadFieldError(
      normalizedFieldErrorKey,
      `${normalizedLabel} field "${actualFieldName}" is not allowed.`
    );
  }

  return Object.freeze({
    fieldName: actualFieldName,
    fileName: normalizeFieldName(filePart.filename),
    mimeType: normalizeFieldName(filePart.mimetype).toLowerCase(),
    encoding: normalizeFieldName(filePart.encoding).toLowerCase(),
    stream: filePart.file,
    fields: filePart.fields && typeof filePart.fields === "object" ? filePart.fields : {}
  });
}

export { readSingleMultipartFile };
