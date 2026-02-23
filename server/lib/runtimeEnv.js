import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { bool, cleanEnv, num, port, str } from "envalid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

export const runtimeEnv = cleanEnv(
  process.env,
  {
    NODE_ENV: str({
      choices: ["development", "production", "test"],
      default: "development"
    }),
    LOG_LEVEL: str({ default: "" }),
    LOG_DEBUG_SCOPES: str({ default: "" }),
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
