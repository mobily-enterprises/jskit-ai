// The type of the `auth.web` capability, for features that require it, and of the auth routes' rate limits.

/** @typedef {ReturnType<typeof import("./authWeb.js").createAuthWeb>} AuthWeb */

/**
 * The per-address limit of each auth route; null for a route without one.
 * @typedef {ReturnType<typeof import("./authRateLimits.js").resolveAuthRateLimits>} AuthRateLimits
 */

export {};
