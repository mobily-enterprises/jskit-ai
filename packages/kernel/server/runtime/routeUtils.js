import { AppError } from "./errors.js";
import { defaultMissingHandler } from "../support/defaultMissingHandler.js";

function normalizeIdempotencyKey(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function requireIdempotencyKey(request) {
  const idempotencyKey = normalizeIdempotencyKey(request?.headers?.["idempotency-key"]);
  if (!idempotencyKey) {
    throw new AppError(400, "Idempotency-Key header is required.", {
      code: "IDEMPOTENCY_KEY_REQUIRED"
    });
  }

  return idempotencyKey;
}

export { defaultMissingHandler, normalizeIdempotencyKey, requireIdempotencyKey };
