import * as oauth from "oauth4webapi";
import { createHash } from "node:crypto";
import { registrationClientAuthentication, registrationGrantType } from "../shared/configuration.js";
import { ConnectorError } from "./errors.js";

function validateCallbackUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* reported below */ }
  const localHttp = url?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!url || (!localHttp && url.protocol !== "https:") || url.username || url.password || url.hash || url.search) {
    throw new ConnectorError("connector_callback_invalid", "Configure an HTTPS callback URL, or a local development callback.", { messageCode: "connectors.connection.configureHttpsCallbackUrlLocal" });
  }
  return url.href;
}

/**
 * The credentials an integration's bindings resolve to: its OAuth
 * registration, API key, service-account credential or Env refresh token.
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.config The validated integration configuration.
 * @param {import("./types.js").ResolveReference} dependencies.resolveReference
 */
function createConnectionCredentials({ config, resolveReference }) {
  /**
   * @param {Record<string, any>} integration
   * @param {import("./providerRequests.js").ConnectionProvider} provider
   */
  async function registrationFor(integration, provider) {
    const registration = config.registrations[integration.authentication.registrationRef];
    if (registration?.source !== "own" || integration.authentication.method !== "oauth2" || !provider.oauth) {
      throw new ConnectorError("connector_mode_unavailable", "This runtime does not yet support the selected credential mode.", { messageCode: "connectors.connection.runtimeDoesNotYetSupport" });
    }
    if (registration.clientId.trim() === "MISSING") {
      throw new ConnectorError("connector_binding_missing", "The provider client ID is not configured.", { messageCode: "connectors.connection.providerClientIdNotConfigured" });
    }
    const grantType = registrationGrantType(registration);
    const tokenEndpointAuthMethod = registrationClientAuthentication(registration);
    if (provider.oauthPkce === false && tokenEndpointAuthMethod === "none") {
      throw new ConnectorError("connector_mode_unavailable", "This provider's non-PKCE flow requires a confidential client.", { messageCode: "connectors.connection.providerNonPkceFlowRequires" });
    }
    let clientSecret;
    let callback;
    try {
      if (tokenEndpointAuthMethod !== "none") {
        clientSecret = await resolveReference(registration.clientSecretRef);
        if (typeof clientSecret !== "string" || !clientSecret.trim() || clientSecret.trim() === "MISSING") throw new Error("Invalid client secret.");
      }
      if (grantType === "authorization_code") callback = await resolveReference(registration.callbackUrlRef);
    } catch {
      throw new ConnectorError("connector_binding_missing", "A required registration binding is missing.", { messageCode: "connectors.connection.requiredRegistrationBindingMissing" });
    }
    const callbackUrl = grantType === "authorization_code" ? validateCallbackUrl(callback) : undefined;
    // readable-check: allow method-probe - optional operation: validateCallbackUrl is an optional hook of the provider definition
    if (callbackUrl && typeof provider.validateCallbackUrl === "function" && provider.validateCallbackUrl(callbackUrl) !== true) {
      throw new ConnectorError("connector_callback_invalid", "The callback URL does not meet this provider's requirements.", { messageCode: "connectors.connection.callbackUrlDoesNotMeet" });
    }
    let clientAuth = tokenEndpointAuthMethod === "none" ? oauth.None()
      : tokenEndpointAuthMethod === "client_secret_basic" ? oauth.ClientSecretBasic(clientSecret) : oauth.ClientSecretPost(clientSecret);
    if (tokenEndpointAuthMethod === "client_secret_basic" && provider.oauthBasicEncoding === "raw") {
      clientAuth = (_as, client, _body, headers) => {
        headers.set("authorization", `Basic ${Buffer.from(`${client.client_id}:${clientSecret}`).toString("base64")}`);
      };
    }
    return {
      // readable-check: allow method-probe - data: a provider definition gives oauth as metadata or as a function of the settings
      oauth: typeof provider.oauth === "function" ? provider.oauth(integration.settings || {}) : provider.oauth,
      // readable-check: allow method-probe - data: a provider definition gives oauthResource as a value or as a function of the settings
      resource: typeof provider.oauthResource === "function" ? provider.oauthResource(integration.settings || {}) : provider.oauthResource,
      client: { client_id: registration.clientId },
      clientAuth: provider.oauthClientIdParameter ? (as, client, body, headers) => {
        clientAuth(as, client, body, headers);
        body.set(provider.oauthClientIdParameter, client.client_id);
        body.delete("client_id");
      } : clientAuth,
      tokenEndpointAuthMethod,
      grantType,
      callbackUrl,
      registrationRef: integration.authentication.registrationRef
    };
  }

  /**
   * @param {Record<string, any>} integration
   * @param {import("./providerRequests.js").ConnectionProvider} provider
   */
  async function apiKeyFor(integration, provider) {
    if (!integration.authentication.secretRef && provider.apiKeySecretOptional) return "";
    try {
      const value = await resolveReference(integration.authentication.secretRef);
      if (typeof value !== "string" || (!provider.apiKeySecretOptional && !value.trim()) || value.trim() === "MISSING" || /[\r\n]/u.test(value)) throw new Error("Invalid key.");
      return value;
    } catch {
      throw new ConnectorError("connector_binding_missing", "The API key binding is missing or invalid.", { messageCode: "connectors.connection.apiKeyBindingMissingInvalid" });
    }
  }

  async function serviceAccountCredentialFor(integration) {
    try {
      const credential = await resolveReference(integration.authentication.secretRef);
      if (typeof credential !== "string" || !credential.trim() || credential.trim() === "MISSING" || credential.length > 65_536 || credential.includes("\0")) throw new Error("Invalid credential.");
      return { credential, fingerprint: createHash("sha256").update(credential).digest("hex") };
    } catch {
      throw new ConnectorError("connector_binding_missing", "The service-account credential binding is missing or invalid.", { messageCode: "connectors.connection.serviceAccountCredentialBindingMissing" });
    }
  }

  // An Env refresh token seeds the shared connection; the app then refreshes
  // and stores rotated tokens itself, and reseeds when the value or the OAuth
  // client changes.
  async function envRefreshTokenFor(integration) {
    try {
      const value = await resolveReference(integration.authentication.refreshTokenRef);
      const refreshToken = typeof value === "string" ? value.trim() : "";
      if (!refreshToken || refreshToken === "MISSING" || /\s/u.test(refreshToken)) throw new Error("Invalid token.");
      return { refreshToken, fingerprint: createHash("sha256").update(refreshToken).digest("hex") };
    } catch {
      throw new ConnectorError("connector_binding_missing", "The refresh token binding is missing or invalid.", { messageCode: "connectors.connection.refreshTokenBindingMissingInvalid" });
    }
  }

  return Object.freeze({ registrationFor, apiKeyFor, serviceAccountCredentialFor, envRefreshTokenFor });
}

export { createConnectionCredentials };
