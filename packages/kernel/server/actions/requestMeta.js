import { normalizeText } from "../../shared/support/normalize.js";

const TEXT_FIELDS = Object.freeze(["requestId", "commandId", "idempotencyKey", "ip", "userAgent"]);

function normalizeRequestMeta(requestMeta = {}) {
  const source = requestMeta && typeof requestMeta === "object" ? requestMeta : {};
  const normalized = {
    ...source,
    request: source.request || null
  };
  for (const field of TEXT_FIELDS) {
    normalized[field] = normalizeText(source[field]);
  }
  return normalized;
}

export { normalizeRequestMeta };
