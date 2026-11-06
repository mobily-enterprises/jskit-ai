import { isRecord } from "../../../shared/support/normalize.js";
import { AppError } from "../../runtime/errors.js";
import { RouteDefinitionError } from "./errors.js";

const RATE_LIMIT_KEYS = Object.freeze(["max", "timeWindow"]);
const TIME_WINDOW_UNITS_MS = Object.freeze({
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000
});
const TIME_WINDOW_PATTERN = /^(\d+)\s*(millisecond|second|minute|hour)s?$/u;

/**
 * A time window in milliseconds: a positive integer, or text such as "1 minute"
 * or "30 seconds". Anything else is 0.
 * @param {unknown} timeWindow
 */
function toTimeWindowMs(timeWindow) {
  if (Number.isInteger(timeWindow) && Number(timeWindow) > 0) {
    return Number(timeWindow);
  }
  const match = TIME_WINDOW_PATTERN.exec(String(timeWindow ?? "").trim().toLowerCase());
  return match ? Number(match[1]) * TIME_WINDOW_UNITS_MS[match[2]] : 0;
}

/**
 * A route's `rateLimit`, checked when the route is defined: at most `max`
 * requests from one client address in each `timeWindow`.
 * @param {unknown} value `{ max, timeWindow }`, or nothing for a route without a limit.
 * @param {string} routeLabel
 * @returns {Readonly<{ max: number, timeWindowMs: number }> | null}
 */
function normalizeRouteRateLimit(value, routeLabel) {
  if (value == null) {
    return null;
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !RATE_LIMIT_KEYS.includes(key))) {
    throw new RouteDefinitionError(`Route ${routeLabel} rateLimit must be { max, timeWindow }.`);
  }
  if (!Number.isInteger(value.max) || value.max < 1) {
    throw new RouteDefinitionError(`Route ${routeLabel} rateLimit.max must be a positive integer.`);
  }
  const timeWindowMs = toTimeWindowMs(value.timeWindow);
  if (timeWindowMs < 1) {
    throw new RouteDefinitionError(
      `Route ${routeLabel} rateLimit.timeWindow must be milliseconds or text such as "1 minute".`
    );
  }
  return Object.freeze({
    max: value.max,
    timeWindowMs
  });
}

/**
 * The refusal of a request over its route's limit, with the seconds to wait; the
 * limiter also sends them as the Retry-After header.
 * @param {unknown} _request
 * @param {{ ttl: number }} limit
 */
function buildRateLimitedError(_request, { ttl }) {
  const count = Math.max(1, Math.ceil(Number(ttl) / 1000));
  const unit = count === 1 ? "second" : "seconds";
  return new AppError(429, `Too many requests. Try again in ${count} ${unit}.`, {
    code: "kernel.http.rateLimited",
    params: { count }
  });
}

/**
 * Registers the limiter that enforces routes' `rateLimit`, before the routes
 * themselves, when any route declares one. Each limited route counts the
 * requests of each client address on its own. The limiter is loaded only then,
 * so importing the kernel never loads a Fastify plugin.
 * @param {import("../../types.js").RuntimeFastify} fastify
 * @param {ReadonlyArray<{ rateLimit: { max: number, timeWindowMs: number } | null }>} routes
 */
async function registerRouteRateLimiter(fastify, routes) {
  if (!routes.some((route) => route.rateLimit)) {
    return;
  }
  const { default: fastifyRateLimit } = await import("@fastify/rate-limit");
  await fastify.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: buildRateLimitedError
  });
}

/**
 * The Fastify route config that applies a route's limit.
 * @param {{ max: number, timeWindowMs: number } | null} rateLimit
 */
function rateLimitRouteConfig(rateLimit) {
  return rateLimit ? { rateLimit: { max: rateLimit.max, timeWindow: rateLimit.timeWindowMs } } : {};
}

export { normalizeRouteRateLimit, rateLimitRouteConfig, registerRouteRateLimiter };
