import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";

/**
 * The failed sign-ins in a row after which an account must wait before its next
 * attempt, the first wait, and the longest: each further failure doubles the
 * wait, up to the longest. NIST SP 800-63B gives 30 seconds up to an hour as
 * its example.
 */
const DEFAULT_SIGN_IN_THROTTLE = Object.freeze({
  failuresBeforeWait: 5,
  firstWaitSeconds: 30,
  maxWaitSeconds: 3600
});

/** NIST SP 800-63B: at most 100 consecutive failed attempts on one account. */
const MAX_FAILURES_BEFORE_WAIT = 100;

/** An account's failures are forgotten a day after its last one. */
const FORGET_FAILURES_AFTER_MS = 24 * 60 * 60 * 1000;

function readSetting(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === "") {
    return fallback;
  }
  const value = parsePositiveInteger(raw);
  if (value === null) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return value;
}

/**
 * How failed sign-ins slow down one account, from AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT,
 * AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS and AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function resolveSignInThrottle(env) {
  const failuresBeforeWait = readSetting(
    env,
    "AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT",
    DEFAULT_SIGN_IN_THROTTLE.failuresBeforeWait
  );
  const firstWaitSeconds = readSetting(
    env,
    "AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS",
    DEFAULT_SIGN_IN_THROTTLE.firstWaitSeconds
  );
  const maxWaitSeconds = readSetting(env, "AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS", DEFAULT_SIGN_IN_THROTTLE.maxWaitSeconds);
  if (failuresBeforeWait > MAX_FAILURES_BEFORE_WAIT) {
    throw new Error(`AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT must be at most ${MAX_FAILURES_BEFORE_WAIT}.`);
  }
  if (maxWaitSeconds < firstWaitSeconds) {
    throw new Error("AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS must be at least AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS.");
  }
  return Object.freeze({
    failuresBeforeWait,
    firstWaitMs: firstWaitSeconds * 1000,
    maxWaitMs: maxWaitSeconds * 1000
  });
}

/**
 * The milliseconds the account must still wait before its next sign-in, or 0.
 * @param {{ lockedUntil: string } | null} record
 * @param {number} now
 */
function signInWaitMs(record, now) {
  const lockedUntil = Date.parse(record?.lockedUntil || "");
  return Number.isFinite(lockedUntil) && lockedUntil > now ? lockedUntil - now : 0;
}

/**
 * The account's record after one more failed sign-in.
 * @param {ReturnType<typeof resolveSignInThrottle>} throttle
 * @param {{ failures: number, lastFailedAt: string } | null} record
 * @param {string} email
 * @param {number} now
 */
function recordSignInFailure(throttle, record, email, now) {
  const lastFailedAt = Date.parse(record?.lastFailedAt || "");
  const recent = Number.isFinite(lastFailedAt) && now - lastFailedAt < FORGET_FAILURES_AFTER_MS;
  const failures = (recent ? record.failures : 0) + 1;
  const waits = failures - throttle.failuresBeforeWait + 1;
  const waitMs = waits > 0 ? Math.min(throttle.maxWaitMs, throttle.firstWaitMs * 2 ** (waits - 1)) : 0;
  return {
    email,
    failures,
    lastFailedAt: new Date(now).toISOString(),
    lockedUntil: waitMs > 0 ? new Date(now + waitMs).toISOString() : ""
  };
}

/** Failure records whose last failure is old enough to forget. */
function forgottenFailuresBefore(now) {
  return new Date(now - FORGET_FAILURES_AFTER_MS).toISOString();
}

/**
 * The refusal of a sign-in while its account waits, with the minutes to wait;
 * Retry-After gives the exact seconds.
 * @param {number} waitMs
 */
function signInLockedError(waitMs) {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  const count = Math.ceil(seconds / 60);
  const unit = count === 1 ? "minute" : "minutes";
  return new AppError(429, `Too many failed sign-ins for this account. Try again in ${count} ${unit}.`, {
    code: "auth.local.login.locked",
    params: { count, retryAfterSeconds: seconds },
    headers: { "retry-after": String(seconds) }
  });
}

export {
  DEFAULT_SIGN_IN_THROTTLE,
  forgottenFailuresBefore,
  recordSignInFailure,
  resolveSignInThrottle,
  signInLockedError,
  signInWaitMs
};
