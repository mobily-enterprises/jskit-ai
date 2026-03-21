import { normalizeReturnToPath as normalizeSharedReturnToPath } from "@jskit-ai/kernel/shared/support";

export function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeOAuthIntent(value, { fallback = "login" } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "login" || normalized === "link") {
    return normalized;
  }

  return fallback;
}

export function normalizeReturnToPath(value, { fallback = "/", allowedOrigins = [] } = {}) {
  return normalizeSharedReturnToPath(value, {
    fallback,
    allowedOrigins
  });
}
