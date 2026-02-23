import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { bool, cleanEnv, num, port, str } from "envalid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const DEPRECATED_REPO_CONFIG_ENV_KEYS = Object.freeze([
  "TENANCY_MODE",
  "WORKSPACE_SWITCHING_DEFAULT",
  "WORKSPACE_INVITES_DEFAULT",
  "WORKSPACE_CREATE_ENABLED",
  "MAX_WORKSPACES_PER_USER",
  "CHAT_ENABLED",
  "CHAT_WORKSPACE_THREADS_ENABLED",
  "CHAT_GLOBAL_DMS_ENABLED",
  "CHAT_GLOBAL_DMS_REQUIRE_SHARED_WORKSPACE",
  "CHAT_ATTACHMENTS_ENABLED",
  "CHAT_MESSAGE_MAX_TEXT_CHARS",
  "CHAT_MESSAGES_PAGE_SIZE_MAX",
  "CHAT_THREADS_PAGE_SIZE_MAX",
  "CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE",
  "CHAT_ATTACHMENT_MAX_UPLOAD_BYTES",
  "CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS",
  "CHAT_MESSAGES_RETENTION_DAYS",
  "CHAT_ATTACHMENTS_RETENTION_DAYS",
  "CHAT_MESSAGE_IDEMPOTENCY_RETRY_WINDOW_HOURS",
  "CHAT_EMPTY_THREAD_CLEANUP_ENABLED",
  "AI_ENABLED",
  "AI_MODEL",
  "AI_MAX_INPUT_CHARS",
  "AI_MAX_HISTORY_MESSAGES",
  "AI_MAX_TOOL_CALLS_PER_TURN",
  "AI_REQUIRED_PERMISSION",
  "BILLING_ENABLED",
  "BILLING_PROVIDER",
  "BILLING_CURRENCY",
  "BILLING_PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS",
  "BILLING_CHECKOUT_PROVIDER_EXPIRES_SECONDS",
  "BILLING_CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS",
  "BILLING_CHECKOUT_PENDING_LEASE_SECONDS",
  "BILLING_OUTBOX_RETRY_DELAY_SECONDS",
  "BILLING_OUTBOX_MAX_ATTEMPTS",
  "BILLING_REMEDIATION_RETRY_DELAY_SECONDS",
  "BILLING_REMEDIATION_MAX_ATTEMPTS",
  "BILLING_CHECKOUT_COMPLETION_SLA_SECONDS",
  "BILLING_IDEMPOTENCY_RETENTION_DAYS",
  "BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS",
  "BILLING_DEBUG_CHECKOUT_BLOCKS",
  "ERROR_LOG_RETENTION_DAYS",
  "INVITE_ARTIFACT_RETENTION_DAYS",
  "SECURITY_AUDIT_RETENTION_DAYS",
  "AI_TRANSCRIPTS_RETENTION_DAYS"
]);

function assertNoDeprecatedRepoConfigEnvKeys(rawEnv) {
  const presentKeys = DEPRECATED_REPO_CONFIG_ENV_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(rawEnv, key));
  if (presentKeys.length < 1) {
    return;
  }

  throw new Error(
    `The following environment variables moved to repository config files under /config and are no longer supported: ${presentKeys.join(", ")}`
  );
}

assertNoDeprecatedRepoConfigEnvKeys(process.env);

export const runtimeEnv = cleanEnv(
  process.env,
  {
    NODE_ENV: str({
      choices: ["development", "production", "test"],
      default: "development"
    }),
    LOG_LEVEL: str({ default: "" }),
    PORT: port({ default: 3000 }),
    DB_HOST: str({ default: "127.0.0.1" }),
    DB_PORT: port({ default: 3306 }),
    DB_USER: str({ default: "annuity_app" }),
    DB_PASSWORD: str({ default: "" }),
    DB_NAME: str({ default: "material-app" }),
    DB_TEST_NAME: str({ default: "" }),
    DB_POOL_MAX: num({ default: 10 }),
    SUPABASE_URL: str({ default: "" }),
    SUPABASE_PUBLISHABLE_KEY: str({ default: "" }),
    SUPABASE_JWT_AUDIENCE: str({ default: "authenticated" }),
    APP_PUBLIC_URL: str({ default: "" }),
    SMS_DRIVER: str({
      choices: ["none", "plivo"],
      default: "none"
    }),
    PLIVO_AUTH_ID: str({ default: "" }),
    PLIVO_AUTH_TOKEN: str({ default: "" }),
    PLIVO_SOURCE_NUMBER: str({ default: "" }),
    RATE_LIMIT_MODE: str({
      choices: ["memory", "redis"],
      default: "memory"
    }),
    REDIS_URL: str({ default: "" }),
    WORKER_CONCURRENCY: num({ default: 2 }),
    WORKER_LOCK_HELD_REQUEUE_MAX: num({ default: 3 }),
    WORKER_RETENTION_LOCK_TTL_MS: num({ default: 1800000 }),
    TRUST_PROXY: bool({ default: false }),
    RBAC_MANIFEST_PATH: str({ default: "./shared/auth/rbac.manifest.json" }),
    FRONTEND_DIST_DIR: str({ default: "dist" }),
    AVATAR_STORAGE_DRIVER: str({ default: "fs" }),
    AVATAR_STORAGE_FS_BASE_PATH: str({ default: "" }),
    AVATAR_PUBLIC_BASE_PATH: str({ default: "/uploads" }),
    WORKSPACE_INVITE_EMAIL_DRIVER: str({
      choices: ["none", "smtp"],
      default: "none"
    }),
    SMTP_HOST: str({ default: "" }),
    SMTP_PORT: port({ default: 587 }),
    SMTP_SECURE: bool({ default: false }),
    SMTP_USERNAME: str({ default: "" }),
    SMTP_PASSWORD: str({ default: "" }),
    SMTP_FROM: str({ default: "" }),
    METRICS_ENABLED: bool({ default: true }),
    METRICS_BEARER_TOKEN: str({ default: "" }),
    CHAT_ATTACHMENT_STORAGE_DRIVER: str({ default: "fs" }),
    CHAT_ATTACHMENT_STORAGE_FS_BASE_PATH: str({ default: "" }),
    AI_PROVIDER: str({
      choices: ["openai"],
      default: "openai"
    }),
    AI_API_KEY: str({ default: "" }),
    AI_BASE_URL: str({ default: "" }),
    AI_TIMEOUT_MS: num({ default: 45000 }),
    BILLING_OPERATION_KEY_SECRET: str({ default: "" }),
    BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET: str({ default: "" }),
    BILLING_STRIPE_SECRET_KEY: str({ default: "" }),
    BILLING_STRIPE_API_VERSION: str({ default: "" }),
    BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET: str({ default: "" }),
    BILLING_STRIPE_MAX_NETWORK_RETRIES: num({ default: 2 }),
    BILLING_STRIPE_TIMEOUT_MS: num({ default: 30000 }),
    BILLING_PADDLE_API_KEY: str({ default: "" }),
    BILLING_PADDLE_API_BASE_URL: str({ default: "https://api.paddle.com" }),
    BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET: str({ default: "" }),
    BILLING_PADDLE_TIMEOUT_MS: num({ default: 30000 }),
    RETENTION_BATCH_SIZE: num({ default: 1000 })
  },
  {
    strict: true
  }
);
