import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertDevAuthPolicy, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { AUTH_OIDC_DEFAULT_LABEL } from "../../shared/index.js";

const DEFAULT_STORE_DIR = ".jskit/auth";
const SESSION_SECRET_FILE = "oidc-session.secret";

function text(value) {
  return String(value ?? "").trim();
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized === "::1" || /^127(?:\.\d{1,3}){3}$/u.test(normalized);
}

function parseAddress(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a full address such as https://accounts.example.com.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    throw new Error(`${name} must use https (plain http is allowed only on this computer).`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an address without a query or credentials.`);
  }
  return url;
}

// The name an accounts hub shows on its Apps page: the app's package name.
function resolveAppName(appRoot) {
  try {
    const name = String(JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).name || "");
    const words = name.replace(/^@[^/]+\//u, "").replace(/[-_.]+/gu, " ").trim();
    return words ? `${words[0].toUpperCase()}${words.slice(1)}`.slice(0, 80) : "App";
  } catch {
    return "App";
  }
}

function resolveSessionSecret(env, { appRoot, isProduction }) {
  const explicit = text(env.AUTH_OIDC_SESSION_SECRET);
  if (explicit) {
    if (explicit.length < 32) throw new Error("AUTH_OIDC_SESSION_SECRET must be at least 32 characters.");
    return explicit;
  }
  if (isProduction) throw new Error("AUTH_OIDC_SESSION_SECRET is required in production.");
  const storeDir = path.resolve(appRoot, text(env.AUTH_OIDC_STORE_DIR) || DEFAULT_STORE_DIR);
  const secretPath = path.join(storeDir, SESSION_SECRET_FILE);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString("base64url");
  fs.writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

/**
 * Reads the OIDC sign-in Env. Malformed values stop the app with one sentence.
 * A missing issuer or client is not fatal: the app runs and sign-in explains
 * what to set (`setupProblem`), so a project can be prepared before its
 * accounts hub exists.
 */
function resolveOidcConfig({ env = {}, appRoot = process.cwd() } = {}) {
  const isProduction = text(env.NODE_ENV) === "production";
  const issuerValue = text(env.AUTH_OIDC_ISSUER);
  const registrationToken = text(env.AUTH_OIDC_REGISTRATION_TOKEN);
  const clientId = text(env.AUTH_OIDC_CLIENT_ID);
  const clientSecret = text(env.AUTH_OIDC_CLIENT_SECRET);
  const publicUrlValue = text(env.APP_PUBLIC_URL);

  if (registrationToken && clientId) {
    throw new Error("Set AUTH_OIDC_REGISTRATION_TOKEN or AUTH_OIDC_CLIENT_ID, not both.");
  }
  if (clientSecret && !clientId) {
    throw new Error("AUTH_OIDC_CLIENT_SECRET needs AUTH_OIDC_CLIENT_ID.");
  }
  if (clientId && !clientSecret) {
    throw new Error("AUTH_OIDC_CLIENT_ID needs AUTH_OIDC_CLIENT_SECRET.");
  }
  const issuer = issuerValue ? parseAddress(issuerValue, "AUTH_OIDC_ISSUER").href.replace(/\/$/u, "") : "";
  const appPublicOrigin = publicUrlValue ? parseAddress(publicUrlValue, "APP_PUBLIC_URL").origin : "";
  const devAuth = resolveDevAuthPolicyFromEnv(env);
  assertDevAuthPolicy(devAuth);

  let setupProblem = "";
  if (!issuer) setupProblem = "Sign-in is not set up yet: AUTH_OIDC_ISSUER is missing.";
  else if (!registrationToken && !clientId) {
    setupProblem = "Sign-in is not set up yet: set AUTH_OIDC_REGISTRATION_TOKEN, or AUTH_OIDC_CLIENT_ID and AUTH_OIDC_CLIENT_SECRET.";
  }

  return Object.freeze({
    isProduction,
    issuer,
    registrationToken,
    staticClient: clientId ? Object.freeze({ clientId, clientSecret }) : null,
    label: text(env.AUTH_OIDC_LABEL) || AUTH_OIDC_DEFAULT_LABEL,
    appName: resolveAppName(appRoot),
    appPublicOrigin,
    sessionSecret: resolveSessionSecret(env, { appRoot, isProduction }),
    devAuth,
    setupProblem
  });
}

export { isLoopbackHostname, resolveOidcConfig };
