import * as oauth from "oauth4webapi";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { ConnectorError } from "./errors.js";

/** @typedef {import("./types.js").ConnectorProvider & { checkOperation: string }} ConnectionProvider A provider whose checkOperation is resolved for the integration's credential mode. */

// An operation without scopes always runs; otherwise one of its scopes must be present.
function requireOperationScope(operation, scopes, message, { messageCode }) {
  if (operation.scopes.length && !operation.scopes.some((scope) => scopes.includes(scope))) {
    throw new ConnectorError("connector_scope_missing", message, { statusCode: 403, messageCode });
  }
}

// Builds the provider request, reporting schema input errors as connector_input_invalid.
function operationRequest(operation, input, settings, providerData) {
  try { return operation.request(input, settings || {}, providerData); } catch (error) {
    if (!error.fieldErrors) throw error;
    const failure = new ConnectorError("connector_input_invalid", "Check the operation's input values.", { statusCode: 422, messageCode: "connectors.connection.checkOperationInputValues" });
    failure.fieldErrors = error.fieldErrors;
    if (error.fieldErrorCodes) failure.fieldErrorCodes = error.fieldErrorCodes;
    throw failure;
  }
}

/**
 * The requests a connection sends its provider: operations, and the token
 * grants that keep the connection's access current.
 * @param {object} dependencies
 * @param {typeof globalThis.fetch} dependencies.fetchImpl
 * @param {() => number} dependencies.now
 * @param {import("./types.js").ResolveReference} dependencies.resolveReference
 */
function createProviderRequests({ fetchImpl, now, resolveReference }) {
  const http = createHttpClient({ fetchImpl, csrf: { enabled: false }, credentials: "omit" });

  function requestOptions(signal, timeoutMs = 15_000, tokenRequestEncoding) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return {
      [oauth.customFetch]: tokenRequestEncoding === "json" ? (address, options) => {
        const headers = new Headers(options.headers);
        headers.set("Content-Type", "application/json");
        return fetchImpl(address, { ...options, headers,
          body: JSON.stringify(Object.fromEntries(new URLSearchParams(options.body))) });
      } : fetchImpl,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    };
  }

  /**
   * @param {ConnectionProvider} provider
   * @param {string} operationId
   * @param {any} input
   * @param {Record<string, any>} connection
   * @param {AbortSignal} [signal]
   */
  async function request(provider, operationId, input, connection, signal) {
    const operation = provider.operations[operationId];
    if (!operation || !Object.hasOwn(provider.operations, operationId)) {
      throw new ConnectorError("connector_operation_unknown", "This provider operation is not available.", { messageCode: "connectors.connection.providerOperationNotAvailable" });
    }
    if (["oauth2", "service-account"].includes(connection.method || "oauth2")) {
      requireOperationScope(operation, connection.grantedScopes, "Connect again with the permission required for this operation.", { messageCode: "connectors.connection.connectAgainPermissionRequiredOperation" });
    }
    const descriptor = operationRequest(operation, input, connection.settings, connection.providerData);
    const url = new URL(descriptor.url);
    // readable-check: allow method-probe - data: a provider definition gives apiOrigins as a list or as a function of the settings
    const origins = typeof provider.apiOrigins === "function" ? provider.apiOrigins(connection.settings || {}, connection.providerData) : provider.apiOrigins;
    if (url.protocol !== "https:" || url.username || url.password || !origins.includes(url.origin)) {
      throw new ConnectorError("connector_destination_invalid", "The provider operation has an invalid destination.", { messageCode: "connectors.connection.providerOperationInvalidDestination" });
    }
    if (connection.method === "api-key" && provider.apiKey.pathPrefix) {
      const prefix = provider.apiKey.pathPrefix(connection.apiKey);
      if (typeof prefix !== "string" || !prefix.startsWith("/") || prefix.startsWith("//") ||
        /[?#\\]/.test(prefix) || prefix.split("/").some((part) => /^(?:\.|%2e){1,2}$/i.test(part))) {
        throw new ConnectorError("connector_request_invalid", "This provider has an invalid credential path.", { messageCode: "connectors.connection.providerInvalidCredentialPath" });
      }
      // A pathname assignment cannot replace the already checked origin.
      url.pathname = prefix + url.pathname;
    }
    if (connection.method === "api-key" && provider.apiKey.queryParameter) {
      url.searchParams.set(provider.apiKey.queryParameter, connection.apiKey);
    }
    let body = descriptor.body;
    if (connection.method === "api-key" && provider.apiKey.bodyParameter) {
      if (!body || typeof body !== "object" || Array.isArray(body) || ["GET", "HEAD"].includes(descriptor.method)) {
        throw new ConnectorError("connector_request_invalid", "This provider requires a JSON request body.", { messageCode: "connectors.connection.providerRequiresJsonRequestBody" });
      }
      body = { ...body, [provider.apiKey.bodyParameter]: connection.apiKey };
    }
    const options = {
      method: descriptor.method,
      body,
      headers: { ...descriptor.headers, Accept: "application/json", ...(connection.method === "api-key"
        // readable-check: allow optional-call - input validation: an optional hook of the provider definition
        ? provider.apiKey.headers?.(connection.apiKey, connection.settings || {})
        : connection.method === "none" ? {} : {
          // readable-check: allow optional-call - input validation: an optional hook of the provider definition
          ...provider.oauthHeaders?.({ clientId: connection.clientId }), Authorization: `Bearer ${connection.tokens.accessToken}`
        }) },
      redirect: "error",
      signal: requestOptions(signal, provider.requestTimeoutMs).signal
    };
    let result;
    try {
      result = provider.exchange
        ? await provider.exchange(url.href, options, { fetchImpl, request: http.request, resolveReference,
          settings: connection.settings || {}, apiKey: connection.method === "api-key" ? connection.apiKey : undefined })
        : await http.request(url.href, options);
    } catch (error) {
      // Transports can wrap cancellation in a network or protocol error.
      options.signal.throwIfAborted();
      throw error;
    }
    // The validator also receives the operation's own request, so it can check the provider answered what was asked.
    // readable-check: allow method-probe - input validation: an optional hook of the provider definition
    if (typeof operation.validateResult === "function" && !operation.validateResult(result, descriptor)) {
      throw new ConnectorError("connector_response_invalid", "The provider returned an unexpected response.", { statusCode: 502, messageCode: "connectors.connection.providerReturnedUnexpectedResponse" });
    }
    return result;
  }

  /**
   * @param {any} response
   * @param {Record<string, any> | null} previous
   * @param {string[]} requestedScopes
   * @param {string} [scopeSeparator]
   * @param {ConnectionProvider} [provider]
   */
  function tokensFrom(response, previous, requestedScopes, scopeSeparator = " ", provider) {
    return {
      ...(provider?.dataFromTokenResponse ? { providerData: provider.dataFromTokenResponse(response, previous?.providerData) } : {}),
      tokens: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token || previous?.tokens.refreshToken || null,
        expiresAt: response.expires_in === undefined ? null : now() + response.expires_in * 1000
      },
      grantedScopes: response.scope === undefined
        ? [...(previous?.grantedScopes || requestedScopes)]
        : response.scope.split(scopeSeparator).map((scope) => scope.trim()).filter(Boolean)
    };
  }

  /**
   * @param {Record<string, any>} integration
   * @param {ConnectionProvider} provider
   * @param {{ credential: string, fingerprint: string }} binding
   * @param {AbortSignal} [signal]
   */
  async function serviceAccountGrant(integration, provider, binding, signal) {
    // readable-check: allow method-probe - input validation: a provider definition may lack serviceAccountGrant()
    if (typeof provider.serviceAccountGrant !== "function") {
      throw new ConnectorError("connector_mode_unavailable", "This provider does not implement service-account authorization.", { messageCode: "connectors.connection.providerDoesNotImplementService" });
    }
    const options = requestOptions(signal, provider.requestTimeoutMs);
    options.signal.throwIfAborted();
    let response;
    try {
      response = await provider.serviceAccountGrant({
        credential: binding.credential, settings: structuredClone(integration.settings || {}),
        scopes: [...integration.scopes], fetchImpl, signal: options.signal, now: now()
      });
    } catch (error) {
      options.signal.throwIfAborted();
      throw error;
    }
    options.signal.throwIfAborted();
    if (typeof response?.access_token !== "string" || !response.access_token || /\s/u.test(response.access_token) ||
        // readable-check: allow optional-call - data: the provider's token response
        response.token_type?.toLowerCase?.() !== "bearer" ||
        !Number.isFinite(response.expires_in) || response.expires_in <= 0 || response.expires_in > 86_400 ||
        response.refresh_token !== undefined || (response.scope !== undefined && typeof response.scope !== "string")) {
      throw new ConnectorError("connector_response_invalid", "The provider returned an invalid service-account token.", { statusCode: 502, messageCode: "connectors.connection.providerReturnedInvalidServiceAccount" });
    }
    const grant = tokensFrom(response, null, integration.scopes, provider.scopeSeparator, provider);
    grant.grantedScopes = grant.grantedScopes.filter((scope) => integration.scopes.includes(scope));
    return { ...grant, credentialFingerprint: binding.fingerprint };
  }

  /**
   * @param {ConnectionProvider} provider
   * @param {Record<string, any>} connection
   * @param {any} verificationInput
   * @param {string[]} requestedScopes
   * @param {AbortSignal} [signal]
   */
  async function verifyOAuthConnection(provider, connection, verificationInput, requestedScopes, signal) {
    const verification = await request(provider, provider.checkOperation, verificationInput, connection, signal);
    if (provider.accountLabelFromVerification) {
      const label = provider.accountLabelFromVerification(verification);
      if (typeof label !== "string" || !label.trim() || label.length > 256 || /[\p{Cc}\p{Cf}]/u.test(label)) {
        throw new ConnectorError("connector_response_invalid", "The provider returned an invalid account label.", { statusCode: 502, messageCode: "connectors.connection.providerReturnedInvalidAccountLabel" });
      }
      connection.accountLabel = label;
    }
    if (!provider.grantedScopesFromVerification) return;
    const scopes = provider.grantedScopesFromVerification(verification, { clientId: connection.clientId });
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !scope)) {
      throw new ConnectorError("connector_response_invalid", "The provider returned an invalid permission grant.", { statusCode: 502, messageCode: "connectors.connection.providerReturnedInvalidPermissionGrant" });
    }
    connection.grantedScopes = connection.grantedScopes.filter((scope) => requestedScopes.includes(scope) && scopes.includes(scope));
    requireOperationScope(provider.operations[provider.checkOperation], connection.grantedScopes, "Connect again with the permission required for verification.", { messageCode: "connectors.connection.connectAgainPermissionRequiredVerification" });
  }

  /**
   * @param {Record<string, any>} registration
   * @param {ConnectionProvider} provider
   * @param {Record<string, any>} settings
   * @param {string[]} scopes
   * @param {AbortSignal} [signal]
   */
  async function clientCredentialsGrant(registration, provider, settings, scopes, signal) {
    const response = await oauth.clientCredentialsGrantRequest(
      registration.oauth, registration.client, registration.clientAuth,
      { scope: scopes.join(provider.scopeSeparator || " "), ...(registration.resource ? { resource: registration.resource } : {}) },
      requestOptions(signal)
    );
    const result = await oauth.processClientCredentialsResponse(registration.oauth, registration.client,
      provider.normalizeTokenResponse ? await provider.normalizeTokenResponse(response, { settings, grantType: "client_credentials" }) : response);
    const grant = tokensFrom(result, null, scopes, provider.scopeSeparator, provider);
    // Client credentials renew with the application's secret, never a user refresh token.
    grant.tokens.refreshToken = null;
    grant.grantedScopes = grant.grantedScopes.filter((scope) => scopes.includes(scope));
    return grant;
  }

  return Object.freeze({ requestOptions, request, tokensFrom, serviceAccountGrant, verifyOAuthConnection, clientCredentialsGrant });
}

export { createProviderRequests, operationRequest, requireOperationScope };
