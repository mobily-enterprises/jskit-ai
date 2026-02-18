import assert from "node:assert/strict";
import test from "node:test";

import {
  createRateLimitPluginOptions,
  resolveRateLimitStartupWarning,
  __testables as rateLimitTestables
} from "../lib/rateLimit.js";

test("rate-limit helper normalizes modes and resolves key material", () => {
  assert.equal(rateLimitTestables.normalizeRateLimitMode(""), "memory");
  assert.equal(rateLimitTestables.normalizeRateLimitMode("MEMORY"), "memory");
  assert.equal(rateLimitTestables.normalizeRateLimitMode("redis"), "redis");

  assert.equal(
    rateLimitTestables.resolveClientIpAddress({
      headers: {
        "x-forwarded-for": "198.51.100.10, 203.0.113.5"
      },
      ip: "127.0.0.1"
    }),
    "198.51.100.10"
  );

  assert.equal(
    rateLimitTestables.resolveClientIpAddress({
      headers: {},
      ip: "203.0.113.9"
    }),
    "203.0.113.9"
  );

  assert.equal(
    rateLimitTestables.defaultRateLimitKeyGenerator({
      user: {
        id: 41
      },
      headers: {
        "x-forwarded-for": "198.51.100.10"
      }
    }),
    "user:41"
  );

  assert.equal(
    rateLimitTestables.defaultRateLimitKeyGenerator({
      user: null,
      headers: {
        "x-forwarded-for": "198.51.100.10"
      }
    }),
    "ip:198.51.100.10"
  );
});

test("rate-limit plugin options support memory mode and fail fast for unimplemented redis mode", () => {
  const memoryOptions = createRateLimitPluginOptions({
    mode: "memory",
    redisUrl: ""
  });
  assert.equal(memoryOptions.global, false);
  assert.equal(typeof memoryOptions.keyGenerator, "function");

  assert.throws(
    () =>
      createRateLimitPluginOptions({
        mode: "redis",
        redisUrl: ""
      }),
    /REDIS_URL is required/
  );

  assert.throws(
    () =>
      createRateLimitPluginOptions({
        mode: "redis",
        redisUrl: "redis://localhost:6379"
      }),
    /not wired yet/
  );
});

test("rate-limit startup warning appears only for production memory mode", () => {
  assert.equal(
    resolveRateLimitStartupWarning({
      mode: "memory",
      nodeEnv: "production"
    }).includes("weaker behind load balancers"),
    true
  );

  assert.equal(
    resolveRateLimitStartupWarning({
      mode: "memory",
      nodeEnv: "development"
    }),
    ""
  );

  assert.equal(
    resolveRateLimitStartupWarning({
      mode: "redis",
      nodeEnv: "production"
    }),
    ""
  );
});
