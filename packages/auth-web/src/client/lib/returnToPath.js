import { normalizeReturnToPath as normalizeSharedReturnToPath } from "@jskit-ai/kernel/shared/support";

const AUTH_LOOP_PATHNAMES = Object.freeze(["/auth/login", "/auth/signout"]);

function normalizeAuthReturnToPath(value, fallback = "/", { allowedOrigins = [] } = {}) {
  return normalizeSharedReturnToPath(value, {
    fallback,
    allowedOrigins,
    blockedPathnames: AUTH_LOOP_PATHNAMES
  });
}

export { normalizeAuthReturnToPath };
