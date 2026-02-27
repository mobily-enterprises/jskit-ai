import { normalizeOAuthProviderId } from "./oauthProviders.js";

const AUTH_METHOD_PASSWORD_ID = "password";
const AUTH_METHOD_PASSWORD_PROVIDER = "email";
const AUTH_METHOD_EMAIL_OTP_ID = "email_otp";
const AUTH_METHOD_EMAIL_OTP_PROVIDER = "email";

const AUTH_METHOD_KIND_PASSWORD = "password";
const AUTH_METHOD_KIND_OTP = "otp";
const AUTH_METHOD_KIND_OAUTH = "oauth";
const AUTH_METHOD_KINDS = Object.freeze([AUTH_METHOD_KIND_PASSWORD, AUTH_METHOD_KIND_OTP, AUTH_METHOD_KIND_OAUTH]);

const AUTH_METHOD_MINIMUM_ENABLED = 1;

const AUTH_METHOD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: AUTH_METHOD_PASSWORD_ID,
    kind: AUTH_METHOD_KIND_PASSWORD,
    provider: AUTH_METHOD_PASSWORD_PROVIDER,
    label: "Password",
    supportsSecretUpdate: true
  }),
  Object.freeze({
    id: AUTH_METHOD_EMAIL_OTP_ID,
    kind: AUTH_METHOD_KIND_OTP,
    provider: AUTH_METHOD_EMAIL_OTP_PROVIDER,
    label: "Email one-time code",
    supportsSecretUpdate: false
  })
]);

const AUTH_METHOD_IDS = Object.freeze(AUTH_METHOD_DEFINITIONS.map((definition) => definition.id));

function buildOAuthMethodId(providerId) {
  const normalizedProviderId = normalizeOAuthProviderId(providerId, { fallback: null });
  if (!normalizedProviderId) {
    return null;
  }

  return `oauth:${normalizedProviderId}`;
}

function parseAuthMethodId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === AUTH_METHOD_PASSWORD_ID) {
    return {
      id: AUTH_METHOD_PASSWORD_ID,
      kind: AUTH_METHOD_KIND_PASSWORD,
      provider: AUTH_METHOD_PASSWORD_PROVIDER
    };
  }

  if (normalized === AUTH_METHOD_EMAIL_OTP_ID) {
    return {
      id: AUTH_METHOD_EMAIL_OTP_ID,
      kind: AUTH_METHOD_KIND_OTP,
      provider: AUTH_METHOD_EMAIL_OTP_PROVIDER
    };
  }

  if (normalized.startsWith("oauth:")) {
    const providerId = normalizeOAuthProviderId(normalized.slice("oauth:".length), {
      fallback: null
    });
    if (!providerId) {
      return null;
    }

    return {
      id: buildOAuthMethodId(providerId),
      kind: AUTH_METHOD_KIND_OAUTH,
      provider: providerId
    };
  }

  return null;
}

function normalizeOAuthMethodDefinitionInput(entry) {
  if (typeof entry === "string") {
    const providerId = normalizeOAuthProviderId(entry, { fallback: null });
    if (!providerId) {
      return null;
    }

    return {
      id: providerId,
      label: providerId
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const providerId = normalizeOAuthProviderId(entry.id, { fallback: null });
  if (!providerId) {
    return null;
  }

  const label = String(entry.label || providerId).trim() || providerId;
  return {
    id: providerId,
    label
  };
}

function buildOAuthMethodDefinitions(oauthProviders = []) {
  const definitions = [];

  for (const rawProvider of Array.isArray(oauthProviders) ? oauthProviders : []) {
    const normalized = normalizeOAuthMethodDefinitionInput(rawProvider);
    if (!normalized || definitions.some((definition) => definition.provider === normalized.id)) {
      continue;
    }

    definitions.push(
      Object.freeze({
        id: buildOAuthMethodId(normalized.id),
        kind: AUTH_METHOD_KIND_OAUTH,
        provider: normalized.id,
        label: normalized.label,
        supportsSecretUpdate: false
      })
    );
  }

  return Object.freeze(definitions);
}

function buildAuthMethodDefinitions({ oauthProviders = [] } = {}) {
  return Object.freeze([...AUTH_METHOD_DEFINITIONS, ...buildOAuthMethodDefinitions(oauthProviders)]);
}

function buildAuthMethodIds(options = {}) {
  return Object.freeze(buildAuthMethodDefinitions(options).map((definition) => definition.id));
}

function findAuthMethodDefinition(methodId, options = {}) {
  const normalized = parseAuthMethodId(methodId);
  if (!normalized) {
    return null;
  }

  const found = buildAuthMethodDefinitions(options).find((definition) => definition.id === normalized.id);
  return found || null;
}

export {
  AUTH_METHOD_PASSWORD_ID,
  AUTH_METHOD_PASSWORD_PROVIDER,
  AUTH_METHOD_EMAIL_OTP_ID,
  AUTH_METHOD_EMAIL_OTP_PROVIDER,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KINDS,
  AUTH_METHOD_MINIMUM_ENABLED,
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_IDS,
  buildOAuthMethodId,
  parseAuthMethodId,
  buildOAuthMethodDefinitions,
  buildAuthMethodDefinitions,
  buildAuthMethodIds,
  findAuthMethodDefinition
};
