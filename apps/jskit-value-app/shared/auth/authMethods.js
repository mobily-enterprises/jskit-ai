import { AUTH_OAUTH_PROVIDER_METADATA, AUTH_OAUTH_PROVIDERS, normalizeOAuthProvider } from "./oauthProviders.js";

const AUTH_METHOD_PASSWORD_ID = "password";
const AUTH_METHOD_PASSWORD_PROVIDER = "email";
const AUTH_METHOD_EMAIL_OTP_ID = "email_otp";
const AUTH_METHOD_EMAIL_OTP_PROVIDER = "email";

const AUTH_METHOD_KIND_PASSWORD = "password";
const AUTH_METHOD_KIND_OTP = "otp";
const AUTH_METHOD_KIND_OAUTH = "oauth";
const AUTH_METHOD_KINDS = Object.freeze([AUTH_METHOD_KIND_PASSWORD, AUTH_METHOD_KIND_OTP, AUTH_METHOD_KIND_OAUTH]);

const AUTH_METHOD_MINIMUM_ENABLED = 1;

function buildOAuthMethodId(provider) {
  const normalized = normalizeOAuthProvider(provider, { fallback: null });
  if (!normalized) {
    return null;
  }

  return `oauth:${normalized}`;
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
    const provider = normalizeOAuthProvider(normalized.slice("oauth:".length), {
      fallback: null
    });
    if (!provider) {
      return null;
    }

    return {
      id: buildOAuthMethodId(provider),
      kind: AUTH_METHOD_KIND_OAUTH,
      provider
    };
  }

  return null;
}

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
  }),
  ...AUTH_OAUTH_PROVIDERS.map((provider) =>
    Object.freeze({
      id: buildOAuthMethodId(provider),
      kind: AUTH_METHOD_KIND_OAUTH,
      provider,
      label: String(AUTH_OAUTH_PROVIDER_METADATA[provider]?.label || provider),
      supportsSecretUpdate: false
    })
  )
]);

const AUTH_METHOD_IDS = Object.freeze(AUTH_METHOD_DEFINITIONS.map((definition) => definition.id));

function findAuthMethodDefinition(methodId) {
  const normalized = parseAuthMethodId(methodId);
  if (!normalized) {
    return null;
  }

  const found = AUTH_METHOD_DEFINITIONS.find((definition) => definition.id === normalized.id);
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
  findAuthMethodDefinition
};
