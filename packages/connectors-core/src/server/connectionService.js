import * as oauth from "oauth4webapi";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { validateIntegrationConfiguration } from "../shared/configuration.js";
import { ConnectorError, providerError } from "./errors.js";

function publicConnection(connection) {
  if (!connection) return { status: "disconnected" };
  return {
    status: connection.status,
    provider: connection.provider,
    integrationId: connection.integrationId,
    grantedScopes: [...connection.grantedScopes],
    verifiedAt: connection.verifiedAt,
    ...(connection.accountLabel ? { accountLabel: connection.accountLabel } : {})
  };
}

function validateCallbackUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* reported below */ }
  const localHttp = url?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!url || (!localHttp && url.protocol !== "https:") || url.username || url.password || url.hash || url.search) {
    throw new ConnectorError("connector_callback_invalid", "Configure an HTTPS callback URL, or a local development callback.");
  }
  return url.href;
}

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
  const definitions = new Map(providers.map((provider) => [provider.id, provider]));
  if (!providers.length || definitions.size !== providers.length) throw new TypeError("Register unique connector providers.");
  if (typeof authorize !== "function" || typeof resolveReference !== "function") {
    throw new TypeError("Connections require application authorization and reference resolution.");
  }
  if (typeof store?.withConnection !== "function") throw new TypeError("Connection storage requires withConnection().");
  const http = createHttpClient({ fetchImpl, csrf: { enabled: false }, credentials: "omit" });

  async function access(context, integrationId, operation, input, checkAssistantPermission = true) {
    const integration = config.integrations[integrationId];
    if (!Object.hasOwn(config.integrations, integrationId)) {
      throw new ConnectorError("connector_not_found", "This integration is not configured.", { statusCode: 404 });
    }
    const baseDefinition = definitions.get(integration.provider);
    const definition = baseDefinition.runtimeForSettings
      ? { ...baseDefinition, ...baseDefinition.runtimeForSettings(integration.settings || {}) } : baseDefinition;
    const provider = typeof definition.checkOperation === "function"
      ? { ...definition, checkOperation: definition.checkOperation(integration.authentication.method) }
      : definition;
    let assistantPermission;
    if (executionMode === "assistant" && checkAssistantPermission && !["status", "disconnect"].includes(operation)) {
      const action = provider.operations?.[operation]?.assistantAction || operation;
      const policy = integration.assistantPolicy;
      const decision = policy?.enabled === false ? "never" : policy?.actions?.[action] || policy?.defaultPermission || "ask";
      if (decision === "never") {
        throw new ConnectorError("connector_access_denied", "This assistant action is disabled.", { statusCode: 403 });
      }
      assistantPermission = { action, decision };
    }
    const owner = await authorize(context, { integrationId, operation, accountMode: integration.accountMode,
      ...(assistantPermission ? { assistantPermission: { ...assistantPermission } } : {}),
      ...(input === undefined ? {} : { input: structuredClone(input) }) });
    if (!owner || typeof owner.applicationId !== "string" || !owner.applicationId ||
      typeof owner.subjectId !== "string" || !owner.subjectId) {
      throw new ConnectorError("connector_access_denied", "You cannot use this connection.", { statusCode: 403 });
    }
    if (assistantPermission?.decision === "ask" && owner.approved !== true) {
      throw new ConnectorError("connector_approval_required", "Approve this assistant action before continuing.", { statusCode: 409 });
    }
    const methods = provider.operations?.[operation]?.authenticationMethods;
    if (methods && !methods.includes(integration.authentication.method)) {
      throw new ConnectorError("connector_mode_unavailable", "This operation requires a different connection method.");
    }
    return { owner: { applicationId: owner.applicationId, subjectId: owner.subjectId }, integration, provider };
  }

  async function authorizeAssistantAction({ context, integrationId, action, input = {} }) {
    const provider = definitions.get(config.integrations[integrationId]?.provider);
    if (executionMode !== "assistant" || !provider?.assistantActions?.some((item) => item.value === action)) {
      throw new ConnectorError("connector_operation_unknown", "This provider does not declare this assistant action.");
    }
    await access(context, integrationId, action, structuredClone(input));
    // The host performs its own lifecycle operation after authorization; no provider action is executed here.
  }

  async function registrationFor(integration, provider) {
    const registration = config.registrations[integration.authentication.registrationRef];
    if (registration?.source !== "own" || integration.authentication.method !== "oauth2" || !provider.oauth) {
      throw new ConnectorError("connector_mode_unavailable", "This runtime does not yet support the selected credential mode.");
    }
    if (registration.clientId.trim() === "MISSING") {
      throw new ConnectorError("connector_binding_missing", "The provider client ID is not configured.");
    }
    const grantType = registration.grantType || "authorization_code";
    const tokenEndpointAuthMethod = registration.tokenEndpointAuthMethod || "client_secret_post";
    if (provider.oauthPkce === false && tokenEndpointAuthMethod === "none") {
      throw new ConnectorError("connector_mode_unavailable", "This provider's non-PKCE flow requires a confidential client.");
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
      throw new ConnectorError("connector_binding_missing", "A required registration binding is missing.");
    }
    const callbackUrl = grantType === "authorization_code" ? validateCallbackUrl(callback) : undefined;
    if (callbackUrl && provider.validateCallbackUrl && provider.validateCallbackUrl(callbackUrl) !== true) {
      throw new ConnectorError("connector_callback_invalid", "The callback URL does not meet this provider's requirements.");
    }
    let clientAuth = tokenEndpointAuthMethod === "none" ? oauth.None()
      : tokenEndpointAuthMethod === "client_secret_basic" ? oauth.ClientSecretBasic(clientSecret) : oauth.ClientSecretPost(clientSecret);
    if (tokenEndpointAuthMethod === "client_secret_basic" && provider.oauthBasicEncoding === "raw") {
      clientAuth = (_as, client, _body, headers) => {
        headers.set("authorization", `Basic ${Buffer.from(`${client.client_id}:${clientSecret}`).toString("base64")}`);
      };
    }
    return {
      oauth: typeof provider.oauth === "function" ? provider.oauth(integration.settings || {}) : provider.oauth,
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

  async function apiKeyFor(integration, provider) {
    if (!integration.authentication.secretRef && provider.apiKeySecretOptional) return "";
    try {
      const value = await resolveReference(integration.authentication.secretRef);
      if (typeof value !== "string" || (!provider.apiKeySecretOptional && !value.trim()) || value.trim() === "MISSING" || /[\r\n]/u.test(value)) throw new Error("Invalid key.");
      return value;
    } catch {
      throw new ConnectorError("connector_binding_missing", "The API key binding is missing or invalid.");
    }
  }

  async function serviceAccountCredentialFor(integration) {
    try {
      const credential = await resolveReference(integration.authentication.secretRef);
      if (typeof credential !== "string" || !credential.trim() || credential.trim() === "MISSING" || credential.length > 65_536 || credential.includes("\0")) throw new Error("Invalid credential.");
      return { credential, fingerprint: createHash("sha256").update(credential).digest("hex") };
    } catch {
      throw new ConnectorError("connector_binding_missing", "The service-account credential binding is missing or invalid.");
    }
  }

  async function serviceAccountGrant(integration, provider, binding, signal) {
    if (typeof provider.serviceAccountGrant !== "function") {
      throw new ConnectorError("connector_mode_unavailable", "This provider does not implement service-account authorization.");
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
        response.token_type?.toLowerCase?.() !== "bearer" ||
        !Number.isFinite(response.expires_in) || response.expires_in <= 0 || response.expires_in > 86_400 ||
        response.refresh_token !== undefined || (response.scope !== undefined && typeof response.scope !== "string")) {
      throw new ConnectorError("connector_response_invalid", "The provider returned an invalid service-account token.", { statusCode: 502 });
    }
    const grant = tokensFrom(response, null, integration.scopes, provider.scopeSeparator, provider);
    grant.grantedScopes = grant.grantedScopes.filter((scope) => integration.scopes.includes(scope));
    return { ...grant, credentialFingerprint: binding.fingerprint };
  }

  async function connectServiceAccount({ context, integrationId, verificationInput = {}, signal }) {
    verificationInput = structuredClone(verificationInput);
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    if (integration.authentication.method !== "service-account" || typeof provider.serviceAccountGrant !== "function") {
      throw new ConnectorError("connector_mode_unavailable", "Select service-account credentials to verify this connection.");
    }
    provider.operations[provider.checkOperation].request(verificationInput, integration.settings || {});
    const required = provider.operations[provider.checkOperation].scopes;
    if (required.length && !required.some((scope) => integration.scopes.includes(scope))) {
      throw new ConnectorError("connector_scope_missing", "Connection verification requires a permission absent from the application's configuration.", { statusCode: 403 });
    }
    return store.withConnection({ owner, integrationId }, async ({ save }) => {
      try {
        const binding = await serviceAccountCredentialFor(integration);
        const connection = {
          integrationId, provider: provider.id, method: "service-account", secretRef: integration.authentication.secretRef,
          requestedScopes: [...integration.scopes], settings: structuredClone(integration.settings || {}),
          status: "connected", verifiedAt: now(), ...await serviceAccountGrant(integration, provider, binding, signal)
        };
        await request(provider, provider.checkOperation, verificationInput, connection, signal);
        await save(connection);
        return publicConnection(connection);
      } catch (error) { throw providerError(error); }
    });
  }

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

  async function request(provider, operationId, input, connection, signal) {
    const operation = provider.operations[operationId];
    if (!operation || !Object.hasOwn(provider.operations, operationId)) {
      throw new ConnectorError("connector_operation_unknown", "This provider operation is not available.");
    }
    if (["oauth2", "service-account"].includes(connection.method || "oauth2") && operation.scopes.length && !operation.scopes.some((scope) => connection.grantedScopes.includes(scope))) {
      throw new ConnectorError("connector_scope_missing", "Connect again with the permission required for this operation.", { statusCode: 403 });
    }
    let request;
    try { request = operation.request(input, connection.settings || {}, connection.providerData); } catch (error) {
      if (!error.fieldErrors) throw error;
      const failure = new ConnectorError("connector_input_invalid", "Check the operation's input values.", { statusCode: 422 });
      failure.fieldErrors = error.fieldErrors;
      throw failure;
    }
    const url = new URL(request.url);
    const origins = typeof provider.apiOrigins === "function" ? provider.apiOrigins(connection.settings || {}, connection.providerData) : provider.apiOrigins;
    if (url.protocol !== "https:" || url.username || url.password || !origins.includes(url.origin)) {
      throw new ConnectorError("connector_destination_invalid", "The provider operation has an invalid destination.");
    }
    if (connection.method === "api-key" && provider.apiKey.pathPrefix) {
      const prefix = provider.apiKey.pathPrefix(connection.apiKey);
      if (typeof prefix !== "string" || !prefix.startsWith("/") || prefix.startsWith("//") ||
        /[?#\\]/.test(prefix) || prefix.split("/").some((part) => /^(?:\.|%2e){1,2}$/i.test(part))) {
        throw new ConnectorError("connector_request_invalid", "This provider has an invalid credential path.");
      }
      // A pathname assignment cannot replace the already checked origin.
      url.pathname = prefix + url.pathname;
    }
    if (connection.method === "api-key" && provider.apiKey.queryParameter) {
      url.searchParams.set(provider.apiKey.queryParameter, connection.apiKey);
    }
    let body = request.body;
    if (connection.method === "api-key" && provider.apiKey.bodyParameter) {
      if (!body || typeof body !== "object" || Array.isArray(body) || ["GET", "HEAD"].includes(request.method)) {
        throw new ConnectorError("connector_request_invalid", "This provider requires a JSON request body.");
      }
      body = { ...body, [provider.apiKey.bodyParameter]: connection.apiKey };
    }
    const options = {
      method: request.method,
      body,
      headers: { ...request.headers, Accept: "application/json", ...(connection.method === "api-key"
        ? provider.apiKey.headers?.(connection.apiKey, connection.settings || {})
        : connection.method === "none" ? {} : {
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
    if (typeof operation.validateResult === "function" && !operation.validateResult(result)) {
      throw new ConnectorError("connector_response_invalid", "The provider returned an unexpected response.", { statusCode: 502 });
    }
    return result;
  }

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

  async function verifyOAuthConnection(provider, connection, verificationInput, requestedScopes, signal) {
    const verification = await request(provider, provider.checkOperation, verificationInput, connection, signal);
    if (provider.accountLabelFromVerification) {
      const label = provider.accountLabelFromVerification(verification);
      if (typeof label !== "string" || !label.trim() || label.length > 256 || /[\p{Cc}\p{Cf}]/u.test(label)) {
        throw new ConnectorError("connector_response_invalid", "The provider returned an invalid account label.", { statusCode: 502 });
      }
      connection.accountLabel = label;
    }
    if (!provider.grantedScopesFromVerification) return;
    const scopes = provider.grantedScopesFromVerification(verification, { clientId: connection.clientId });
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !scope)) {
      throw new ConnectorError("connector_response_invalid", "The provider returned an invalid permission grant.", { statusCode: 502 });
    }
    connection.grantedScopes = connection.grantedScopes.filter((scope) => requestedScopes.includes(scope) && scopes.includes(scope));
    const required = provider.operations[provider.checkOperation].scopes;
    if (required.length && !required.some((scope) => connection.grantedScopes.includes(scope))) {
      throw new ConnectorError("connector_scope_missing", "Connect again with the permission required for verification.", { statusCode: 403 });
    }
  }

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

  async function connectClientCredentials({ context, integrationId, verificationInput = {}, signal }) {
    verificationInput = structuredClone(verificationInput);
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    const registration = await registrationFor(integration, provider);
    if (registration.grantType !== "client_credentials") {
      throw new ConnectorError("connector_mode_unavailable", "Select client credentials to connect a service account.");
    }
    provider.operations[provider.checkOperation].request(verificationInput, integration.settings || {});
    const required = provider.operations[provider.checkOperation].scopes;
    if (required.length && !required.some((scope) => integration.scopes.includes(scope))) {
      throw new ConnectorError("connector_scope_missing", "Connection verification requires a permission absent from the application's configuration.", { statusCode: 403 });
    }
    return store.withConnection({ owner, integrationId }, async ({ save }) => {
      try {
        const connection = {
          integrationId, provider: provider.id, registrationRef: registration.registrationRef,
          clientId: registration.client.client_id, tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
          grantType: registration.grantType, requestedScopes: [...integration.scopes],
          settings: structuredClone(integration.settings || {}), status: "connected", verifiedAt: now(),
          ...await clientCredentialsGrant(registration, provider, integration.settings || {}, integration.scopes, signal)
        };
        await verifyOAuthConnection(provider, connection, verificationInput, integration.scopes, signal);
        await save(connection);
        return publicConnection(connection);
      } catch (error) { throw providerError(error); }
    });
  }

  async function beginAuthorization({ context, integrationId, verificationInput = {}, signal }) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    // Resource-specific providers validate the first document ID before opening consent.
    provider.operations[provider.checkOperation].request(verificationInput, integration.settings || {});
    const registration = await registrationFor(integration, provider);
    if (registration.grantType !== "authorization_code") {
      throw new ConnectorError("connector_mode_unavailable", "Service accounts connect without browser consent.");
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
    const scopeParameter = provider.authorizationScopeParameter?.(integration.settings || {}) || "scope";
    if (integration.scopes.length) url.searchParams.set(scopeParameter, integration.scopes.join(provider.scopeSeparator || " "));
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
      scopes: [...integration.scopes], settings: structuredClone(integration.settings || {}),
      verificationInput: structuredClone(verificationInput), authorizationUrl: url.href, codeVerifier, expiresAt
    }));
    return { authorizationUrl: url.href, expiresAt, callbackUrl: registration.callbackUrl };
  }

  async function resumeAuthorization({ context, integrationId }) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    if (integration.authentication.method !== "oauth2") return null;
    const registration = await registrationFor(integration, provider);
    if (registration.grantType !== "authorization_code") return null;
    return store.withConnection({ owner, integrationId }, async ({ latestAttempt }) => {
      const attempt = await latestAttempt({ after: now() });
      if (!attempt || attempt.provider !== provider.id ||
          attempt.clientId !== registration.client.client_id ||
          attempt.registrationRef !== registration.registrationRef ||
          attempt.callbackUrl !== registration.callbackUrl ||
          attempt.tokenEndpointAuthMethod !== registration.tokenEndpointAuthMethod ||
          !isDeepStrictEqual(attempt.scopes, integration.scopes) ||
          !isDeepStrictEqual(attempt.settings, integration.settings || {})) return null;
      return { authorizationUrl: attempt.authorizationUrl, expiresAt: attempt.expiresAt, callbackUrl: registration.callbackUrl };
    });
  }

  async function completeAuthorization({ context, integrationId, callbackUrl, signal }) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    const registration = await registrationFor(integration, provider);
    if (registration.grantType !== "authorization_code") {
      throw new ConnectorError("connector_mode_unavailable", "Service accounts do not use an authorization callback.");
    }
    let url;
    try { url = new URL(callbackUrl); } catch {
      throw new ConnectorError("connector_callback_invalid", "The authorization callback is invalid.");
    }
    if (`${url.origin}${url.pathname}` !== registration.callbackUrl || url.hash || url.username || url.password) {
      throw new ConnectorError("connector_callback_invalid", "The callback does not match this registration.");
    }
    const state = url.searchParams.get("state");
    if (!state || url.searchParams.getAll("state").length !== 1) {
      throw new ConnectorError("connector_attempt_invalid", "The authorization attempt is invalid or has expired.");
    }
    const outcome = await store.withConnection({ owner, integrationId }, async ({ consumeAttempt, save }) => {
      const attempt = await consumeAttempt(state);
      try {
        if (!attempt || attempt.expiresAt <= now() || attempt.provider !== provider.id ||
          (attempt.codeVerifier === null) !== (provider.oauthPkce === false) ||
          attempt.clientId !== registration.client.client_id || attempt.registrationRef !== registration.registrationRef ||
          (attempt.grantType || "authorization_code") !== registration.grantType ||
          (attempt.tokenEndpointAuthMethod || "client_secret_post") !== registration.tokenEndpointAuthMethod ||
          attempt.callbackUrl !== registration.callbackUrl || JSON.stringify(attempt.scopes) !== JSON.stringify(integration.scopes) ||
          !isDeepStrictEqual(attempt.settings || {}, integration.settings || {})) {
          throw new ConnectorError("connector_attempt_invalid", "The authorization attempt is invalid or has expired.");
        }
        const parameters = oauth.validateAuthResponse(registration.oauth, registration.client, url, state);
        let fallbackScopes = attempt.scopes;
        if (provider.scopesInAuthorizationResponse) {
          const values = parameters.getAll("scope");
          if (values.length !== 1) {
            throw new ConnectorError("connector_response_invalid", "The provider did not return an unambiguous permission grant.", { statusCode: 502 });
          }
          const granted = new Set(values[0].split(provider.scopeSeparator || " ").map((scope) => scope.trim()).filter(Boolean));
          fallbackScopes = attempt.scopes.filter((scope) => granted.has(scope));
        }
        const response = await oauth.authorizationCodeGrantRequest(
          registration.oauth, registration.client, registration.clientAuth,
          parameters, registration.callbackUrl, attempt.codeVerifier === null ? oauth.nopkce : attempt.codeVerifier, { ...requestOptions(signal, undefined, provider.tokenRequestEncoding),
            ...(registration.resource ? { additionalParameters: { resource: registration.resource } } : {}) }
        );
        const result = await oauth.processAuthorizationCodeResponse(registration.oauth, registration.client,
          provider.normalizeTokenResponse ? await provider.normalizeTokenResponse(response, { settings: integration.settings || {}, grantType: "authorization_code" }) : response);
        const connection = {
          integrationId, provider: provider.id, registrationRef: registration.registrationRef,
          grantType: registration.grantType,
          clientId: registration.client.client_id, tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod, status: "connected", verifiedAt: now(),
          settings: structuredClone(integration.settings || {}),
          ...(provider.refreshRequiresRedirectUri ? { callbackUrl: registration.callbackUrl } : {}),
          ...tokensFrom(result, null, fallbackScopes, provider.scopeSeparator, provider)
        };
        connection.grantedScopes = connection.grantedScopes.filter((scope) => integration.scopes.includes(scope));
        await verifyOAuthConnection(provider, connection, attempt.verificationInput || {}, attempt.scopes, signal);
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

  async function verifyDirectConnection({ context, integrationId, verificationInput = {}, signal }, method) {
    const { owner, integration, provider } = await access(context, integrationId, "connect");
    if (integration.authentication.method !== method || (method === "api-key" &&
      (typeof provider.apiKey?.headers !== "function" && !provider.apiKey?.queryParameter &&
        !provider.apiKey?.bodyParameter && typeof provider.apiKey?.pathPrefix !== "function"))) {
      throw new ConnectorError("connector_mode_unavailable", "Select the matching credential mode to verify this connection.");
    }
    const requiredScopes = provider.operations[provider.checkOperation].scopes;
    if (requiredScopes.length && !requiredScopes.some((scope) => integration.scopes.includes(scope))) {
      throw new ConnectorError("connector_scope_missing", "Connection verification requires a permission absent from the application's configuration.", { statusCode: 403 });
    }
    return store.withConnection({ owner, integrationId }, async ({ save }) => {
      const connection = {
        integrationId, provider: provider.id, method,
        ...(method === "api-key" && integration.authentication.secretRef ? { secretRef: integration.authentication.secretRef } : {}),
        grantedScopes: [], status: "connected", verifiedAt: now(), settings: structuredClone(integration.settings || {})
      };
      try {
        const credentials = method === "api-key" ? { ...connection, apiKey: await apiKeyFor(integration, provider) } : connection;
        await request(provider, provider.checkOperation, verificationInput, credentials, signal);
        if (method === "api-key") connection.credentialFingerprint = createHash("sha256").update(credentials.apiKey).digest("hex");
        await save(connection);
        return publicConnection(connection);
      } catch (error) { throw providerError(error); }
    });
  }

  const connectApiKey = (input) => verifyDirectConnection(input, "api-key");
  const connectWithoutCredentials = (input) => verifyDirectConnection(input, "none");

  async function invoke({ context, integrationId, operation, input = {}, signal }) {
    // Authorize and execute the same input even if the caller changes its object while awaiting policy.
    input = structuredClone(input);
    const { owner, integration, provider } = await access(context, integrationId, operation, input);
    if (!Object.hasOwn(provider.operations, operation)) {
      throw new ConnectorError("connector_operation_unknown", "This provider operation is not available.");
    }
    if (provider.operations[operation].scopes.length && !provider.operations[operation].scopes.some((scope) => integration.scopes.includes(scope))) {
      throw new ConnectorError("connector_scope_missing", "This operation requires a permission absent from the application's configuration.", { statusCode: 403 });
    }
    const usesApiKey = integration.authentication.method === "api-key";
    const usesServiceAccount = integration.authentication.method === "service-account";
    const usesOAuth = integration.authentication.method === "oauth2";
    const registration = usesOAuth ? await registrationFor(integration, provider) : null;
    const outcome = await store.withConnection({ owner, integrationId }, async ({ connection, save }) => {
      if (!connection || connection.status !== "connected" || connection.provider !== provider.id ||
        (connection.method || "oauth2") !== integration.authentication.method ||
        !isDeepStrictEqual(connection.settings || {}, integration.settings || {}) ||
        ((usesApiKey || usesServiceAccount) && connection.secretRef !== integration.authentication.secretRef) ||
        (usesServiceAccount && !isDeepStrictEqual(connection.requestedScopes, integration.scopes)) ||
        (usesOAuth && (connection.registrationRef !== registration.registrationRef || connection.clientId !== registration.client.client_id ||
            (connection.grantType || "authorization_code") !== registration.grantType ||
            (registration.grantType === "client_credentials" && !isDeepStrictEqual(connection.requestedScopes, integration.scopes)) ||
            (registration.grantType === "authorization_code" && provider.refreshRequiresRedirectUri && connection.callbackUrl !== registration.callbackUrl) ||
            (connection.tokenEndpointAuthMethod || "client_secret_post") !== registration.tokenEndpointAuthMethod))) {
        throw new ConnectorError("connector_reconnect_required", "Connect this account again.", { statusCode: 401 });
      }
      try {
        if (usesServiceAccount) {
          const binding = await serviceAccountCredentialFor(integration);
          if (binding.fingerprint !== connection.credentialFingerprint || connection.tokens.expiresAt <= now() + (provider.tokenRefreshLeewayMs ?? 30_000)) {
            connection = { ...connection, ...await serviceAccountGrant(integration, provider, binding, signal) };
            await save(connection);
          }
        }
        if (usesOAuth && connection.tokens.expiresAt !== null && connection.tokens.expiresAt <= now() + (provider.tokenRefreshLeewayMs ?? 30_000)) {
          let grant;
          if (registration.grantType === "client_credentials") {
            grant = await clientCredentialsGrant(registration, provider, integration.settings || {}, connection.grantedScopes, signal);
          } else {
            if (!connection.tokens.refreshToken) {
              throw new ConnectorError("connector_reconnect_required", "Connect this account again.", { statusCode: 401 });
            }
            const response = await oauth.refreshTokenGrantRequest(
              registration.oauth, registration.client, registration.clientAuth,
              connection.tokens.refreshToken, { ...requestOptions(signal, undefined, provider.tokenRequestEncoding),
                additionalParameters: {
                  ...(registration.resource ? { resource: registration.resource } : {}),
                  ...(provider.refreshRequiresRedirectUri ? { redirect_uri: connection.callbackUrl } : {})
                } }
            );
            const refreshed = await oauth.processRefreshTokenResponse(registration.oauth, registration.client,
              provider.normalizeTokenResponse ? await provider.normalizeTokenResponse(response, { settings: integration.settings || {}, grantType: "refresh_token" }) : response);
            grant = tokensFrom(refreshed, connection, integration.scopes, provider.scopeSeparator, provider);
          }
          grant.grantedScopes = grant.grantedScopes.filter((scope) =>
            connection.grantedScopes.includes(scope) && integration.scopes.includes(scope));
          connection = { ...connection, ...grant };
          await save(connection);
        }
        const credentials = usesApiKey ? { ...connection, apiKey: await apiKeyFor(integration, provider) } : connection;
        const result = await request(provider, operation, input, credentials, signal);
        await save({ ...connection, verifiedAt: now(),
          ...(usesApiKey ? { credentialFingerprint: createHash("sha256").update(credentials.apiKey).digest("hex") } : {})
        });
        return { result };
      } catch (error) {
        const failure = providerError(error);
        if (failure.code === "connector_reconnect_required") await save({ ...connection, status: "reconnect-required" });
        // Commit rotated tokens and reconnect state even when the API request fails.
        return { failure };
      }
    });
    if (outcome.failure) throw outcome.failure;
    return outcome.result;
  }

  async function status({ context, integrationId }) {
    const { owner, integration, provider } = await access(context, integrationId, "status");
    const registration = config.registrations[integration.authentication.registrationRef];
    return store.withConnection({ owner, integrationId }, async ({ connection }) => {
      if (connection && (connection.provider !== integration.provider ||
        (connection.method || "oauth2") !== integration.authentication.method ||
        !isDeepStrictEqual(connection.settings || {}, integration.settings || {}) ||
        (["api-key", "service-account"].includes(integration.authentication.method) && connection.secretRef !== integration.authentication.secretRef) ||
        (integration.authentication.method === "service-account" && !isDeepStrictEqual(connection.requestedScopes, integration.scopes)) ||
        (integration.authentication.method === "oauth2" && (connection.registrationRef !== integration.authentication.registrationRef || connection.clientId !== registration?.clientId ||
            (connection.grantType || "authorization_code") !== (registration?.grantType || "authorization_code") ||
            (registration?.grantType === "client_credentials" && !isDeepStrictEqual(connection.requestedScopes, integration.scopes)) ||
            (connection.tokenEndpointAuthMethod || "client_secret_post") !== (registration?.tokenEndpointAuthMethod || "client_secret_post"))))) {
        return publicConnection({ ...connection, status: "reconnect-required" });
      }
      let callbackUrl;
      try {
        if (integration.authentication.method === "oauth2") {
          const resolved = await registrationFor(integration, provider);
          callbackUrl = resolved.callbackUrl;
          if (connection && provider.refreshRequiresRedirectUri && resolved.grantType === "authorization_code" &&
              connection.callbackUrl !== resolved.callbackUrl) {
            return publicConnection({ ...connection, status: "reconnect-required" });
          }
        } else if (integration.authentication.method === "api-key") {
          const key = await apiKeyFor(integration, provider);
          if (connection && connection.credentialFingerprint !== createHash("sha256").update(key).digest("hex")) {
            return publicConnection({ ...connection, status: "reconnect-required" });
          }
        } else if (integration.authentication.method === "service-account") await serviceAccountCredentialFor(integration);
      } catch (error) {
        if (!["connector_binding_missing", "connector_callback_invalid"].includes(error.code)) throw error;
        if (!connection) return { status: "unconfigured", configurationError: error.code };
        return publicConnection({ ...connection, status: "reconnect-required" });
      }
      return { ...publicConnection(connection), ...(callbackUrl ? { callbackUrl } : {}) };
    });
  }

  async function disconnect({ context, integrationId }) {
    const { owner } = await access(context, integrationId, "disconnect");
    await store.withConnection({ owner, integrationId }, async ({ remove }) => remove());
    return { status: "disconnected" };
  }

  async function cancelAuthorization({ context, integrationId, state }) {
    const { owner } = await access(context, integrationId, "connect", undefined, false);
    await store.withConnection({ owner, integrationId }, async ({ consumeAttempt }) => consumeAttempt(state));
    return { status: "cancelled" };
  }

  return Object.freeze({ beginAuthorization, resumeAuthorization, completeAuthorization, cancelAuthorization, connectClientCredentials, connectServiceAccount, connectApiKey, connectWithoutCredentials, invoke, status, disconnect, authorizeAssistantAction });
}

export { createConnectionService };
