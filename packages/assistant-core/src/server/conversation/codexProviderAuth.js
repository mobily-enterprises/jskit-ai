import { CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH, codexAuthOutputRequiresReconnect, createCodexAccountReader } from "./codexAccountReader.js";
import { assertCodexAuthPreflightReady } from "./codexAuthPreflight.js";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import { tailTextFile } from "./codexProcess.js";

/** @typedef {import("./codexProvider.js").CodexAppServerAgentProvider} CodexAppServerAgentProvider */

export const codexAppServerHelperAuthError = createCodexAccountReader().error;

export const CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD = "account/chatgptAuthTokens/refresh";

export function codexAppServerHelperLoginParams(auth = {}, errorPrefix = "") {
  if (auth.authMode === "chatgpt") {
    return {
      accessToken: auth.accessToken,
      chatgptAccountId: auth.accountId,
      chatgptPlanType: auth.planType || null,
      type: "chatgptAuthTokens"
    };
  }
  if (auth.authMode === "apiKey") {
    return {
      apiKey: auth.apiKey,
      type: "apiKey"
    };
  }
  throw codexAppServerHelperAuthError(
    `${errorPrefix}codex_helper_auth_invalid`,
    "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
  );
}

export function codexAppServerHelperLoginResponseType(auth = {}) {
  return auth.authMode === "chatgpt" ? "chatgptAuthTokens" : "apiKey";
}

export function codexAppServerHelperAccountType(auth = {}) {
  return auth.authMode === "chatgpt" ? "chatgpt" : "apiKey";
}

export function codexAppServerHelperRequestError(error = null, reason = "", errorPrefix = "") {
  if (
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    (typeof error?.code === "string" && error.code.startsWith(`${errorPrefix}codex_helper_`)) ||
    error?.code === `${errorPrefix}codex_model_catalog_invalid`
  ) {
    return error;
  }
  const failure = new Error("Codex isolated helper execution failed. Retry the task.");
  failure.code = `${errorPrefix}codex_helper_provider_request_failed`;
  const providerCode = Number(error?.code);
  if (Number.isSafeInteger(providerCode)) {
    failure.providerCode = providerCode;
  }
  const normalizedReason = normalizeAgentText(reason);
  if (normalizedReason && normalizedReason.length <= 128) {
    failure.operation = normalizedReason;
  }
  return failure;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function selectedHelperAuth(provider) {
  if (!provider.isHelperProvider()) {
    return null;
  }
  if (provider.host.parameters.providerHome) {
    return { identitySignature: await provider.credentials.identity(provider.host.parameters) };
  }
  return provider.accountReader.readSelected(provider.options);
}

/** @param {CodexAppServerAgentProvider} provider */
export async function assertHelperAccountIdentityCurrent(provider) {
  if (!provider.isHelperProvider() || !provider.helperAuth) {
    return;
  }
  if (provider.helperAuthBlocked) {
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_changed`,
      "The selected Codex account changed during helper work. Retry the task with the current account."
    );
  }
  const current = await provider.selectedHelperAuth();
  if (current.identitySignature !== provider.helperAuth.identitySignature) {
    provider.helperAuthBlocked = true;
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_changed`,
      "The selected Codex account changed during helper work. Retry the task with the current account."
    );
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function authenticateHelperClient(provider, client, runtime = {}) {
  if (!provider.isHelperProvider()) {
    return null;
  }
  const auth = await provider.selectedHelperAuth();
  if (
    !runtime.accountIdentitySignature ||
    auth.identitySignature !== runtime.accountIdentitySignature
  ) {
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_changed`,
      "The selected Codex account changed while helper execution was starting. Retry the task."
    );
  }
  provider.helperAuth = auth;
  provider.helperAuthBlocked = false;
  if (provider.host.parameters.providerHome) return auth;
  try {
    const login = await client.request(
      "account/login/start",
      codexAppServerHelperLoginParams(auth, provider.errorPrefix)
    );
    if (normalizeAgentText(login?.type) !== codexAppServerHelperLoginResponseType(auth)) {
      throw new Error("invalid login response");
    }
    const account = await client.request("account/read", {
      refreshToken: false
    });
    if (
      account?.requiresOpenaiAuth !== true ||
      normalizeAgentText(account?.account?.type) !== codexAppServerHelperAccountType(auth)
    ) {
      throw new Error("invalid account response");
    }
    return auth;
  } catch {
    provider.helperAuth = null;
    provider.helperAuthBlocked = true;
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_unavailable`,
      "Codex could not activate the selected account for isolated helper work. Reconnect Codex and retry."
    );
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function refreshHelperChatgptAuth(provider, params = {}) {
  const currentAuth = provider.helperAuth;
  const previousAccountId = params.previousAccountId;
  if (
    !provider.isHelperProvider() ||
    currentAuth?.authMode !== "chatgpt" ||
    params.reason !== "unauthorized" ||
    typeof previousAccountId !== "string" ||
    previousAccountId.length === 0 ||
    previousAccountId.length > CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH ||
    previousAccountId !== currentAuth.accountId
  ) {
    provider.helperAuthBlocked = true;
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_refresh_rejected`,
      "Codex helper authentication refresh was rejected. Reconnect Codex and retry."
    );
  }
  const refreshed = await provider.selectedHelperAuth();
  if (
    refreshed.authMode !== "chatgpt" ||
    refreshed.identitySignature !== currentAuth.identitySignature
  ) {
    provider.helperAuthBlocked = true;
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_changed`,
      "The selected Codex account changed during helper work. Retry the task with the current account."
    );
  }
  if (refreshed.secretSignature === currentAuth.secretSignature) {
    provider.helperAuthBlocked = true;
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_auth_refresh_pending`,
      "The selected Codex account has not produced a newer access token yet. Reconnect Codex and retry."
    );
  }
  provider.helperAuth = refreshed;
  return {
    accessToken: refreshed.accessToken,
    chatgptAccountId: refreshed.accountId,
    chatgptPlanType: refreshed.planType || null
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function handleServerRequest(provider, request = {}, sourceClient = provider.client) {
  if (
    provider.isHelperProvider() &&
    request.method === CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD
  ) {
    return provider.refreshHelperChatgptAuth(request.params);
  }
  if (provider.isHelperProvider()) {
    const error = new Error("Codex isolated helper execution does not accept server requests.");
    error.code = -32601;
    throw error;
  }
  const threadHandler = request.method === "item/tool/call" && provider.threadRequestHandlers.get(request.params?.threadId);
  if (threadHandler) {
    if (sourceClient !== provider.client) {
      const error = new Error("This retired Codex connection does not authorize that native tool request.");
      error.code = -32601;
      throw error;
    }
    return threadHandler.handler(request);
  }
  if (typeof provider.serverRequestHandler === "function") {
    return provider.serverRequestHandler(request);
  }
  const error = new Error("Codex app-server request is not supported by this client.");
  error.code = -32601;
  throw error;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function preflightAuth(provider, reason = "codex-auth-preflight", modelProviderId = "") {
  if (await provider.options.prepareAuth?.(modelProviderId) === "external") {
    await provider.assertRuntimeAuthReady(reason);
    return;
  }
  if (provider.options.modelProviderId && provider.options.modelProviderId !== "openai") {
    await provider.credentials.assertCurrent("");
    return;
  }
  await provider.assertRuntimeAuthReady(reason);
  try {
    return await assertCodexAuthPreflightReady({ ...provider.options, codexCommand: provider.host.parameters.codexCommand }, {
      execution: provider.host.execution, credentials: provider.credentials, reason
    });
  } catch (error) {
    if (error?.code === provider.credentials.reconnectRequiredCode && provider.runtime?.runtimeDir) {
      await provider.stopRuntimeAndRequireDrain(reason);
    }
    throw error;
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function assertRuntimeAuthReady(provider, reason = "codex-app-server") {
  if (provider.isHelperProvider() || provider.stale) {
    return;
  }
  const runtime = provider.runtime || {};
  let generationError = null;
  try {
    await provider.credentials.assertCurrent(runtime.authStateSignature);
  } catch (error) {
    generationError = error;
  }
  const logTail = await tailTextFile(runtime.logPath || "");
  const reconnectRequired = codexAuthOutputRequiresReconnect(logTail);
  if (!generationError && !reconnectRequired) {
    return;
  }
  await provider.stopRuntimeAndRequireDrain(reason);
  if (reconnectRequired) {
    await provider.markReconnectRequired({
      toolHomeSource: runtime.toolHomeSource || provider.options.toolHomeSource,
      observed: logTail,
      reason
    });
    throw provider.credentials.reconnectError({
      observed: logTail
    });
  }
  throw generationError;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function markReconnectRequired(provider, { reason = "codex-app-server", observed = "", toolHomeSource } = {}) {
  await provider.credentials.markInvalid({ reason, toolHomeSource });
  throw provider.credentials.reconnectError({ modelProviderId: provider.options.modelProviderId, observed });
}
