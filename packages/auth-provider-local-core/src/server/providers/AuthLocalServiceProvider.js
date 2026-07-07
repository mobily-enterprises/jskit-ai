import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createLocalAuthService } from "../lib/service.js";
import { createLocalFileBackend } from "../lib/fileBackend.js";

const DEFAULT_STORE_DIR = ".jskit/auth";

function parseBoolean(value, fallback = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function resolveRuntimeEnv(scope) {
  const env = scope && typeof scope.has === "function" && scope.has("jskit.env") ? scope.make("jskit.env") : {};
  return {
    ...process.env,
    ...(env && typeof env === "object" ? env : {})
  };
}

function assertSelectedAuthProvider(env) {
  const selectedProvider = String(env?.AUTH_PROVIDER || "").trim().toLowerCase();
  if (selectedProvider && selectedProvider !== "local") {
    throw new Error(
      `AUTH_PROVIDER is "${selectedProvider}", but @jskit-ai/auth-provider-local-core is installed as the selected auth provider.`
    );
  }
}

function resolveStoreDir(env) {
  return path.resolve(String(env.AUTH_LOCAL_STORE_DIR || DEFAULT_STORE_DIR).trim() || DEFAULT_STORE_DIR);
}

function resolveSessionSecret(env, { storeDir, isProduction }) {
  const explicit = String(env.AUTH_LOCAL_SESSION_SECRET || "").trim();
  if (explicit) {
    return explicit;
  }
  if (isProduction) {
    throw new Error("AUTH_LOCAL_SESSION_SECRET is required for local auth in production.");
  }

  const secretPath = path.join(storeDir, "session.secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) {
      return existing;
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }

  fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("base64url");
  fs.writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

function resolveSmtpConfig(env) {
  const host = String(env.AUTH_LOCAL_SMTP_HOST || "").trim();
  if (!host) {
    return {
      smtpConfigured: false,
      smtp: null
    };
  }
  const from = String(env.AUTH_LOCAL_SMTP_FROM || "").trim();
  if (!from) {
    throw new Error("AUTH_LOCAL_SMTP_FROM is required when AUTH_LOCAL_SMTP_HOST is set.");
  }
  return {
    smtpConfigured: true,
    smtp: {
      host,
      port: Number(env.AUTH_LOCAL_SMTP_PORT || 587),
      secure: parseBoolean(env.AUTH_LOCAL_SMTP_SECURE, false),
      user: String(env.AUTH_LOCAL_SMTP_USER || "").trim(),
      password: String(env.AUTH_LOCAL_SMTP_PASSWORD || ""),
      from,
      replyTo: String(env.AUTH_LOCAL_SMTP_REPLY_TO || "").trim()
    }
  };
}

function resolveAppPublicUrl(env, { smtpConfigured }) {
  const configured = String(env.APP_PUBLIC_URL || "").trim();
  if (!configured) {
    if (smtpConfigured) {
      throw new Error("APP_PUBLIC_URL is required when local auth SMTP recovery is configured.");
    }
    return "http://localhost:5173";
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("APP_PUBLIC_URL must be a valid URL when local auth SMTP recovery is configured.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("APP_PUBLIC_URL must use http or https when local auth SMTP recovery is configured.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function resolveConfig(scope) {
  const env = resolveRuntimeEnv(scope);
  assertSelectedAuthProvider(env);
  const nodeEnv = String(env.NODE_ENV || "development").trim() || "development";
  const isProduction = nodeEnv === "production";
  const backend = String(env.AUTH_LOCAL_BACKEND || "file").trim().toLowerCase() || "file";
  const storeDir = resolveStoreDir(env);
  if (backend === "file" && isProduction && !parseBoolean(env.AUTH_LOCAL_FILE_PRODUCTION_ACK, false)) {
    throw new Error("AUTH_LOCAL_FILE_PRODUCTION_ACK is required to use the local file auth backend in production.");
  }
  const smtp = resolveSmtpConfig(env);
  return {
    backend,
    storeDir,
    nodeEnv,
    logger: scope.has("jskit.logger") ? scope.make("jskit.logger") : console,
    appPublicUrl: resolveAppPublicUrl(env, smtp),
    sessionSecret: resolveSessionSecret(env, {
      storeDir,
      isProduction
    }),
    recoveryDevOutput: String(env.AUTH_LOCAL_RECOVERY_DEV_OUTPUT || "log").trim().toLowerCase() || "log",
    ...smtp
  };
}

class AuthLocalServiceProvider {
  static id = "auth.provider.local";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("AuthLocalServiceProvider requires application singleton()/has().");
    }

    assertSelectedAuthProvider(resolveRuntimeEnv(app));

    if (app.has("authService")) {
      throw new Error("AuthLocalServiceProvider cannot register authService because another auth provider already registered it.");
    }

    if (!app.has("auth.local.backend")) {
      app.singleton("auth.local.backend", (scope) => {
        const config = resolveConfig(scope);
        if (config.backend !== "file") {
          throw new Error(`AUTH_LOCAL_BACKEND="${config.backend}" requires a custom auth.local.backend provider.`);
        }
        return createLocalFileBackend({
          storeDir: config.storeDir
        });
      });
    }

    app.singleton("authService", (scope) => {
      const config = resolveConfig(scope);
      const backend = scope.make("auth.local.backend");
      const profileProjector = scope.has("auth.profile.projector")
        ? {
            async syncIdentityProfile(profile, options = {}) {
              const projector = scope.make("auth.profile.projector");
              if (!projector || typeof projector.syncIdentityProfile !== "function") {
                throw new Error("auth.profile.projector.syncIdentityProfile() must be a function.");
              }
              return projector.syncIdentityProfile(profile, options);
            }
          }
        : null;
      const invitationContextResolver = scope.has("auth.invitationContextResolver")
        ? {
            async resolveInvitationContext(invitation, options = {}) {
              const resolver = scope.make("auth.invitationContextResolver");
              if (typeof resolver === "function") {
                return resolver(invitation, options);
              }
              if (!resolver || typeof resolver.resolveInvitationContext !== "function") {
                throw new Error("auth.invitationContextResolver.resolveInvitationContext() must be a function.");
              }
              return resolver.resolveInvitationContext(invitation, options);
            }
          }
        : null;
      const passwordStrategy = scope.has("auth.local.passwordStrategy")
        ? scope.make("auth.local.passwordStrategy")
        : null;
      return createLocalAuthService({
        backend,
        config,
        profileProjector,
        passwordStrategy,
        invitationContextResolver
      });
    });
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("AuthLocalServiceProvider requires application make().");
    }
    app.make("authService");
  }
}

export { AuthLocalServiceProvider };
