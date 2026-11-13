import { normalizeReturnToPath as normalizeSharedReturnToPath } from "@jskit-ai/kernel/shared/support";

const HOST_ONLY_COOKIE_PREFIX = "__Host-";

/**
 * Secure (HTTPS) cookies carry the __Host- prefix: the browser then requires
 * Secure, Path=/ and no Domain, so a sibling host under the same parent domain
 * can neither set nor overwrite them (no cookie tossing or session fixation).
 */
export function hostOnlyCookieName(name, secure) {
  const cookieName = String(name || "").trim();
  return secure && !cookieName.startsWith(HOST_ONLY_COOKIE_PREFIX) ? `${HOST_ONLY_COOKIE_PREFIX}${cookieName}` : cookieName;
}

/**
 * AUTH_COOKIE_SAME_SITE: the SameSite attribute of the sign-in cookies, `lax`
 * (when unset or blank) or `strict`. Anything else stops startup.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @returns {"lax" | "strict"}
 */
export function resolveAuthCookieSameSite(env) {
  const value = String(env.AUTH_COOKIE_SAME_SITE ?? "").trim().toLowerCase();
  if (!value) return "lax";
  if (value === "lax" || value === "strict") return value;
  throw new Error(`AUTH_COOKIE_SAME_SITE must be lax or strict, not "${env.AUTH_COOKIE_SAME_SITE}".`);
}

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
