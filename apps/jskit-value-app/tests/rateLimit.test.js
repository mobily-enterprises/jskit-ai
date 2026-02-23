import assert from "node:assert/strict";
import test from "node:test";

import {
  createRateLimitPluginOptions,
  resolveRateLimitStartupError,
  resolveRateLimitStartupWarning,
  __testables as rateLimitTestables
} from "../server/lib/rateLimit.js";

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

test("rate-limit plugin options support memory and redis modes", () => {
  const memoryOptions = createRateLimitPluginOptions({
    mode: "memory",
    redisUrl: ""
  });
  assert.equal(memoryOptions.global, false);
  assert.equal(typeof memoryOptions.keyGenerator, "function");
  assert.equal("redis" in memoryOptions, false);

  assert.throws(
    () =>
      createRateLimitPluginOptions({
        mode: "redis",
        redisUrl: ""
      }),
    /REDIS_URL is required/
  );

  let redisFactoryCalls = 0;
  const fakeRedisClient = {
    quit() {}
  };
  const redisOptions = createRateLimitPluginOptions({
    mode: "redis",
    redisUrl: "redis://localhost:6379",
    redisClientFactory({ redisUrl }) {
      redisFactoryCalls += 1;
      assert.equal(redisUrl, "redis://localhost:6379");
      return fakeRedisClient;
    }
  });
  assert.equal(redisFactoryCalls, 1);
  assert.equal(redisOptions.global, false);
  assert.equal(redisOptions.redis, fakeRedisClient);
  assert.equal(redisOptions.nameSpace, rateLimitTestables.RATE_LIMIT_REDIS_NAMESPACE);

  assert.throws(
    () =>
      createRateLimitPluginOptions({
        mode: "redis",
        redisUrl: "redis://localhost:6379",
        redisClientFactory() {
          return null;
        }
      }),
    /must return a Redis client/
  );
});

test("rate-limit startup error enforces redis mode in production", () => {
  assert.equal(
    resolveRateLimitStartupError({
      mode: "memory",
      nodeEnv: "production"
    }).includes("required in production"),
    true
  );

  assert.equal(
    resolveRateLimitStartupError({
      mode: "memory",
      nodeEnv: "development"
    }),
    ""
  );

  assert.equal(
    resolveRateLimitStartupError({
      mode: "redis",
      nodeEnv: "production"
    }),
    ""
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
