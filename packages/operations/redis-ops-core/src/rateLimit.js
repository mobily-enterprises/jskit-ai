import { createRequire } from "node:module";
import { buildRedisScopedKey, normalizeRedisNamespace } from "./redisNamespace.js";

const RATE_LIMIT_MODE_MEMORY = "memory";
const RATE_LIMIT_MODE_REDIS = "redis";
const RATE_LIMIT_REDIS_NAMESPACE_SEGMENT = "rate-limit";
const require = createRequire(import.meta.url);

function resolveClientIpAddress(request) {
  const forwardedFor = String(request?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const [firstHop] = forwardedFor.split(",");
    const candidate = String(firstHop || "").trim();
    if (candidate) {
      return candidate;
    }
  }

  const requestIp = String(request?.ip || "").trim();
  if (requestIp) {
    return requestIp;
  }

  const socketAddress = String(request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress || "").trim();
  if (socketAddress) {
    return socketAddress;
  }

  return "unknown";
}

function normalizeRateLimitMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === RATE_LIMIT_MODE_REDIS) {
    return RATE_LIMIT_MODE_REDIS;
  }
  return RATE_LIMIT_MODE_MEMORY;
}

function defaultRateLimitKeyGenerator(request) {
  const userId = Number(request?.user?.id);
  if (Number.isInteger(userId) && userId > 0) {
    return `user:${userId}`;
  }

  return `ip:${resolveClientIpAddress(request)}`;
}

function resolveRedisClientConstructor() {
  let loadedModule;
  try {
    loadedModule = require("ioredis");
  } catch {
    throw new Error(
      'RATE_LIMIT_MODE=redis requires the "ioredis" package. Install it with `npm install ioredis --save`.'
    );
  }

  const resolved = loadedModule?.default || loadedModule;
  if (typeof resolved !== "function") {
    throw new Error('Could not resolve a Redis client constructor from the "ioredis" package.');
  }

  return resolved;
}

function createRedisRateLimitClient({ redisUrl, redisCtor } = {}) {
  const Redis = typeof redisCtor === "function" ? redisCtor : resolveRedisClientConstructor();
  return new Redis(redisUrl, {
    connectTimeout: 10_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false
  });
}

function createRateLimitPluginOptions({ mode, redisUrl, redisNamespace, redisClientFactory } = {}) {
  const resolvedMode = normalizeRateLimitMode(mode);
  const normalizedRedisNamespace = normalizeRedisNamespace(redisNamespace);
  const baseOptions = {
    global: false,
    keyGenerator: defaultRateLimitKeyGenerator
  };

  if (resolvedMode === RATE_LIMIT_MODE_REDIS) {
    const normalizedRedisUrl = String(redisUrl || "").trim();
    if (!normalizedRedisUrl) {
      throw new Error("REDIS_URL is required when RATE_LIMIT_MODE=redis.");
    }

    const buildRedisClient = typeof redisClientFactory === "function" ? redisClientFactory : createRedisRateLimitClient;
    const redisClient = buildRedisClient({ redisUrl: normalizedRedisUrl });
    if (!redisClient || typeof redisClient !== "object") {
      throw new Error("redisClientFactory must return a Redis client instance.");
    }

    return {
      ...baseOptions,
      redis: redisClient,
      nameSpace: `${buildRedisScopedKey(normalizedRedisNamespace, RATE_LIMIT_REDIS_NAMESPACE_SEGMENT)}:`,
      skipOnError: false
    };
  }

  return baseOptions;
}

function resolveRateLimitStartupError({ mode, nodeEnv }) {
  const resolvedMode = normalizeRateLimitMode(mode);
  const normalizedEnv = String(nodeEnv || "")
    .trim()
    .toLowerCase();

  if (normalizedEnv !== "production") {
    return "";
  }

  if (resolvedMode !== RATE_LIMIT_MODE_REDIS) {
    return (
      "RATE_LIMIT_MODE=redis is required in production. " +
      "Configure REDIS_URL and REDIS_NAMESPACE, and run with a shared Redis-backed rate-limit store."
    );
  }

  return "";
}

function resolveRateLimitStartupWarning({ mode, nodeEnv }) {
  const resolvedMode = normalizeRateLimitMode(mode);
  const normalizedEnv = String(nodeEnv || "")
    .trim()
    .toLowerCase();
  if (normalizedEnv !== "production" || resolvedMode !== RATE_LIMIT_MODE_MEMORY) {
    return "";
  }

  return (
    "RATE_LIMIT_MODE=memory is process-local and weaker behind load balancers or multi-instance deploys. " +
    "Use RATE_LIMIT_MODE=redis with a shared store for production scale."
  );
}

const __testables = {
  RATE_LIMIT_MODE_MEMORY,
  RATE_LIMIT_MODE_REDIS,
  RATE_LIMIT_REDIS_NAMESPACE_SEGMENT,
  normalizeRateLimitMode,
  normalizeRedisNamespace,
  buildRedisScopedKey,
  resolveClientIpAddress,
  defaultRateLimitKeyGenerator,
  resolveRedisClientConstructor,
  createRedisRateLimitClient
};

export {
  RATE_LIMIT_MODE_MEMORY,
  RATE_LIMIT_MODE_REDIS,
  RATE_LIMIT_REDIS_NAMESPACE_SEGMENT,
  createRateLimitPluginOptions,
  resolveRateLimitStartupError,
  resolveRateLimitStartupWarning,
  __testables
};
