function generateIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `idem_${crypto.randomUUID()}`;
  }

  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveIdempotencyKey(options = {}, { required = false } = {}) {
  const provided = String(options?.idempotencyKey || "").trim();
  if (provided) {
    return provided;
  }
  if (required) {
    return generateIdempotencyKey();
  }
  return "";
}

function buildOptionalIdempotencyHeaders(options = {}, { required = false } = {}) {
  const idempotencyKey = resolveIdempotencyKey(options, {
    required
  });
  if (!idempotencyKey) {
    return {};
  }
  return {
    "Idempotency-Key": idempotencyKey
  };
}

export { generateIdempotencyKey, resolveIdempotencyKey, buildOptionalIdempotencyHeaders };
