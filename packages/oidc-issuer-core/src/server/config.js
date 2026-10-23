import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MIN_SECRET_BYTES = 32;
const DEV_SECRET_FILE = ".jskit/oidc-hub/secret";

class HubConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "HubConfigError";
    this.code = "oidc_hub_config_invalid";
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function isLoopbackHostname(hostname) {
  const host = text(hostname).toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/u.test(host);
}

function resolveIssuer(env, isProduction) {
  const configured = text(env.APP_PUBLIC_URL);
  if (!configured) {
    if (isProduction) {
      throw new HubConfigError("Set APP_PUBLIC_URL to your hub's https address before starting it in production.");
    }
    const port = Number.parseInt(text(env.PORT), 10) || 3001;
    return `http://localhost:${port}`;
  }
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new HubConfigError("APP_PUBLIC_URL must be a full address such as https://accounts.example.com.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    throw new HubConfigError("APP_PUBLIC_URL must use https unless the hub runs on this computer.");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new HubConfigError("APP_PUBLIC_URL must be the hub's origin only, without a path.");
  }
  return url.origin;
}

function readOrCreateDevSecret(appRoot) {
  const secretPath = path.resolve(appRoot, DEV_SECRET_FILE);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  const generated = randomBytes(48).toString("base64url");
  fs.writeFileSync(secretPath, `${generated}\n`, { mode: 0o600 });
  return generated;
}

function resolveSecret(env, { isProduction, appRoot }) {
  const configured = text(env.OIDC_HUB_SECRET);
  if (!configured) {
    if (isProduction || !appRoot) {
      throw new HubConfigError("Set OIDC_HUB_SECRET to a random value of at least 32 bytes.");
    }
    return readOrCreateDevSecret(appRoot);
  }
  if (Buffer.byteLength(configured, "utf8") < MIN_SECRET_BYTES) {
    throw new HubConfigError("OIDC_HUB_SECRET is too short: use at least 32 random bytes.");
  }
  return configured;
}

function parseDevOriginPatterns(value) {
  const patterns = [];
  for (const raw of text(value).split(",")) {
    const pattern = raw.trim().toLowerCase().replace(/\/+$/u, "");
    if (!pattern) continue;
    const match = /^https:\/\/([a-z0-9*-]+(?:\.[a-z0-9*-]+)+)(?::(\d{1,5}))?$/u.exec(pattern);
    if (!match) {
      throw new HubConfigError(
        `OIDC_HUB_DEV_ORIGIN_PATTERNS entry "${raw.trim()}" must look like https://v64preview-*--team.example.dev.`
      );
    }
    const labels = match[1].split(".");
    if (labels.slice(-2).some((label) => label.includes("*"))) {
      throw new HubConfigError(
        `OIDC_HUB_DEV_ORIGIN_PATTERNS entry "${raw.trim()}" may use * only below the registered domain.`
      );
    }
    patterns.push(pattern);
  }
  return Object.freeze(patterns);
}

function resolveMail(env, { isProduction }) {
  const from = text(env.OIDC_HUB_EMAIL_FROM);
  const resendApiKey = text(env.RESEND_API_KEY);
  const smtpUrl = text(env.SMTP_URL);
  if (isProduction && (!from || (!resendApiKey && !smtpUrl))) {
    throw new HubConfigError(
      "Set OIDC_HUB_EMAIL_FROM and either RESEND_API_KEY or SMTP_URL so the hub can send confirmation and recovery emails."
    );
  }
  return Object.freeze({ from, resendApiKey, smtpUrl });
}

function resolveGoogle(env) {
  const clientId = text(env.OIDC_HUB_GOOGLE_CLIENT_ID);
  const clientSecret = text(env.OIDC_HUB_GOOGLE_CLIENT_SECRET);
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new HubConfigError("Set both OIDC_HUB_GOOGLE_CLIENT_ID and OIDC_HUB_GOOGLE_CLIENT_SECRET, or neither.");
  }
  return clientId ? Object.freeze({ clientId, clientSecret }) : null;
}

/**
 * Reads and validates the hub's environment. Every problem is one sentence
 * naming the variable to fix.
 */
function resolveHubConfig(env = {}, { appRoot = "" } = {}) {
  const isProduction = text(env.NODE_ENV).toLowerCase() === "production";
  const registrationToken = text(env.OIDC_HUB_REGISTRATION_TOKEN);
  if (!registrationToken) {
    throw new HubConfigError("Set OIDC_HUB_REGISTRATION_TOKEN: apps present it when they register with the hub.");
  }
  if (registrationToken.length < 24) {
    throw new HubConfigError("OIDC_HUB_REGISTRATION_TOKEN is too short: use a generated value of at least 24 characters.");
  }
  const ownerEmail = text(env.OIDC_HUB_OWNER_EMAIL).toLowerCase();
  if (!ownerEmail || !ownerEmail.includes("@")) {
    throw new HubConfigError("Set OIDC_HUB_OWNER_EMAIL to the email address of the hub's owner.");
  }
  const issuer = resolveIssuer(env, isProduction);
  return Object.freeze({
    isProduction,
    issuer,
    secure: issuer.startsWith("https:"),
    secret: resolveSecret(env, { isProduction, appRoot }),
    secretFromEnv: Boolean(text(env.OIDC_HUB_SECRET)),
    registrationToken,
    ownerEmail,
    devOriginPatterns: parseDevOriginPatterns(env.OIDC_HUB_DEV_ORIGIN_PATTERNS),
    google: resolveGoogle(env),
    mail: resolveMail(env, { isProduction })
  });
}

export { HubConfigError, isLoopbackHostname, resolveHubConfig };
