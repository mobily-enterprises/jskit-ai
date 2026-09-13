import { parseBooleanFlag } from "@jskit-ai/auth-core/server/booleanFlag";
import { assertDevAuthPolicy, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createLocalFileBackend } from "../lib/fileBackend.js";
import { createLocalAuthService } from "../lib/service.js";

const DEFAULT_STORE_DIR = ".jskit/auth";
function resolveStoreDir(env, appRoot) {
  const configured = String(env.AUTH_LOCAL_STORE_DIR || DEFAULT_STORE_DIR).trim() || DEFAULT_STORE_DIR;
  return path.resolve(appRoot, configured);
}

function resolveSessionSecret(env, { storeDir, isProduction }) {
  const explicit = String(env.AUTH_LOCAL_SESSION_SECRET || "").trim();
  if (explicit) return explicit;
  if (isProduction) throw new Error("AUTH_LOCAL_SESSION_SECRET is required for local auth in production.");

  const secretPath = path.join(storeDir, "session.secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("base64url");
  fs.writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

function resolveAppPublicUrl(env, { recoverySender }) {
  const configured = String(env.APP_PUBLIC_URL || "").trim();
  if (!configured) {
    if (recoverySender) throw new Error("APP_PUBLIC_URL is required when local auth email recovery is configured.");
    return "http://localhost:5173";
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("APP_PUBLIC_URL must be a valid URL when local auth email recovery is configured.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("APP_PUBLIC_URL must use http or https when local auth email recovery is configured.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

function resolveConfig({ appRoot, backend, env, logger, recoverySender = null }) {
  const nodeEnv = String(env.NODE_ENV || "development").trim() || "development";
  const isProduction = nodeEnv === "production";
  const storeDir = resolveStoreDir(env, appRoot);
  if (!backend && isProduction && !parseBooleanFlag(env.AUTH_LOCAL_FILE_PRODUCTION_ACK, false)) {
    throw new Error("AUTH_LOCAL_FILE_PRODUCTION_ACK is required to use the local file auth backend in production.");
  }
  const devAuth = resolveDevAuthPolicyFromEnv(env);
  assertDevAuthPolicy(devAuth);
  return {
    storeDir,
    nodeEnv,
    logger,
    appPublicUrl: resolveAppPublicUrl(env, { recoverySender }),
    sessionSecret: resolveSessionSecret(env, { storeDir, isProduction }),
    recoveryDevOutput: String(env.AUTH_LOCAL_RECOVERY_DEV_OUTPUT || "log").trim().toLowerCase() || "log",
    devAuth
  };
}

const AuthLocalProvider = defineProvider({
  id: "auth.local",
  requires: {
    appRoot: "runtime.app-root",
    env: "runtime.env",
    extensions: "auth.extensions",
    logger: "runtime.logger"
  },
  optional: {
    backend: "auth.local.backend",
    passwordStrategy: "auth.local.password-strategy",
    recoverySender: "auth.local.recovery-sender"
  },
  provides: {
    authService: "auth.service"
  },
  setup() {
    return { authService: createDeferredAuthService() };
  },
  boot(dependencies, { outputs }) {
    const { appRoot, backend, env, extensions, logger, passwordStrategy, recoverySender = null } = dependencies;
    const config = resolveConfig({ appRoot, backend, env, logger, recoverySender });
    const baseService = createLocalAuthService({
      backend: backend || createLocalFileBackend({ storeDir: config.storeDir }),
      config,
      profileProjector: extensions.resolveProfileProjector(),
      passwordStrategy,
      recoverySender,
      invitationContextResolver: extensions.resolveInvitationContextResolver()
    });
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  }
});

export { AuthLocalProvider, resolveConfig };
