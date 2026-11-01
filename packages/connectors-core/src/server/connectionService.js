import * as oauth from "oauth4webapi";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { registrationClientAuthentication, registrationGrantType, validateIntegrationConfiguration } from "../shared/configuration.js";
import { createConnectionCredentials } from "./connectionCredentials.js";
import { ConnectorError, providerError } from "./errors.js";
import { connectionProvider, createProviderRequests, operationRequest, requireOperationScope, tokenResponse } from "./providerRequests.js";

function publicConnection(connection) {
  if (!connection) return { status: "disconnected" };
  return {
    status: connection.status,
    provider: connection.provider,
    integrationId: connection.integrationId,
    grantedScopes: [...connection.grantedScopes],
    verifiedAt: connection.verifiedAt,
    ...(connection.accountLabel ? { accountLabel: connection.accountLabel } : {}),
    ...(connection.source ? { source: connection.source } : {})
  };
}

const ENV_SEEDED_MESSAGE = "This connection comes from an Env value; unlink or replace that value instead.";
const ENV_SEEDED_CODE = { messageCode: "connectors.connection.envSeeded" };
const VERIFICATION_SCOPE_MESSAGE = "Connection verification requires a permission absent from the application's configuration.";
const VERIFICATION_SCOPE_CODE = { messageCode: "connectors.connection.verificationScopeAbsent" };

// Whether a stored connection still belongs to the configured integration and
// OAuth client. `registration` is { registrationRef, clientId, grantType,
// tokenEndpointAuthMethod } with defaults applied; only OAuth reads it.
function connectionMatches(connection, integration, providerId, registration) {
  const method = integration.authentication.method;
  return connection.provider === providerId &&
    (connection.method || "oauth2") === method &&
    isDeepStrictEqual(connection.settings || {}, integration.settings) &&
    (!["api-key", "service-account"].includes(method) || connection.secretRef === integration.authentication.secretRef) &&
    (method !== "service-account" || isDeepStrictEqual(connection.requestedScopes, integration.scopes)) &&
    (method !== "oauth2" || (connection.registrationRef === registration.registrationRef &&
      connection.clientId === registration.clientId &&
      registrationGrantType(connection) === registration.grantType &&
      (registration.grantType !== "client_credentials" || isDeepStrictEqual(connection.requestedScopes, integration.scopes)) &&
      registrationClientAuthentication(connection) === registration.tokenEndpointAuthMethod));
}

// Providers that resend redirect_uri on refresh need the callback the grant was issued for.
function callbackMatches(connection, provider, registration) {
  return registration.grantType !== "authorization_code" || !provider.refreshRequiresRedirectUri ||
    connection.callbackUrl === registration.callbackUrl;
}

/**
 * The connections of one application's configured integrations: authorization,
 * connection, provider operations, status and disconnection.
 * @param {object} options
 * @param {Record<string, any>} options.configuration The integration configuration, validated here against the providers.
 * @param {import("./types.js").ConnectorProvider[]} options.providers
 * @param {import("./types.js").ResolveReference} options.resolveReference
 * @param {import("./types.js").ConnectionStore} options.store
 * @param {import("./types.js").ConnectorAuthorize} options.authorize
 * @param {"application" | "assistant"} [options.executionMode]
 * @param {typeof globalThis.fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
function createConnectionService({
  configuration,
  providers,
  resolveReference,
  store,
  authorize,
  executionMode = "application",
  fetchImpl = globalThis.fetch,
  now = Date.now
}) {
  if (!["application", "assistant"].includes(executionMode)) throw new TypeError("Select application or assistant execution.");
  const config = validateIntegrationConfiguration(configuration, { providers });
  // Each integration with its settings resolved, so the service reads them as one object.
  const integrations = Object.fromEntries(Object.entries(config.integrations)
    .map(([id, integration]) => [id, { ...integration, settings: integration.settings || {} }]));
  const definitions = new Map(providers.map((provider) => [provider.id, provider]));
  if (!providers.length || definitions.size !== providers.length) throw new TypeError("Register unique connector providers.");
  // readable-check: allow method-probe - input validation: the application passes its access policy and reference resolver
  if (typeof authorize !== "function" || typeof resolveReference !== "function") {
    throw new TypeError("Connections require application authorization and reference resolution.");
  }
  // readable-check: allow method-probe - input validation: the application passes its own connection store
  if (typeof store?.withConnection !== "function") throw new TypeError("Connection storage requires withConnection().");
  const connectionCredentials = createConnectionCredentials({ config, resolveReference });
  const providerRequests = createProviderRequests({ fetchImpl, now, resolveReference });

  async function access(context, integrationId, operation, input, checkAssistantPermission = true) {
    const integration = integrations[integrationId];
    if (!Object.hasOwn(integrations, integrationId)) {
      throw new ConnectorError("connector_not_found", "This integration is not configured.", { statusCode: 404, messageCode: "connectors.connection.integrationNotConfigured" });
    }
    const provider = connectionProvider(definitions.get(integration.provider), integration);
    let assistantPermission;
    if (executionMode === "assistant" && checkAssistantPermission && !["status", "disconnect"].includes(operation)) {
      // A configuration-only definition has no operations; its connection steps refuse it.
      const action = provider.operations?.[operation]?.assistantAction || operation;
      const policy = integration.assistantPolicy;
      const decision = policy?.enabled === false ? "never" : policy?.actions?.[action] || policy?.defaultPermission || "ask";
      if (decision === "never") {
        throw new ConnectorError("connector_access_denied", "This assistant action is disabled.", { statusCode: 403, messageCode: "connectors.connection.assistantActionDisabled" });
      }
      assistantPermission = { action, decision };
    }
    const owner = await authorize(context, { integrationId, operation, accountMode: integration.accountMode,
      ...(assistantPermission ? { assistantPermission: { ...assistantPermission } } : {}),
      ...(input === undefined ? {} : { input: structuredClone(input) }) });
    if (!owner || typeof owner.applicationId !== "string" || !owner.applicationId ||
      typeof owner.subjectId !== "string" || !owner.subjectId) {
      throw new ConnectorError("connector_access_denied", "You cannot use this connection.", { statusCode: 403, messageCode: "connectors.connection.connectionNotAllowed" });
    }
    if (assistantPermission?.decision === "ask" && owner.approved !== true) {
      throw new ConnectorError("connector_approval_required", "Approve this assistant action before continuing.", { statusCode: 409 });
    }
    const methods = provider.operations?.[operation]?.authenticationMethods;
    if (methods && !methods.includes(integration.authentication.method)) {
      throw new ConnectorError("connector_mode_unavailable", "This operation requires a different connection method.", { messageCode: "connectors.connection.operationRequiresDifferentMethod" });
    }
    return { owner: { applicationId: owner.applicationId, subjectId: owner.subjectId }, integration, provider };
  }

  /** @param {import("./types.js").IntegrationRequest & { action: string, input?: any }} request */
  async function authorizeAssistantAction({ context, integrationId, action, input = {} }) {
    const provider = definitions.get(integrations[integrationId]?.provider);
    if (executionMode !== "assistant" || !provider?.assistantActions?.some((item) => item.value === action)) {
      throw new ConnectorError("connector_operation_unknown", "This provider does not declare this assistant action.", { messageCode: "connectors.connection.providerDoesNotDeclareAssistant" });
    }
    await access(context, integrationId, action, structuredClone(input));
    // The host performs its own lifecycle operation after authorization; no provider action is executed here.
  }

  function envSeedIsCurrent(connection, seed, registration) {
    return connection?.seedFingerprint === seed.fingerprint && connection.clientId === registration.client.client_id &&
      connection.registrationRef === registration.registrationRef &&
      connection.tokenEndpointAuthMethod === registration.tokenEndpointAuthMethod;
  }

  function envSeededConnection(integrationId, integration, provider, registration, seed) {
    return {
      integrationId, provider: provider.id, registrationRef: registration.registrationRef,
      grantType: registration.grantType, clientId: registration.client.client_id,
      tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod, status: "connected", source: "env",
      seedFingerprint: seed.fingerprint, verifiedAt: now(), settings: structuredClone(integration.settings),
      ...(provider.refreshRequiresRedirectUri ? { callbackUrl: registration.callbackUrl } : {}),
      tokens: { accessToken: null, refreshToken: seed.refreshToken, expiresAt: 0 },
      grantedScopes: [...integration.scopes]
    };
  }

  /** @param {import("./types.js").ConnectRequest} request */
  async function connectServiceAccount({ context, integrationId, verificationInput = {}, signal }) {
    verificationInput = structuredClone(verificationInput);
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    // readable-check: allow method-probe - optional operation: serviceAccountGrant is an optional hook of the provider definition
    if (integration.authentication.method !== "service-account" || typeof provider.serviceAccountGrant !== "function") {
      throw new ConnectorError("connector_mode_unavailable", "Select service-account credentials to verify this connection.", { messageCode: "connectors.connection.selectServiceAccountCredentialsVerify" });
    }
    operationRequest(provider.operations[provider.checkOperation], verificationInput, integration.settings);
    requireOperationScope(provider.operations[provider.checkOperation], integration.scopes, VERIFICATION_SCOPE_MESSAGE, VERIFICATION_SCOPE_CODE);
    return store.withConnection({ owner, integrationId }, async ({ save }) => {
      try {
        const binding = await connectionCredentials.serviceAccountCredentialFor(integration);
        const connection = {
          integrationId, provider: provider.id, method: "service-account", secretRef: integration.authentication.secretRef,
          requestedScopes: [...integration.scopes], settings: structuredClone(integration.settings),
          status: "connected", verifiedAt: now(), ...await providerRequests.serviceAccountGrant(integration, provider, binding, signal)
        };
        await providerRequests.request(provider, provider.checkOperation, verificationInput, connection, signal);
        await save(connection);
        return publicConnection(connection);
      } catch (error) { throw providerError(error); }
    });
  }

  /** @param {import("./types.js").ConnectRequest} request */
  async function connectClientCredentials({ context, integrationId, verificationInput = {}, signal }) {
    verificationInput = structuredClone(verificationInput);
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    const registration = await connectionCredentials.registrationFor(integration, provider);
    if (registration.grantType !== "client_credentials") {
      throw new ConnectorError("connector_mode_unavailable", "Select client credentials to connect a service account.", { messageCode: "connectors.connection.selectClientCredentialsConnectService" });
    }
    operationRequest(provider.operations[provider.checkOperation], verificationInput, integration.settings);
    requireOperationScope(provider.operations[provider.checkOperation], integration.scopes, VERIFICATION_SCOPE_MESSAGE, VERIFICATION_SCOPE_CODE);
    return store.withConnection({ owner, integrationId }, async ({ save }) => {
      try {
        const connection = {
          integrationId, provider: provider.id, registrationRef: registration.registrationRef,
          clientId: registration.client.client_id, tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
          grantType: registration.grantType, requestedScopes: [...integration.scopes],
          settings: structuredClone(integration.settings), status: "connected", verifiedAt: now(),
          ...await providerRequests.clientCredentialsGrant(registration, provider, integration.settings, integration.scopes, signal)
        };
        await providerRequests.verifyOAuthConnection(provider, connection, verificationInput, integration.scopes, signal);
        await save(connection);
        return publicConnection(connection);
      } catch (error) { throw providerError(error); }
    });
  }

  /** @param {import("./types.js").ConnectRequest} request */
  async function beginAuthorization({ context, integrationId, verificationInput = {}, signal }) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    if (integration.authentication.refreshTokenRef) {
      throw new ConnectorError("connector_env_managed", ENV_SEEDED_MESSAGE, { statusCode: 409, ...ENV_SEEDED_CODE });
    }
    // Resource-specific providers validate the first document ID before opening consent.
    operationRequest(provider.operations[provider.checkOperation], verificationInput, integration.settings);
    const registration = await connectionCredentials.registrationFor(integration, provider);
    if (registration.grantType !== "authorization_code") {
      throw new ConnectorError("connector_mode_unavailable", "Service accounts connect without browser consent.", { messageCode: "connectors.connection.serviceAccountsConnectWithoutBrowser" });
    }
    signal?.throwIfAborted();
    const state = oauth.generateRandomState();
    const codeVerifier = provider.oauthPkce === false ? null : oauth.generateRandomCodeVerifier();
    const url = new URL(registration.oauth.authorization_endpoint);
    for (const [key, value] of Object.entries(provider.authorizationParameters || {})) url.searchParams.set(key, value);
    if (registration.resource) url.searchParams.set("resource", registration.resource);
    url.searchParams.set(provider.oauthClientIdParameter || "client_id", registration.client.client_id);
    url.searchParams.set("redirect_uri", registration.callbackUrl);
    url.searchParams.set("response_type", "code");
    // readable-check: allow method-probe - optional operation: authorizationScopeParameter is an optional hook of the provider definition
    const scopeParameter = (typeof provider.authorizationScopeParameter === "function" && provider.authorizationScopeParameter(integration.settings)) || "scope";
    if (integration.scopes.length) url.searchParams.set(scopeParameter, integration.scopes.join(provider.scopeSeparator));
    url.searchParams.set("state", state);
    if (codeVerifier !== null) {
      url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
    }
    const expiresAt = now() + 10 * 60 * 1000;
    await store.withConnection({ owner, integrationId }, async ({ putAttempt }) => putAttempt({
      state, owner, integrationId, provider: provider.id,
      clientId: registration.client.client_id, tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
      registrationRef: registration.registrationRef,
      grantType: registration.grantType,
      callbackUrl: registration.callbackUrl,
      scopes: [...integration.scopes], settings: structuredClone(integration.settings),
      verificationInput: structuredClone(verificationInput), authorizationUrl: url.href, codeVerifier, expiresAt
    }));
    return { authorizationUrl: url.href, expiresAt, callbackUrl: registration.callbackUrl };
  }

  /** @param {import("./types.js").IntegrationRequest} request */
  async function resumeAuthorization({ context, integrationId }) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    if (integration.authentication.method !== "oauth2") return null;
    const registration = await connectionCredentials.registrationFor(integration, provider);
    if (registration.grantType !== "authorization_code") return null;
    return store.withConnection({ owner, integrationId }, async ({ latestAttempt }) => {
      const attempt = await latestAttempt({ after: now() });
      if (!attempt || attempt.provider !== provider.id ||
          attempt.clientId !== registration.client.client_id ||
          attempt.registrationRef !== registration.registrationRef ||
          attempt.callbackUrl !== registration.callbackUrl ||
          attempt.tokenEndpointAuthMethod !== registration.tokenEndpointAuthMethod ||
          !isDeepStrictEqual(attempt.scopes, integration.scopes) ||
          !isDeepStrictEqual(attempt.settings, integration.settings)) return null;
      return { authorizationUrl: attempt.authorizationUrl, expiresAt: attempt.expiresAt, callbackUrl: registration.callbackUrl };
    });
  }

  /** @param {import("./types.js").ProviderRequest & { callbackUrl: string }} request */
  async function completeAuthorization({ context, integrationId, callbackUrl, signal }) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    const registration = await connectionCredentials.registrationFor(integration, provider);
    if (registration.grantType !== "authorization_code") {
      throw new ConnectorError("connector_mode_unavailable", "Service accounts do not use an authorization callback.", { messageCode: "connectors.connection.serviceAccountsDoNotUse" });
    }
    let url;
    try { url = new URL(callbackUrl); } catch {
      throw new ConnectorError("connector_callback_invalid", "The authorization callback is invalid.", { messageCode: "connectors.connection.authorizationCallbackInvalid" });
    }
    if (`${url.origin}${url.pathname}` !== registration.callbackUrl || url.hash || url.username || url.password) {
      throw new ConnectorError("connector_callback_invalid", "The callback does not match this registration.", { messageCode: "connectors.connection.callbackDoesNotMatchRegistration" });
    }
    const state = url.searchParams.get("state");
    if (!state || url.searchParams.getAll("state").length !== 1) {
      throw new ConnectorError("connector_attempt_invalid", "The authorization attempt is invalid or has expired.", { messageCode: "connectors.connection.authorizationAttemptInvalidExpired" });
    }
    const outcome = await store.withConnection({ owner, integrationId }, async ({ consumeAttempt, save }) => {
      const attempt = await consumeAttempt(state);
      try {
        if (!attempt || attempt.expiresAt <= now() || attempt.provider !== provider.id ||
          (attempt.codeVerifier === null) !== (provider.oauthPkce === false) ||
          attempt.clientId !== registration.client.client_id || attempt.registrationRef !== registration.registrationRef ||
          registrationGrantType(attempt) !== registration.grantType ||
          registrationClientAuthentication(attempt) !== registration.tokenEndpointAuthMethod ||
          attempt.callbackUrl !== registration.callbackUrl || JSON.stringify(attempt.scopes) !== JSON.stringify(integration.scopes) ||
          !isDeepStrictEqual(attempt.settings || {}, integration.settings)) {
          throw new ConnectorError("connector_attempt_invalid", "The authorization attempt is invalid or has expired.", { messageCode: "connectors.connection.authorizationAttemptInvalidExpired" });
        }
        const parameters = oauth.validateAuthResponse(registration.oauth, registration.client, url, state);
        let fallbackScopes = attempt.scopes;
        if (provider.scopesInAuthorizationResponse) {
          const values = parameters.getAll("scope");
          if (values.length !== 1) {
            throw new ConnectorError("connector_response_invalid", "The provider did not return an unambiguous permission grant.", { statusCode: 502, messageCode: "connectors.connection.ambiguousPermissionGrant" });
          }
          const granted = new Set(values[0].split(provider.scopeSeparator).map((scope) => scope.trim()).filter(Boolean));
          fallbackScopes = attempt.scopes.filter((scope) => granted.has(scope));
        }
        const response = await oauth.authorizationCodeGrantRequest(
          registration.oauth, registration.client, registration.clientAuth,
          parameters, registration.callbackUrl, attempt.codeVerifier === null ? oauth.nopkce : attempt.codeVerifier, { ...providerRequests.tokenRequestOptions(signal, provider),
            ...(registration.resource ? { additionalParameters: { resource: registration.resource } } : {}) }
        );
        const result = await oauth.processAuthorizationCodeResponse(registration.oauth, registration.client,
          await tokenResponse(provider, response, { settings: integration.settings, grantType: "authorization_code" }));
        const connection = {
          integrationId, provider: provider.id, registrationRef: registration.registrationRef,
          grantType: registration.grantType,
          clientId: registration.client.client_id, tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod, status: "connected", verifiedAt: now(),
          settings: structuredClone(integration.settings),
          ...(provider.refreshRequiresRedirectUri ? { callbackUrl: registration.callbackUrl } : {}),
          ...providerRequests.tokensFrom(result, null, fallbackScopes, provider)
        };
        connection.grantedScopes = connection.grantedScopes.filter((scope) => integration.scopes.includes(scope));
        await providerRequests.verifyOAuthConnection(provider, connection, attempt.verificationInput || {}, attempt.scopes, signal);
        await save(connection);
        return { result: publicConnection(connection) };
      } catch (error) {
        // Commit one-time consumption even when consent or the provider request fails.
        return { failure: providerError(error) };
      }
    });
    if (outcome.failure) throw outcome.failure;
    return outcome.result;
  }

  /**
   * @param {import("./types.js").ConnectRequest} request
   * @param {"api-key" | "none"} method
   */
  async function verifyDirectConnection({ context, integrationId, verificationInput = {}, signal }, method) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    if (integration.authentication.method !== method || (method === "api-key" &&
      // readable-check: allow method-probe - input validation: an API-key provider definition places its key with headers(), a parameter or pathPrefix()
      (typeof provider.apiKey?.headers !== "function" && !provider.apiKey?.queryParameter &&
        // readable-check: allow method-probe - input validation: an API-key provider definition places its key with headers(), a parameter or pathPrefix()
        !provider.apiKey?.bodyParameter && typeof provider.apiKey?.pathPrefix !== "function"))) {
      throw new ConnectorError("connector_mode_unavailable", "Select the matching credential mode to verify this connection.", { messageCode: "connectors.connection.selectMatchingCredentialModeVerify" });
    }
    requireOperationScope(provider.operations[provider.checkOperation], integration.scopes, VERIFICATION_SCOPE_MESSAGE, VERIFICATION_SCOPE_CODE);
    return store.withConnection({ owner, integrationId }, async ({ save }) => {
      const connection = {
        integrationId, provider: provider.id, method,
        ...(method === "api-key" && integration.authentication.secretRef ? { secretRef: integration.authentication.secretRef } : {}),
        grantedScopes: [], status: "connected", verifiedAt: now(), settings: structuredClone(integration.settings)
      };
      try {
        const credentials = method === "api-key" ? { ...connection, apiKey: await connectionCredentials.apiKeyFor(integration, provider) } : connection;
        await providerRequests.request(provider, provider.checkOperation, verificationInput, credentials, signal);
        if (method === "api-key") connection.credentialFingerprint = createHash("sha256").update(credentials.apiKey).digest("hex");
        await save(connection);
        return publicConnection(connection);
      } catch (error) { throw providerError(error); }
    });
  }

  /** @param {import("./types.js").ConnectRequest} input */
  const connectApiKey = (input) => verifyDirectConnection(input, "api-key");
  /** @param {import("./types.js").ConnectRequest} input */
  const connectWithoutCredentials = (input) => verifyDirectConnection(input, "none");

  /** @param {import("./types.js").ProviderRequest & { operation: string, input?: any }} request */
  async function invoke({ context, integrationId, operation, input = {}, signal }) {
    // Authorize and execute the same input even if the caller changes its object while awaiting policy.
    input = structuredClone(input);
    const { owner, integration, provider } = await access(context, integrationId, operation, input);
    if (!Object.hasOwn(provider.operations, operation)) {
      throw new ConnectorError("connector_operation_unknown", "This provider operation is not available.", { messageCode: "connectors.connection.providerOperationNotAvailable" });
    }
    requireOperationScope(provider.operations[operation], integration.scopes, "This operation requires a permission absent from the application's configuration.", { messageCode: "connectors.connection.operationRequiresPermissionAbsentApplication" });
    const usesApiKey = integration.authentication.method === "api-key";
    const usesServiceAccount = integration.authentication.method === "service-account";
    const usesOAuth = integration.authentication.method === "oauth2";
    const registration = usesOAuth ? await connectionCredentials.registrationFor(integration, provider) : null;
    const seed = integration.authentication.refreshTokenRef ? await connectionCredentials.envRefreshTokenFor(integration) : null;
    const outcome = await store.withConnection({ owner, integrationId }, async ({ connection, save }) => {
      if (seed && !envSeedIsCurrent(connection, seed, registration)) {
        connection = envSeededConnection(integrationId, integration, provider, registration, seed);
        await save(connection);
      }
      if (!connection || connection.status !== "connected" ||
        !connectionMatches(connection, integration, provider.id, usesOAuth ? { ...registration, clientId: registration.client.client_id } : null) ||
        (usesOAuth && !callbackMatches(connection, provider, registration))) {
        throw new ConnectorError("connector_reconnect_required", "Connect this account again.", { statusCode: 401, messageCode: "connectors.connection.connectAccountAgain" });
      }
      try {
        if (usesServiceAccount) {
          const binding = await connectionCredentials.serviceAccountCredentialFor(integration);
          if (binding.fingerprint !== connection.credentialFingerprint || connection.tokens.expiresAt <= now() + provider.tokenRefreshLeewayMs) {
            connection = { ...connection, ...await providerRequests.serviceAccountGrant(integration, provider, binding, signal) };
            await save(connection);
          }
        }
        if (usesOAuth && connection.tokens.expiresAt !== null && connection.tokens.expiresAt <= now() + provider.tokenRefreshLeewayMs) {
          let grant;
          if (registration.grantType === "client_credentials") {
            grant = await providerRequests.clientCredentialsGrant(registration, provider, integration.settings, connection.grantedScopes, signal);
          } else {
            if (!connection.tokens.refreshToken) {
              throw new ConnectorError("connector_reconnect_required", "Connect this account again.", { statusCode: 401, messageCode: "connectors.connection.connectAccountAgain" });
            }
            const response = await oauth.refreshTokenGrantRequest(
              registration.oauth, registration.client, registration.clientAuth,
              connection.tokens.refreshToken, { ...providerRequests.tokenRequestOptions(signal, provider),
                additionalParameters: {
                  ...(registration.resource ? { resource: registration.resource } : {}),
                  ...(provider.refreshRequiresRedirectUri ? { redirect_uri: connection.callbackUrl } : {})
                } }
            );
            const refreshed = await oauth.processRefreshTokenResponse(registration.oauth, registration.client,
              await tokenResponse(provider, response, { settings: integration.settings, grantType: "refresh_token" }));
            grant = providerRequests.tokensFrom(refreshed, connection, integration.scopes, provider);
          }
          grant.grantedScopes = grant.grantedScopes.filter((scope) =>
            connection.grantedScopes.includes(scope) && integration.scopes.includes(scope));
          connection = { ...connection, ...grant };
          await save(connection);
        }
        const credentials = usesApiKey ? { ...connection, apiKey: await connectionCredentials.apiKeyFor(integration, provider) } : connection;
        const result = await providerRequests.request(provider, operation, input, credentials, signal);
        await save({ ...connection, verifiedAt: now(),
          ...(usesApiKey ? { credentialFingerprint: createHash("sha256").update(credentials.apiKey).digest("hex") } : {})
        });
        return { result };
      } catch (error) {
        let failure = providerError(error);
        if (failure.code === "connector_reconnect_required") {
          await save({ ...connection, status: "reconnect-required" });
          if (seed) failure = new ConnectorError(failure.code, "The refresh token in Env no longer works; replace that Env value.", { statusCode: 401, messageCode: "connectors.connection.envRefreshTokenRejected" });
        }
        // Commit rotated tokens and reconnect state even when the API request fails.
        return { failure };
      }
    });
    if (outcome.failure) throw outcome.failure;
    return outcome.result;
  }

  /** @param {import("./types.js").IntegrationRequest} request */
  async function status({ context, integrationId }) {
    const { owner, integration, provider } = await access(context, integrationId, "status");
    // Compare against the configured registration without resolving its secrets.
    const registration = config.registrations[integration.authentication.registrationRef];
    const configured = {
      registrationRef: integration.authentication.registrationRef, clientId: registration?.clientId,
      grantType: registrationGrantType(registration), tokenEndpointAuthMethod: registrationClientAuthentication(registration)
    };
    return store.withConnection({ owner, integrationId }, async ({ connection }) => {
      if (connection && !integration.authentication.refreshTokenRef && !connectionMatches(connection, integration, integration.provider, configured)) {
        return publicConnection({ ...connection, status: "reconnect-required" });
      }
      let callbackUrl;
      try {
        if (integration.authentication.method === "oauth2") {
          const resolved = await connectionCredentials.registrationFor(integration, provider);
          callbackUrl = resolved.callbackUrl;
          if (integration.authentication.refreshTokenRef) {
            const seed = await connectionCredentials.envRefreshTokenFor(integration);
            // A new value is used on the next call; until then it reads as connected from Env.
            if (!envSeedIsCurrent(connection, seed, resolved)) {
              return { status: "connected", source: "env", provider: provider.id, integrationId, grantedScopes: [...integration.scopes], callbackUrl };
            }
          }
          if (connection && !callbackMatches(connection, provider, resolved)) {
            return publicConnection({ ...connection, status: "reconnect-required" });
          }
        } else if (integration.authentication.method === "api-key") {
          const key = await connectionCredentials.apiKeyFor(integration, provider);
          if (connection && connection.credentialFingerprint !== createHash("sha256").update(key).digest("hex")) {
            return publicConnection({ ...connection, status: "reconnect-required" });
          }
        } else if (integration.authentication.method === "service-account") await connectionCredentials.serviceAccountCredentialFor(integration);
      } catch (error) {
        if (!["connector_binding_missing", "connector_callback_invalid"].includes(error.code)) throw error;
        if (!connection) return { status: "unconfigured", configurationError: error.code };
        return publicConnection({ ...connection, status: "reconnect-required" });
      }
      return { ...publicConnection(connection), ...(callbackUrl ? { callbackUrl } : {}) };
    });
  }

  /** @param {import("./types.js").IntegrationRequest} request */
  async function disconnect({ context, integrationId }) {
    const { owner, integration } = await access(context, integrationId, "disconnect");
    if (integration.authentication.refreshTokenRef) {
      throw new ConnectorError("connector_env_managed", ENV_SEEDED_MESSAGE, { statusCode: 409, ...ENV_SEEDED_CODE });
    }
    await store.withConnection({ owner, integrationId }, async ({ remove }) => remove());
    return { status: "disconnected" };
  }

  /** @param {import("./types.js").IntegrationRequest & { state: string }} request */
  async function cancelAuthorization({ context, integrationId, state }) {
    const { owner } = await access(context, integrationId, "connect", undefined, false);
    await store.withConnection({ owner, integrationId }, async ({ consumeAttempt }) => consumeAttempt(state));
    return { status: "cancelled" };
  }

  return Object.freeze({
    beginAuthorization,
    resumeAuthorization,
    completeAuthorization,
    cancelAuthorization,
    connectClientCredentials,
    connectServiceAccount,
    connectApiKey,
    connectWithoutCredentials,
    invoke,
    status,
    disconnect,
    authorizeAssistantAction
  });
}

export { createConnectionService };
