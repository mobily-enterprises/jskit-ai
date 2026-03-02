import { AppError } from "./errors.js";

function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Endpoint is not available in this server wiring."
  });
}

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
