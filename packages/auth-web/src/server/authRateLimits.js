import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * The auth routes' default rate limits, per client address. Sign-in also limits
 * failed attempts per account, in the provider; these limits bound how fast one
 * address can try anything at all.
 */
const DEFAULT_AUTH_RATE_LIMITS = Object.freeze({
  register: Object.freeze({ max: 10, timeWindow: "1 minute" }),
  registerConfirmationResend: Object.freeze({ max: 5, timeWindow: "1 minute" }),
  registerConfirm: Object.freeze({ max: 10, timeWindow: "1 minute" }),
  login: Object.freeze({ max: 10, timeWindow: "1 minute" }),
  loginOtpRequest: Object.freeze({ max: 10, timeWindow: "1 minute" }),
  loginOtpVerify: Object.freeze({ max: 10, timeWindow: "1 minute" }),
  oauthStart: Object.freeze({ max: 20, timeWindow: "1 minute" }),
  oauthComplete: Object.freeze({ max: 20, timeWindow: "1 minute" }),
  devLoginAs: Object.freeze({ max: 30, timeWindow: "1 minute" }),
  passwordForgot: Object.freeze({ max: 5, timeWindow: "1 minute" }),
  passwordRecovery: Object.freeze({ max: 20, timeWindow: "1 minute" }),
  passwordReset: Object.freeze({ max: 20, timeWindow: "1 minute" })
});

/**
 * Each auth route's rate limit: its default, with the fields the application's
 * `config.auth.rateLimits.<route>` gives over it, or none when that is false.
 * A route name the defaults do not have stops startup, so a misspelt override
 * is never silently ignored.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} config
 * @returns {Readonly<Record<keyof typeof DEFAULT_AUTH_RATE_LIMITS, { max: number, timeWindow: string | number } | null>>}
 */
function resolveAuthRateLimits(config) {
  const configured = isRecord(config.auth) && config.auth.rateLimits !== undefined ? config.auth.rateLimits : {};
  if (!isRecord(configured)) {
    throw new Error("config.auth.rateLimits must be an object of route names.");
  }
  for (const name of Object.keys(configured)) {
    if (!Object.hasOwn(DEFAULT_AUTH_RATE_LIMITS, name)) {
      throw new Error(
        `config.auth.rateLimits.${name} names no auth route. Use one of: ${Object.keys(DEFAULT_AUTH_RATE_LIMITS).join(", ")}.`
      );
    }
  }
  const limits = {};
  for (const [name, defaultLimit] of Object.entries(DEFAULT_AUTH_RATE_LIMITS)) {
    const override = configured[name];
    if (override === false) {
      limits[name] = null;
    } else if (override === undefined) {
      limits[name] = defaultLimit;
    } else if (isRecord(override)) {
      limits[name] = Object.freeze({ ...defaultLimit, ...override });
    } else {
      throw new Error(`config.auth.rateLimits.${name} must be { max, timeWindow } or false.`);
    }
  }
  return Object.freeze(limits);
}

export { DEFAULT_AUTH_RATE_LIMITS, resolveAuthRateLimits };
