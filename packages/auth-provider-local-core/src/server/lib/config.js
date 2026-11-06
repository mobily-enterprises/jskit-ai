import { parseBooleanFlag } from "@jskit-ai/auth-core/server/booleanFlag";
import { assertDevAuthPolicy, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTH_PASSWORD_MIN_LENGTH } from "@jskit-ai/auth-core/shared/authConstraints";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { assertDevelopmentOnlySettings } from "@jskit-ai/kernel/server/runtime/runtimeMode";
import { resolveOAuthProviders } from "./oauth.js";
import { resolveSignInThrottle } from "./signInThrottle.js";

const DEFAULT_STORE_DIR = ".jskit/auth";

/**
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} appRoot
 */
function resolveStoreDir(env, appRoot) {
  const configured = String(env.AUTH_LOCAL_STORE_DIR || DEFAULT_STORE_DIR).trim() || DEFAULT_STORE_DIR;
  return path.resolve(appRoot, configured);
}

/**
 * AUTH_LOCAL_SESSION_SECRET, or outside production a secret kept in the store
 * directory, generated on first use.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ storeDir: string, isProduction: boolean }} options
 */
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

/**
 * APP_PUBLIC_URL, from which recovery and confirmation links and OAuth
 * redirect addresses are built. Emailed links and OAuth sign-in require it.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ emailRecovery: boolean, emailedConfirmation: boolean, oauthEnabled: boolean }} options
 */
function resolveAppPublicUrl(env, { emailRecovery, emailedConfirmation, oauthEnabled }) {
  const configured = String(env.APP_PUBLIC_URL || "").trim();
  if (!configured) {
    if (emailRecovery) throw new Error("APP_PUBLIC_URL is required when local auth email recovery is configured.");
    if (emailedConfirmation) {
      throw new Error("APP_PUBLIC_URL is required when local auth emails confirmation links.");
    }
    if (oauthEnabled) throw new Error("APP_PUBLIC_URL is required when local auth OAuth sign-in is configured.");
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
 * How a password recovery link reaches the person: by email through the
 * installed recovery sender; otherwise, outside production, in the log or in
 * the response (AUTH_LOCAL_RECOVERY_DEV_OUTPUT=response). In production without
 * a sender, recovery is disabled, and AUTH_LOCAL_RECOVERY_DEV_OUTPUT stops
 * startup (resolveLocalAuthConfig).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ emailRecovery: boolean, isProduction: boolean }} options
 * @returns {"email" | "disabled" | "dev-response" | "dev-log"}
 */
function resolveRecoveryDelivery(env, { emailRecovery, isProduction }) {
  if (emailRecovery) return "email";
  if (isProduction) return "disabled";
  const devOutput = String(env.AUTH_LOCAL_RECOVERY_DEV_OUTPUT || "").trim().toLowerCase();
  return devOutput === "response" ? "dev-response" : "dev-log";
}

/**
 * Whether a registration waits for its email to be confirmed
 * (AUTH_LOCAL_EMAIL_CONFIRMATION, on unless set to false), and how its link
 * reaches the person: by email through the installed confirmation sender, or,
 * in development without one, in the registration's response (the sign-in
 * screen shows it) and the log. Production without a sender stops startup,
 * because nobody could confirm.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ emailConfirmationSender: boolean, isProduction: boolean }} options
 * @returns {"email" | "dev-response" | "off"}
 */
function resolveConfirmationDelivery(env, { emailConfirmationSender, isProduction }) {
  if (!parseBooleanFlag(env.AUTH_LOCAL_EMAIL_CONFIRMATION, true)) return "off";
  if (emailConfirmationSender) return "email";
  if (isProduction) {
    throw new Error(
      "Local auth confirms each new account's email address in production, and no auth.local.confirmation-sender " +
        "is installed to email the confirmation links. Install one, or set AUTH_LOCAL_EMAIL_CONFIRMATION=false " +
        "to let accounts register without confirming their email."
    );
  }
  return "dev-response";
}

/**
 * The shortest password local auth accepts: AUTH_LOCAL_PASSWORD_MIN_LENGTH, or 8.
 * It can be raised, up to 64, but not lowered below 8.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function resolvePasswordMinLength(env) {
  const raw = String(env.AUTH_LOCAL_PASSWORD_MIN_LENGTH ?? "").trim();
  if (!raw) return AUTH_PASSWORD_MIN_LENGTH;
  const value = parsePositiveInteger(raw);
  if (value === null || value < AUTH_PASSWORD_MIN_LENGTH || value > 64) {
    throw new Error(`AUTH_LOCAL_PASSWORD_MIN_LENGTH must be a whole number from ${AUTH_PASSWORD_MIN_LENGTH} to 64.`);
  }
  return value;
}

/**
 * The local auth configuration, resolved and checked once from the environment.
 * Production is worked out once, by auth-core's dev auth policy, so local auth
 * and its dev sign-in agree on it.
 * @param {object} input
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} input.appRoot
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} input.env
 * @param {boolean} input.fileBackend True when local auth keeps its records in files, because no
 *   `auth.local.backend` is installed.
 * @param {boolean} input.emailRecovery True when an `auth.local.recovery-sender` is installed.
 * @param {boolean} [input.emailConfirmationSender] True when an `auth.local.confirmation-sender` is installed.
 */
function resolveLocalAuthConfig({ appRoot, env, fileBackend, emailRecovery, emailConfirmationSender = false }) {
  const devAuth = resolveDevAuthPolicyFromEnv(env);
  const { isProduction } = devAuth;
  const storeDir = resolveStoreDir(env, appRoot);
  if (fileBackend && isProduction && !parseBooleanFlag(env.AUTH_LOCAL_FILE_PRODUCTION_ACK, false)) {
    throw new Error("AUTH_LOCAL_FILE_PRODUCTION_ACK is required to use the local file auth backend in production.");
  }
  assertDevAuthPolicy(devAuth);
  assertDevelopmentOnlySettings(env, ["AUTH_LOCAL_RECOVERY_DEV_OUTPUT"]);
  const oauthProviders = resolveOAuthProviders(env);
  const oauthEnabled = oauthProviders.length > 0;
  const recoveryDelivery = resolveRecoveryDelivery(env, { emailRecovery, isProduction });
  const confirmationDelivery = resolveConfirmationDelivery(env, { emailConfirmationSender, isProduction });
  return Object.freeze({
    storeDir,
    isProduction,
    appPublicUrl: resolveAppPublicUrl(env, {
      emailRecovery,
      emailedConfirmation: confirmationDelivery === "email",
      oauthEnabled
    }),
    oauthProviders,
    oauthEnabled,
    sessionSecret: resolveSessionSecret(env, { storeDir, isProduction }),
    recoveryDelivery,
    recoveryEnabled: recoveryDelivery !== "disabled",
    confirmationDelivery,
    emailConfirmation: confirmationDelivery !== "off",
    passwordMinLength: resolvePasswordMinLength(env),
    signInThrottle: resolveSignInThrottle(env),
    devAuth
  });
}

export { resolveLocalAuthConfig };
