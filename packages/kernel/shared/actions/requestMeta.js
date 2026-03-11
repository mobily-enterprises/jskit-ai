import { normalizeText } from "./textNormalization.js";

const DEFAULT_FIELDS = Object.freeze(["requestId", "commandId", "idempotencyKey", "ip", "userAgent", "request"]);

function normalizeRequestMeta(requestMeta = {}, { fields = DEFAULT_FIELDS, emptyAsNull = false } = {}) {
  const source = requestMeta && typeof requestMeta === "object" ? requestMeta : {};
  const fieldList = Array.isArray(fields) && fields.length > 0 ? fields : DEFAULT_FIELDS;

  const normalizeValue = (value) => {
    const normalized = normalizeText(value);
    if (emptyAsNull && !normalized) {
      return null;
    }
    return normalized;
  };

  const normalized = {
    ...source
  };
  for (const field of fieldList) {
    if (field === "request") {
      normalized.request = source.request || null;
      continue;
    }
    if (field === "logger") {
      normalized.logger = source.logger && typeof source.logger.warn === "function" ? source.logger : null;
      continue;
    }

    normalized[field] = normalizeValue(source[field]);
  }

  return normalized;
}

export { normalizeRequestMeta };
