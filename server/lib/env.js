import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { bool, cleanEnv, num, port, str } from "envalid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
dotenv.config({
  path: path.resolve(__dirname, "..", "..", ".env.local"),
  override: false
});

export const env = cleanEnv(
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
    TRUST_PROXY: bool({ default: false }),
    TENANCY_MODE: str({
      choices: ["personal", "team-single", "multi-workspace"],
      default: "personal"
    }),
    WORKSPACE_SWITCHING_DEFAULT: bool({ default: false }),
    WORKSPACE_INVITES_DEFAULT: bool({ default: false }),
    WORKSPACE_CREATE_ENABLED: bool({ default: false }),
    MAX_WORKSPACES_PER_USER: num({ default: 1 }),
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
    ERROR_LOG_RETENTION_DAYS: num({ default: 30 }),
    INVITE_ARTIFACT_RETENTION_DAYS: num({ default: 90 }),
    SECURITY_AUDIT_RETENTION_DAYS: num({ default: 365 }),
    RETENTION_BATCH_SIZE: num({ default: 1000 })
  },
  {
    strict: true
  }
);
