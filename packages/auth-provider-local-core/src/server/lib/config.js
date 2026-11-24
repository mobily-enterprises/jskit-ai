import { parseBooleanFlag } from "@jskit-ai/auth-core/server/booleanFlag";
import { assertDevAuthPolicy, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { resolvePassSignInFromEnv } from "@jskit-ai/auth-pass/server";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTH_PASSWORD_MIN_LENGTH } from "@jskit-ai/auth-core/shared/authConstraints";
import { resolveAuthCookieSameSite } from "@jskit-ai/auth-core/server/utils";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { assertDevelopmentOnlySettings } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { SETUP_CODE_ENV, SETUP_CODE_MIN_CHARACTERS, normalizedSetupCode } from "./firstAccountSetup.js";
import { resolveOAuthProviders } from "./oauth.js";
import { resolveSignInThrottle } from "./signInThrottle.js";
import { resolveAuthorizationClients } from "./clientAuthorization.js";

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
 * AUTH_LOCAL_SESSION_SECRET, or in development and test a secret kept in the
 * store directory, generated on first use.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ storeDir: string, isStagingOrProduction: boolean }} options
 */
function resolveSessionSecret(env, { storeDir, isStagingOrProduction }) {
  const explicit = String(env.AUTH_LOCAL_SESSION_SECRET || "").trim();
  if (explicit) return explicit;
  if (isStagingOrProduction) throw new Error("AUTH_LOCAL_SESSION_SECRET is required for local auth in staging and production.");

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

/** The fewest characters AUTH_LOCAL_SECOND_FACTOR_KEY may have. */
const SECOND_FACTOR_KEY_MIN_CHARACTERS = 32;

/**
 * AUTH_LOCAL_SECOND_FACTOR_KEY: the application's key, from which local auth
 * derives the keys that seal authenticator secrets and hash recovery codes.
 * In development and test the session secret stands in for it. A staging or
 * production server without it has no second factor (""); one shorter than 32
 * characters stops startup.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ isStagingOrProduction: boolean, sessionSecret: string }} options
 */
function resolveSecondFactorKey(env, { isStagingOrProduction, sessionSecret }) {
  const key = String(env.AUTH_LOCAL_SECOND_FACTOR_KEY || "").trim();
  if (key) {
    if (key.length < SECOND_FACTOR_KEY_MIN_CHARACTERS) {
      throw new Error(`AUTH_LOCAL_SECOND_FACTOR_KEY must have at least ${SECOND_FACTOR_KEY_MIN_CHARACTERS} characters.`);
    }
    return key;
  }
  return isStagingOrProduction ? "" : sessionSecret;
}

/**
 * AUTH_LOCAL_SETUP_CODE: the first account's setup code when a hosting tool
 * supplies it, so that every start and every server asks for the same code.
 * Only staging and production ask for a setup code; elsewhere the variable is ignored.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ isStagingOrProduction: boolean }} options
 */
function resolveSetupCode(env, { isStagingOrProduction }) {
  const code = String(env[SETUP_CODE_ENV] || "").trim();
  if (!isStagingOrProduction || !code) return "";
  if (normalizedSetupCode(code).length < SETUP_CODE_MIN_CHARACTERS) {
    throw new Error(`${SETUP_CODE_ENV} must have at least ${SETUP_CODE_MIN_CHARACTERS} letters and digits.`);
  }
  return code;
}

/**
 * APP_PUBLIC_URL, from which recovery, confirmation and email change links and
 * OAuth redirect addresses are built, and whose host authenticator apps show
 * beside a second factor's codes. Emailed links, OAuth sign-in and a staging or
 * production server's second factor require it.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ emailRecovery: boolean, emailedConfirmation: boolean, emailedChange: boolean, oauthEnabled: boolean, stagingOrProductionSecondFactor: boolean }} options
 */
function resolveAppPublicUrl(env, { emailRecovery, emailedConfirmation, emailedChange, oauthEnabled, stagingOrProductionSecondFactor, clients }) {
  const configured = String(env.APP_PUBLIC_URL || "").trim();
  if (!configured) {
    if (clients) throw new Error("APP_PUBLIC_URL is required when config.auth.clients names clients: it is their authorization server's address.");
    if (emailRecovery) throw new Error("APP_PUBLIC_URL is required when local auth email recovery is configured.");
    if (emailedChange) throw new Error("APP_PUBLIC_URL is required when local auth emails email change links.");
    if (emailedConfirmation) {
      throw new Error("APP_PUBLIC_URL is required when local auth emails confirmation links.");
    }
    if (oauthEnabled) throw new Error("APP_PUBLIC_URL is required when local auth OAuth sign-in is configured.");
    if (stagingOrProductionSecondFactor) {
      throw new Error("APP_PUBLIC_URL is required when AUTH_LOCAL_SECOND_FACTOR_KEY is set: authenticator apps show its host.");
    }
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
 * installed recovery sender; otherwise, in development and test, in the log or
 * in the response (AUTH_LOCAL_RECOVERY_DEV_OUTPUT=response). In staging and
 * production without a sender, recovery is disabled, and
 * AUTH_LOCAL_RECOVERY_DEV_OUTPUT stops startup (resolveLocalAuthConfig).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ emailRecovery: boolean, isStagingOrProduction: boolean }} options
 * @returns {"email" | "disabled" | "dev-response" | "dev-log"}
 */
function resolveRecoveryDelivery(env, { emailRecovery, isStagingOrProduction }) {
  if (emailRecovery) return "email";
  if (isStagingOrProduction) return "disabled";
  const devOutput = String(env.AUTH_LOCAL_RECOVERY_DEV_OUTPUT || "").trim().toLowerCase();
  return devOutput === "response" ? "dev-response" : "dev-log";
}

/**
 * Whether a registration waits for its email to be confirmed
 * (AUTH_LOCAL_EMAIL_CONFIRMATION, on unless set to false), and how its link
 * reaches the person: by email through the installed confirmation sender, or,
 * in development and test without one, in the registration's response (the
 * sign-in screen shows it) and the log. Confirmation guards self-registration:
 * in staging and production without a sender, startup stops while anyone may
 * register, because nobody could confirm, and with self-registration off
 * (invited accounts and the first one, admitted by its setup code) nothing is
 * confirmed.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {{ emailConfirmationSender: boolean, isStagingOrProduction: boolean, selfRegistration: boolean }} options
 * @returns {"email" | "dev-response" | "off"}
 */
function resolveConfirmationDelivery(env, { emailConfirmationSender, isStagingOrProduction, selfRegistration }) {
  if (!parseBooleanFlag(env.AUTH_LOCAL_EMAIL_CONFIRMATION, true)) return "off";
  if (emailConfirmationSender) return "email";
  if (isStagingOrProduction) {
    if (!selfRegistration) return "off";
    throw new Error(
      "Local auth confirms each new account's email address in staging and production, and no auth.local.confirmation-sender " +
        "is installed to email the confirmation links. Install one, set AUTH_LOCAL_EMAIL_CONFIRMATION=false " +
        "to let accounts register without confirming their email, or set AUTH_LOCAL_SELF_REGISTRATION=false " +
        "when accounts are only invited."
    );
  }
  return "dev-response";
}

/**
 * How an email change's link and the notice to the old address reach the
 * person: by email through the installed email-change sender; otherwise, in
 * development and test, in the log. A staging or production server without a
 * sender has no email change.
 * @param {{ emailChangeSender: boolean, isStagingOrProduction: boolean }} options
 * @returns {"email" | "dev-log" | "off"}
 */
function resolveEmailChangeDelivery({ emailChangeSender, isStagingOrProduction }) {
  if (emailChangeSender) return "email";
  return isStagingOrProduction ? "off" : "dev-log";
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
 * Whether it runs in staging or production (APP_ENV) is worked out once, by
 * auth-core's dev auth policy, so local auth and its dev sign-in agree on it.
 * @param {object} input
 * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} input.appRoot
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} input.env
 * @param {boolean} input.fileBackend True when local auth keeps its records in files, because no
 *   `auth.local.backend` is installed.
 * @param {boolean} input.emailRecovery True when an `auth.local.recovery-sender` is installed.
 * @param {boolean} [input.emailConfirmationSender] True when an `auth.local.confirmation-sender` is installed.
 * @param {boolean} [input.emailChangeSender] True when an `auth.local.email-change-sender` is installed.
 * @param {unknown} [input.clients] config.auth.clients, the applications people may connect (clientAuthorization.js).
 */
function resolveLocalAuthConfig({ appRoot, env, fileBackend, emailRecovery, emailConfirmationSender = false, emailChangeSender = false, clients: configuredClients }) {
  const devAuth = resolveDevAuthPolicyFromEnv(env);
  const { isStagingOrProduction } = devAuth;
  const storeDir = resolveStoreDir(env, appRoot);
  if (fileBackend && isStagingOrProduction && !parseBooleanFlag(env.AUTH_LOCAL_FILE_STAGING_OR_PRODUCTION_ACK, false)) {
    throw new Error("AUTH_LOCAL_FILE_STAGING_OR_PRODUCTION_ACK is required to use the local file auth backend in staging and production.");
  }
  assertDevAuthPolicy(devAuth);
  assertDevelopmentOnlySettings(env, ["AUTH_LOCAL_RECOVERY_DEV_OUTPUT"]);
  const oauthProviders = resolveOAuthProviders(env);
  const oauthEnabled = oauthProviders.length > 0;
  const recoveryDelivery = resolveRecoveryDelivery(env, { emailRecovery, isStagingOrProduction });
  // AUTH_LOCAL_SELF_REGISTRATION, on unless set to false: off, an account registers only by an invitation a feature
  // resolves, or as the first account.
  const selfRegistration = parseBooleanFlag(env.AUTH_LOCAL_SELF_REGISTRATION, true);
  const confirmationDelivery = resolveConfirmationDelivery(env, { emailConfirmationSender, isStagingOrProduction, selfRegistration });
  const sessionSecret = resolveSessionSecret(env, { storeDir, isStagingOrProduction });
  const secondFactorKey = resolveSecondFactorKey(env, { isStagingOrProduction, sessionSecret });
  const emailChangeDelivery = resolveEmailChangeDelivery({ emailChangeSender, isStagingOrProduction });
  const clients = resolveAuthorizationClients(configuredClients);
  const appPublicUrl = resolveAppPublicUrl(env, {
    emailRecovery,
    emailedConfirmation: confirmationDelivery === "email",
    emailedChange: emailChangeDelivery === "email",
    oauthEnabled,
    stagingOrProductionSecondFactor: isStagingOrProduction && Boolean(secondFactorKey),
    clients: clients.length > 0
  });
  return Object.freeze({
    storeDir,
    isStagingOrProduction,
    // The SameSite of every local auth cookie: AUTH_COOKIE_SAME_SITE, "lax" unless set to "strict".
    cookieSameSite: resolveAuthCookieSameSite(env),
    appPublicUrl,
    oauthProviders,
    oauthEnabled,
    sessionSecret,
    // "" when the server has no second factor.
    secondFactorKey,
    setupCode: resolveSetupCode(env, { isStagingOrProduction }),
    recoveryDelivery,
    recoveryEnabled: recoveryDelivery !== "disabled",
    selfRegistration,
    confirmationDelivery,
    emailConfirmation: confirmationDelivery !== "off",
    emailChangeDelivery,
    passwordMinLength: resolvePasswordMinLength(env),
    signInThrottle: resolveSignInThrottle(env),
    // The trusted issuer's key, audience and resource of one-time pass sign-in (AUTH_PASS_*), or null while it is off.
    passSignIn: resolvePassSignInFromEnv(env),
    // The applications people may connect, so they work in this app as them (config.auth.clients); [] for none.
    clients,
    devAuth
  });
}

export { resolveLocalAuthConfig };
