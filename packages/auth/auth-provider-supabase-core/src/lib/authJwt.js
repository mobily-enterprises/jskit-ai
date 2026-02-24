import { isTransientAuthMessage } from "./authErrorMappers.js";

const INVALID_JWT_ERROR_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_INVALID",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY"
]);

const TRANSIENT_JWT_ERROR_CODES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JOSE_GENERIC", "ERR_JWKS_INVALID"]);

let joseImportPromise = null;
function loadJose() {
  if (!joseImportPromise) {
    joseImportPromise = import("jose");
  }
  return joseImportPromise;
}

function isExpiredJwtError(error) {
  const code = String(error?.code || "");
  const name = String(error?.name || "");
  return code === "ERR_JWT_EXPIRED" || name === "JWTExpired";
}

function classifyJwtVerifyError(error) {
  if (isExpiredJwtError(error)) {
    return "expired";
  }

  const code = String(error?.code || "");
  if (INVALID_JWT_ERROR_CODES.has(code)) {
    return "invalid";
  }

  if (TRANSIENT_JWT_ERROR_CODES.has(code)) {
    return "transient";
  }

  if (isTransientAuthMessage(error?.message)) {
    return "transient";
  }

  return "invalid";
}

export { loadJose, isExpiredJwtError, classifyJwtVerifyError };
