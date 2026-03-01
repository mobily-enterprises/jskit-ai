import { bool, num, port, str } from "envalid";

const PLATFORM_RUNTIME_DEFAULTS = Object.freeze({
  DB_HOST: "127.0.0.1",
  DB_PORT: 3306,
  DB_USER: "app",
  DB_NAME: "app",
  DB_POOL_MAX: 10,
  AUTH_PROVIDER: "supabase",
  AUTH_JWT_AUDIENCE: "authenticated",
  RATE_LIMIT_MODE: "memory",
  WORKER_CONCURRENCY: 2,
  WORKER_LOCK_HELD_REQUEUE_MAX: 3,
  WORKER_RETENTION_LOCK_TTL_MS: 1800000,
  TRUST_PROXY: false,
  RBAC_MANIFEST_PATH: "./shared/auth/rbac.manifest.json",
  FRONTEND_DIST_DIR: "dist",
  FRAMEWORK_EXTENSION_MODULES: "",
  EMAIL_PROVIDER: "none",
  AVATAR_STORAGE_DRIVER: "fs",
  AVATAR_PUBLIC_BASE_PATH: "/uploads",
  METRICS_ENABLED: true,
  CHAT_ATTACHMENT_STORAGE_DRIVER: "fs",
  AI_PROVIDER: "openai",
  AI_TIMEOUT_MS: 45000,
  SOCIAL_FEDERATION_HTTP_TIMEOUT_MS: 10000,
  SOCIAL_FEDERATION_DELIVERY_BATCH_SIZE: 25,
  SOCIAL_FEDERATION_DELIVERY_MAX_ATTEMPTS: 8,
  SOCIAL_FEDERATION_RETRY_BASE_MS: 30000,
  SOCIAL_FEDERATION_OUTBOX_POLL_SECONDS: 10,
  SOCIAL_FEDERATION_OUTBOX_MAX_WORKSPACES_PER_TICK: 25,
  SOCIAL_FEDERATION_ALLOW_PRIVATE_HOSTS: false,
  BILLING_STRIPE_MAX_NETWORK_RETRIES: 2,
  BILLING_STRIPE_TIMEOUT_MS: 30000,
  BILLING_PADDLE_API_BASE_URL: "https://api.paddle.com",
  BILLING_PADDLE_TIMEOUT_MS: 30000,
  RETENTION_BATCH_SIZE: 1000
});

function toTrimmedDefault(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  if (normalized) {
    return normalized;
  }

  return String(fallback ?? "").trim();
}

function resolveStringDefault(defaults, key, fallback = "") {
  const source = defaults && typeof defaults === "object" ? defaults[key] : undefined;
  return toTrimmedDefault(source, fallback);
}

function resolveNumberDefault(defaults, key, fallback) {
  const source = defaults && typeof defaults === "object" ? defaults[key] : undefined;
  const parsed = Number(source);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
}

function resolveBooleanDefault(defaults, key, fallback = false) {
  const source = defaults && typeof defaults === "object" ? defaults[key] : undefined;
  if (typeof source === "boolean") {
    return source;
  }

  if (source == null) {
    return fallback;
  }

  const normalized = String(source).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return fallback;
}

function createCoreRuntimeSpec(defaults = {}) {
  return {
    NODE_ENV: str({
      choices: ["development", "production", "test"],
      default: "development"
    }),
    LOG_LEVEL: str({ default: resolveStringDefault(defaults, "LOG_LEVEL", "") }),
    LOG_DEBUG_SCOPES: str({ default: resolveStringDefault(defaults, "LOG_DEBUG_SCOPES", "") }),
    PORT: port({ default: resolveNumberDefault(defaults, "PORT", 3000) }),
    APP_PUBLIC_URL: str({ default: resolveStringDefault(defaults, "APP_PUBLIC_URL", "") }),
    TRUST_PROXY: bool({ default: resolveBooleanDefault(defaults, "TRUST_PROXY", PLATFORM_RUNTIME_DEFAULTS.TRUST_PROXY) }),
    RBAC_MANIFEST_PATH: str({
      default: resolveStringDefault(defaults, "RBAC_MANIFEST_PATH", PLATFORM_RUNTIME_DEFAULTS.RBAC_MANIFEST_PATH)
    }),
    FRONTEND_DIST_DIR: str({
      default: resolveStringDefault(defaults, "FRONTEND_DIST_DIR", PLATFORM_RUNTIME_DEFAULTS.FRONTEND_DIST_DIR)
    }),
    FRAMEWORK_EXTENSION_MODULES: str({
      default: resolveStringDefault(
        defaults,
        "FRAMEWORK_EXTENSION_MODULES",
        PLATFORM_RUNTIME_DEFAULTS.FRAMEWORK_EXTENSION_MODULES
      )
    })
  };
}

function createDatabaseRuntimeSpec(defaults = {}) {
  return {
    DB_HOST: str({ default: resolveStringDefault(defaults, "DB_HOST", PLATFORM_RUNTIME_DEFAULTS.DB_HOST) }),
    DB_PORT: port({ default: resolveNumberDefault(defaults, "DB_PORT", PLATFORM_RUNTIME_DEFAULTS.DB_PORT) }),
    DB_USER: str({ default: resolveStringDefault(defaults, "DB_USER", PLATFORM_RUNTIME_DEFAULTS.DB_USER) }),
    DB_PASSWORD: str({ default: resolveStringDefault(defaults, "DB_PASSWORD", "") }),
    DB_NAME: str({ default: resolveStringDefault(defaults, "DB_NAME", PLATFORM_RUNTIME_DEFAULTS.DB_NAME) }),
    DB_TEST_NAME: str({ default: resolveStringDefault(defaults, "DB_TEST_NAME", "") }),
    DB_POOL_MAX: num({ default: resolveNumberDefault(defaults, "DB_POOL_MAX", PLATFORM_RUNTIME_DEFAULTS.DB_POOL_MAX) })
  };
}

function createAuthRuntimeSpec(defaults = {}) {
  return {
    AUTH_PROVIDER: str({ default: resolveStringDefault(defaults, "AUTH_PROVIDER", PLATFORM_RUNTIME_DEFAULTS.AUTH_PROVIDER) }),
    AUTH_SUPABASE_URL: str({ default: resolveStringDefault(defaults, "AUTH_SUPABASE_URL", "") }),
    AUTH_SUPABASE_PUBLISHABLE_KEY: str({
      default: resolveStringDefault(defaults, "AUTH_SUPABASE_PUBLISHABLE_KEY", "")
    }),
    AUTH_JWT_AUDIENCE: str({
      default: resolveStringDefault(defaults, "AUTH_JWT_AUDIENCE", PLATFORM_RUNTIME_DEFAULTS.AUTH_JWT_AUDIENCE)
    }),
    AUTH_OAUTH_PROVIDERS: str({ default: resolveStringDefault(defaults, "AUTH_OAUTH_PROVIDERS", "") }),
    AUTH_OAUTH_DEFAULT_PROVIDER: str({ default: resolveStringDefault(defaults, "AUTH_OAUTH_DEFAULT_PROVIDER", "") })
  };
}

function createRedisRuntimeSpec(defaults = {}) {
  return {
    RATE_LIMIT_MODE: str({
      choices: ["memory", "redis"],
      default: resolveStringDefault(defaults, "RATE_LIMIT_MODE", PLATFORM_RUNTIME_DEFAULTS.RATE_LIMIT_MODE)
    }),
    REDIS_URL: str({ default: resolveStringDefault(defaults, "REDIS_URL", "") }),
    REDIS_NAMESPACE: str({ default: resolveStringDefault(defaults, "REDIS_NAMESPACE", "") })
  };
}

function createWorkerRuntimeSpec(defaults = {}) {
  return {
    WORKER_CONCURRENCY: num({
      default: resolveNumberDefault(defaults, "WORKER_CONCURRENCY", PLATFORM_RUNTIME_DEFAULTS.WORKER_CONCURRENCY)
    }),
    WORKER_LOCK_HELD_REQUEUE_MAX: num({
      default: resolveNumberDefault(
        defaults,
        "WORKER_LOCK_HELD_REQUEUE_MAX",
        PLATFORM_RUNTIME_DEFAULTS.WORKER_LOCK_HELD_REQUEUE_MAX
      )
    }),
    WORKER_RETENTION_LOCK_TTL_MS: num({
      default: resolveNumberDefault(
        defaults,
        "WORKER_RETENTION_LOCK_TTL_MS",
        PLATFORM_RUNTIME_DEFAULTS.WORKER_RETENTION_LOCK_TTL_MS
      )
    }),
    RETENTION_BATCH_SIZE: num({
      default: resolveNumberDefault(defaults, "RETENTION_BATCH_SIZE", PLATFORM_RUNTIME_DEFAULTS.RETENTION_BATCH_SIZE)
    })
  };
}

function createSmsRuntimeSpec(defaults = {}) {
  return {
    SMS_DRIVER: str({
      choices: ["none", "plivo"],
      default: resolveStringDefault(defaults, "SMS_DRIVER", "none")
    }),
    PLIVO_AUTH_ID: str({ default: resolveStringDefault(defaults, "PLIVO_AUTH_ID", "") }),
    PLIVO_AUTH_TOKEN: str({ default: resolveStringDefault(defaults, "PLIVO_AUTH_TOKEN", "") }),
    PLIVO_SOURCE_NUMBER: str({ default: resolveStringDefault(defaults, "PLIVO_SOURCE_NUMBER", "") })
  };
}

function createEmailRuntimeSpec(defaults = {}) {
  return {
    EMAIL_PROVIDER: str({ default: resolveStringDefault(defaults, "EMAIL_PROVIDER", PLATFORM_RUNTIME_DEFAULTS.EMAIL_PROVIDER) })
  };
}

function createStorageRuntimeSpec(defaults = {}) {
  return {
    AVATAR_STORAGE_DRIVER: str({
      default: resolveStringDefault(defaults, "AVATAR_STORAGE_DRIVER", PLATFORM_RUNTIME_DEFAULTS.AVATAR_STORAGE_DRIVER)
    }),
    AVATAR_STORAGE_FS_BASE_PATH: str({ default: resolveStringDefault(defaults, "AVATAR_STORAGE_FS_BASE_PATH", "") }),
    AVATAR_PUBLIC_BASE_PATH: str({
      default: resolveStringDefault(defaults, "AVATAR_PUBLIC_BASE_PATH", PLATFORM_RUNTIME_DEFAULTS.AVATAR_PUBLIC_BASE_PATH)
    }),
    CHAT_ATTACHMENT_STORAGE_DRIVER: str({
      default: resolveStringDefault(
        defaults,
        "CHAT_ATTACHMENT_STORAGE_DRIVER",
        PLATFORM_RUNTIME_DEFAULTS.CHAT_ATTACHMENT_STORAGE_DRIVER
      )
    }),
    CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH: str({
      default: resolveStringDefault(defaults, "CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH", "")
    })
  };
}

function createObservabilityRuntimeSpec(defaults = {}) {
  return {
    METRICS_ENABLED: bool({
      default: resolveBooleanDefault(defaults, "METRICS_ENABLED", PLATFORM_RUNTIME_DEFAULTS.METRICS_ENABLED)
    }),
    METRICS_BEARER_TOKEN: str({ default: resolveStringDefault(defaults, "METRICS_BEARER_TOKEN", "") })
  };
}

function createAiRuntimeSpec(defaults = {}) {
  return {
    AI_PROVIDER: str({
      choices: ["openai"],
      default: resolveStringDefault(defaults, "AI_PROVIDER", PLATFORM_RUNTIME_DEFAULTS.AI_PROVIDER)
    }),
    AI_API_KEY: str({ default: resolveStringDefault(defaults, "AI_API_KEY", "") }),
    AI_BASE_URL: str({ default: resolveStringDefault(defaults, "AI_BASE_URL", "") }),
    AI_TIMEOUT_MS: num({ default: resolveNumberDefault(defaults, "AI_TIMEOUT_MS", PLATFORM_RUNTIME_DEFAULTS.AI_TIMEOUT_MS) })
  };
}

function createBillingRuntimeSpec(defaults = {}) {
  return {
    BILLING_OPERATION_KEY_SECRET: str({ default: resolveStringDefault(defaults, "BILLING_OPERATION_KEY_SECRET", "") }),
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: str({
      default: resolveStringDefault(defaults, "BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET", "")
    }),
    BILLING_STRIPE_SECRET_KEY: str({ default: resolveStringDefault(defaults, "BILLING_STRIPE_SECRET_KEY", "") }),
    BILLING_STRIPE_API_VERSION: str({ default: resolveStringDefault(defaults, "BILLING_STRIPE_API_VERSION", "") }),
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: str({
      default: resolveStringDefault(defaults, "BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET", "")
    }),
    BILLING_STRIPE_MAX_NETWORK_RETRIES: num({
      default: resolveNumberDefault(
        defaults,
        "BILLING_STRIPE_MAX_NETWORK_RETRIES",
        PLATFORM_RUNTIME_DEFAULTS.BILLING_STRIPE_MAX_NETWORK_RETRIES
      )
    }),
    BILLING_STRIPE_TIMEOUT_MS: num({
      default: resolveNumberDefault(defaults, "BILLING_STRIPE_TIMEOUT_MS", PLATFORM_RUNTIME_DEFAULTS.BILLING_STRIPE_TIMEOUT_MS)
    }),
    BILLING_PADDLE_API_KEY: str({ default: resolveStringDefault(defaults, "BILLING_PADDLE_API_KEY", "") }),
    BILLING_PADDLE_API_BASE_URL: str({
      default: resolveStringDefault(
        defaults,
        "BILLING_PADDLE_API_BASE_URL",
        PLATFORM_RUNTIME_DEFAULTS.BILLING_PADDLE_API_BASE_URL
      )
    }),
    BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET: str({
      default: resolveStringDefault(defaults, "BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET", "")
    }),
    BILLING_PADDLE_TIMEOUT_MS: num({
      default: resolveNumberDefault(defaults, "BILLING_PADDLE_TIMEOUT_MS", PLATFORM_RUNTIME_DEFAULTS.BILLING_PADDLE_TIMEOUT_MS)
    })
  };
}

function createSocialRuntimeSpec(defaults = {}) {
  return {
    SOCIAL_FEDERATION_SIGNING_SECRET: str({
      default: resolveStringDefault(defaults, "SOCIAL_FEDERATION_SIGNING_SECRET", "")
    }),
    SOCIAL_FEDERATION_HTTP_TIMEOUT_MS: num({
      default: resolveNumberDefault(
        defaults,
        "SOCIAL_FEDERATION_HTTP_TIMEOUT_MS",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_HTTP_TIMEOUT_MS
      )
    }),
    SOCIAL_FEDERATION_DELIVERY_BATCH_SIZE: num({
      default: resolveNumberDefault(
        defaults,
        "SOCIAL_FEDERATION_DELIVERY_BATCH_SIZE",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_DELIVERY_BATCH_SIZE
      )
    }),
    SOCIAL_FEDERATION_DELIVERY_MAX_ATTEMPTS: num({
      default: resolveNumberDefault(
        defaults,
        "SOCIAL_FEDERATION_DELIVERY_MAX_ATTEMPTS",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_DELIVERY_MAX_ATTEMPTS
      )
    }),
    SOCIAL_FEDERATION_RETRY_BASE_MS: num({
      default: resolveNumberDefault(
        defaults,
        "SOCIAL_FEDERATION_RETRY_BASE_MS",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_RETRY_BASE_MS
      )
    }),
    SOCIAL_FEDERATION_OUTBOX_POLL_SECONDS: num({
      default: resolveNumberDefault(
        defaults,
        "SOCIAL_FEDERATION_OUTBOX_POLL_SECONDS",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_OUTBOX_POLL_SECONDS
      )
    }),
    SOCIAL_FEDERATION_OUTBOX_MAX_WORKSPACES_PER_TICK: num({
      default: resolveNumberDefault(
        defaults,
        "SOCIAL_FEDERATION_OUTBOX_MAX_WORKSPACES_PER_TICK",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_OUTBOX_MAX_WORKSPACES_PER_TICK
      )
    }),
    SOCIAL_FEDERATION_ALLOW_PRIVATE_HOSTS: bool({
      default: resolveBooleanDefault(
        defaults,
        "SOCIAL_FEDERATION_ALLOW_PRIVATE_HOSTS",
        PLATFORM_RUNTIME_DEFAULTS.SOCIAL_FEDERATION_ALLOW_PRIVATE_HOSTS
      )
    })
  };
}

function createPlatformRuntimeEnvSpec({ defaults = {} } = {}) {
  return {
    ...createCoreRuntimeSpec(defaults),
    ...createDatabaseRuntimeSpec(defaults),
    ...createAuthRuntimeSpec(defaults),
    ...createRedisRuntimeSpec(defaults),
    ...createWorkerRuntimeSpec(defaults),
    ...createSmsRuntimeSpec(defaults),
    ...createEmailRuntimeSpec(defaults),
    ...createStorageRuntimeSpec(defaults),
    ...createObservabilityRuntimeSpec(defaults),
    ...createAiRuntimeSpec(defaults),
    ...createSocialRuntimeSpec(defaults),
    ...createBillingRuntimeSpec(defaults)
  };
}

export {
  PLATFORM_RUNTIME_DEFAULTS,
  createCoreRuntimeSpec,
  createDatabaseRuntimeSpec,
  createAuthRuntimeSpec,
  createRedisRuntimeSpec,
  createWorkerRuntimeSpec,
  createSmsRuntimeSpec,
  createEmailRuntimeSpec,
  createStorageRuntimeSpec,
  createObservabilityRuntimeSpec,
  createAiRuntimeSpec,
  createSocialRuntimeSpec,
  createBillingRuntimeSpec,
  createPlatformRuntimeEnvSpec
};
