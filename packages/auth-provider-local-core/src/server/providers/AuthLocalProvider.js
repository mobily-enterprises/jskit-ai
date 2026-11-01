import { parseBooleanFlag } from "@jskit-ai/auth-core/server/booleanFlag";
import { assertDevAuthPolicy, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createLocalFileBackend } from "../lib/fileBackend.js";
import { resolveOAuthProviders } from "../lib/oauth.js";
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

// Recovery links and OAuth redirect addresses are built from APP_PUBLIC_URL.
function resolveAppPublicUrl(env, { recoverySender, oauthProviders }) {
  const configured = String(env.APP_PUBLIC_URL || "").trim();
  if (!configured) {
    if (recoverySender) throw new Error("APP_PUBLIC_URL is required when local auth email recovery is configured.");
    if (oauthProviders.length > 0) throw new Error("APP_PUBLIC_URL is required when local auth OAuth sign-in is configured.");
    return "http://localhost:5173";
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("APP_PUBLIC_URL must be a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("APP_PUBLIC_URL must use http or https.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

/**
 * @param {object} input
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} input.appRoot
 * @param {import("../types.js").AuthLocalBackend | object} [input.backend]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} input.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} input.logger
 * @param {Function | null} [input.recoverySender]
 */
function resolveConfig({ appRoot, backend, env, logger, recoverySender = null }) {
  const nodeEnv = String(env.NODE_ENV || "development").trim() || "development";
  const isProduction = nodeEnv === "production";
  const storeDir = resolveStoreDir(env, appRoot);
  if (!backend && isProduction && !parseBooleanFlag(env.AUTH_LOCAL_FILE_PRODUCTION_ACK, false)) {
    throw new Error("AUTH_LOCAL_FILE_PRODUCTION_ACK is required to use the local file auth backend in production.");
  }
  const devAuth = resolveDevAuthPolicyFromEnv(env);
  assertDevAuthPolicy(devAuth);
  const oauthProviders = resolveOAuthProviders(env);
  return {
    storeDir,
    nodeEnv,
    logger,
    appPublicUrl: resolveAppPublicUrl(env, { recoverySender, oauthProviders }),
    oauthProviders,
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
    profileProjector: "auth.profile.projector",
    recoverySender: "auth.local.recovery-sender"
  },
  provides: {
    authService: "auth.service"
  },
  setup() {
    return { authService: createDeferredAuthService() };
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} dependencies.appRoot
   * @param {import("../types.js").AuthLocalBackend} [dependencies.backend]
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} dependencies.extensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   * @param {object} [dependencies.passwordStrategy]
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector | null} dependencies.profileProjector The `auth.profile.projector`, when one is installed.
   * @param {(delivery: { email: string, recoveryUrl: string }) => Promise<void>} [dependencies.recoverySender]
   */
  boot(dependencies, { outputs }) {
    const { appRoot, backend, env, extensions, logger, passwordStrategy, profileProjector, recoverySender = null } = dependencies;
    const config = resolveConfig({ appRoot, backend, env, logger, recoverySender });
    const baseService = createLocalAuthService({
      backend: backend || createLocalFileBackend({ storeDir: config.storeDir }),
      config,
      profileProjector: profileProjector ?? noAppProfiles,
      passwordStrategy,
      recoverySender,
      invitationContextResolver: extensions.resolveInvitationContextResolver()
    });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  }
});

export { AuthLocalProvider, resolveConfig };
