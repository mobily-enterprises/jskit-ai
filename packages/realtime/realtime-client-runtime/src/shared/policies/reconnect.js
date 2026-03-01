import { normalizePositiveInteger } from "../numbers.js";

const DEFAULT_RECONNECT_POLICY = Object.freeze({
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.2
});

function normalizeJitterRatio(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return Math.min(1, numeric);
}

function createReconnectPolicy(options = {}) {
  const baseDelayMs = normalizePositiveInteger(options.baseDelayMs, DEFAULT_RECONNECT_POLICY.baseDelayMs);
  const maxDelayMs = normalizePositiveInteger(options.maxDelayMs, DEFAULT_RECONNECT_POLICY.maxDelayMs);
  const jitterRatio = normalizeJitterRatio(options.jitterRatio, DEFAULT_RECONNECT_POLICY.jitterRatio);
  const randomFn = typeof options.random === "function" ? options.random : Math.random;

  function nextDelay(attempt) {
    const normalizedAttempt = normalizePositiveInteger(attempt, 1);
    const exponentialDelay = baseDelayMs * 2 ** (normalizedAttempt - 1);
    const boundedBaseDelay = Math.min(maxDelayMs, exponentialDelay);
    const jitterCap = Math.floor(boundedBaseDelay * jitterRatio);
    const jitter = Math.floor(Math.max(0, Number(randomFn() || 0)) * Math.max(1, jitterCap));
    return Math.min(maxDelayMs, boundedBaseDelay + jitter);
  }

  return Object.freeze({
    baseDelayMs,
    maxDelayMs,
    jitterRatio,
    nextDelay
  });
}

export { createReconnectPolicy, DEFAULT_RECONNECT_POLICY };
