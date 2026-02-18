const RATE_LIMIT_MODE_MEMORY = "memory";
const RATE_LIMIT_MODE_REDIS = "redis";

function normalizeRateLimitMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === RATE_LIMIT_MODE_REDIS) {
    return RATE_LIMIT_MODE_REDIS;
  }
  return RATE_LIMIT_MODE_MEMORY;
}

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

function defaultRateLimitKeyGenerator(request) {
  const userId = Number(request?.user?.id);
  if (Number.isInteger(userId) && userId > 0) {
    return `user:${userId}`;
  }

  return `ip:${resolveClientIpAddress(request)}`;
}

function createRateLimitPluginOptions({ mode, redisUrl }) {
  const resolvedMode = normalizeRateLimitMode(mode);
  if (resolvedMode === RATE_LIMIT_MODE_REDIS) {
    const normalizedRedisUrl = String(redisUrl || "").trim();
    if (!normalizedRedisUrl) {
      throw new Error("REDIS_URL is required when RATE_LIMIT_MODE=redis.");
    }

    throw new Error(
      "RATE_LIMIT_MODE=redis is configured, but a Redis rate-limit store is not wired yet. " +
        "Implement the Redis store adapter in lib/rateLimit.js."
    );
  }

  return {
    global: false,
    keyGenerator: defaultRateLimitKeyGenerator
  };
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
  normalizeRateLimitMode,
  resolveClientIpAddress,
  defaultRateLimitKeyGenerator
};

export {
  RATE_LIMIT_MODE_MEMORY,
  RATE_LIMIT_MODE_REDIS,
  createRateLimitPluginOptions,
  resolveRateLimitStartupWarning,
  __testables
};
