import { CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH, codexAuthOutputRequiresReconnect, createCodexAccountReader } from "./codexAccountReader.js";
import { assertCodexAuthPreflightReady } from "./codexAuthPreflight.js";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import { tailTextFile } from "./codexProcess.js";

/** @typedef {import("./codexProvider.js").CodexAppServerAgentProvider} CodexAppServerAgentProvider */

export const codexAppServerHelperAuthError = createCodexAccountReader().error;

function codexAppServerHelperLoginParams(auth = {}, errorPrefix = "") {
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

function codexAppServerHelperLoginResponseType(auth = {}) {
  return auth.authMode === "chatgpt" ? "chatgptAuthTokens" : "apiKey";
}

function codexAppServerHelperAccountType(auth = {}) {
  return auth.authMode === "chatgpt" ? "chatgpt" : "apiKey";
}

// Without an application preparing external sign-in, a provider uses Codex's native sign-in.
function prepareNativeAuth() {
  return "native";
}

function codexPlanUsage(limits) {
  if (limits?.limitId && limits.limitId !== "codex") return { status: "unavailable", windows: [], checkedAt: Date.now() };
  const windows = ["primary", "secondary"].flatMap((id) => {
    const value = limits?.[id];
    if (typeof value?.usedPercent !== "number" || !Number.isFinite(value.usedPercent) || value.usedPercent < 0) return [];
    return [{
      id,
      remainingPercent: Math.max(0, 100 - Math.min(100, value.usedPercent)),
      windowDurationMins: Number.isInteger(value.windowDurationMins) && value.windowDurationMins > 0 ? value.windowDurationMins : null,
      resetsAt: Number.isSafeInteger(value.resetsAt) && value.resetsAt > 0 ? value.resetsAt : null
    }];
  });
  return { status: windows.length ? "available" : "unavailable", windows, checkedAt: Date.now() };
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
/**
 * The provider's authentication: the helper account it signs its isolated runtime into, the runtime's
 * sign-in checks, and the account's plan usage.
 * @param {object} dependencies
 * @param {CodexAppServerAgentProvider} dependencies.provider
 */
export function createCodexProviderAuth({ provider }) {
  // The helper account signed into this provider's isolated runtime, and whether helper work is refused.
  let helperAuth = null;
  let helperAuthBlocked = false;
  let planUsage = null;
  let planUsagePending = null;
  // Counts account changes, so a plan-usage read that started before one is discarded.
  let planUsageAuthGeneration = 0;

  async function selectedHelperAuth() {
    if (!provider.isHelperProvider()) {
      return null;
    }
    if (provider.host.parameters.providerHome) {
      return { identitySignature: await provider.credentials.identity(provider.host.parameters) };
    }
    return provider.accountReader.readSelected(provider.options);
  }

  async function assertHelperAccountIdentityCurrent() {
    if (!provider.isHelperProvider() || !helperAuth) {
      return;
    }
    if (helperAuthBlocked) {
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed during helper work. Retry the task with the current account."
      );
    }
    const current = await selectedHelperAuth();
    if (current.identitySignature !== helperAuth.identitySignature) {
      helperAuthBlocked = true;
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed during helper work. Retry the task with the current account."
      );
    }
  }

  async function authenticateHelperClient(client, runtime = {}) {
    if (!provider.isHelperProvider()) {
      return null;
    }
    const auth = await selectedHelperAuth();
    if (
      !runtime.accountIdentitySignature ||
      auth.identitySignature !== runtime.accountIdentitySignature
    ) {
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed while helper execution was starting. Retry the task."
      );
    }
    helperAuth = auth;
    helperAuthBlocked = false;
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
      helperAuth = null;
      helperAuthBlocked = true;
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_unavailable`,
        "Codex could not activate the selected account for isolated helper work. Reconnect Codex and retry."
      );
    }
  }

  async function refreshHelperChatgptAuth(params = {}) {
    const currentAuth = helperAuth;
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
      helperAuthBlocked = true;
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_refresh_rejected`,
        "Codex helper authentication refresh was rejected. Reconnect Codex and retry."
      );
    }
    const refreshed = await selectedHelperAuth();
    if (
      refreshed.authMode !== "chatgpt" ||
      refreshed.identitySignature !== currentAuth.identitySignature
    ) {
      helperAuthBlocked = true;
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed during helper work. Retry the task with the current account."
      );
    }
    if (refreshed.secretSignature === currentAuth.secretSignature) {
      helperAuthBlocked = true;
      throw provider.accountReader.error(
        `${provider.errorPrefix}codex_helper_auth_refresh_pending`,
        "The selected Codex account has not produced a newer access token yet. Reconnect Codex and retry."
      );
    }
    helperAuth = refreshed;
    return {
      accessToken: refreshed.accessToken,
      chatgptAccountId: refreshed.accountId,
      chatgptPlanType: refreshed.planType || null
    };
  }

  async function preflightAuth(reason = "codex-auth-preflight", modelProviderId = "") {
    const { prepareAuth = prepareNativeAuth } = provider.options;
    if (await prepareAuth(modelProviderId) === "external") {
      await provider.assertRuntimeAuthReady(reason);
      return;
    }
    if (provider.options.modelProviderId && provider.options.modelProviderId !== "openai") {
      await provider.credentials.assertCurrent("");
      return;
    }
    await provider.assertRuntimeAuthReady(reason);
    try {
      return await assertCodexAuthPreflightReady({
        ...provider.options, codexCommand: provider.host.parameters.codexCommand, env: provider.host.parameters.env
      }, {
        execution: provider.host.execution, credentials: provider.credentials, reason
      });
    } catch (error) {
      if (error?.code === provider.credentials.reconnectRequiredCode && provider.runtime?.runtimeDir) {
        await provider.stopRuntimeAndRequireDrain(reason);
      }
      throw error;
    }
  }

  async function assertRuntimeAuthReady(reason = "codex-app-server") {
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

  async function markReconnectRequired({ reason = "codex-app-server", observed = "", toolHomeSource } = {}) {
    await provider.credentials.markInvalid({ reason, toolHomeSource });
    throw provider.credentials.reconnectError({ modelProviderId: provider.options.modelProviderId, observed });
  }

  async function readPlanUsage() {
    const client = provider.client;
    if (!client?.isOpen()) return { status: "unavailable", windows: [] };
    if (planUsage && Date.now() - planUsage.checkedAt < 60_000) return planUsage;
    if (planUsagePending) return planUsagePending;
    const previous = planUsage;
    const authGeneration = planUsageAuthGeneration;
    const signal = AbortSignal.timeout(10_000);
    const operation = (async () => {
      try {
        const account = await client.request("account/read", { refreshToken: false }, { signal });
        if (provider.client !== client || planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
        if (account?.account?.type !== "chatgpt") {
          planUsage = { status: "unsupported", windows: [], checkedAt: Date.now() };
        } else {
          const result = await client.request("account/rateLimits/read", {}, { signal });
          if (provider.client !== client || planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
          // A live event received during the read is newer than this request.
          if (planUsage === previous) planUsage = codexPlanUsage(result.rateLimitsByLimitId?.codex || result.rateLimits);
        }
        return planUsage;
      } catch {
        return { status: "unavailable", windows: [] };
      }
    })();
    planUsagePending = operation;
    try { return await operation; }
    finally { if (planUsagePending === operation) planUsagePending = null; }
  }

  // A new connection reads the account's plan usage afresh.
  function resetPlanUsage() {
    planUsage = null;
    planUsagePending = null;
  }

  // Account notifications change the plan usage the provider reports.
  function observeAccountNotification(notification) {
    if (notification.method === "account/updated") {
      planUsage = null;
      planUsageAuthGeneration += 1;
    }
    if (notification.method === "account/rateLimits/updated") {
      const limits = notification.params?.rateLimits;
      if (!limits?.limitId || limits.limitId === "codex") planUsage = codexPlanUsage(limits);
    }
  }

  // A helper runtime that failed to start refuses helper work until it signs in again.
  function blockHelper() {
    helperAuth = null;
    helperAuthBlocked = true;
  }

  // A closed provider keeps no helper account.
  function forgetHelper() {
    helperAuth = null;
    helperAuthBlocked = false;
  }

  return Object.freeze({
    selectedHelperAuth,
    assertHelperAccountIdentityCurrent,
    authenticateHelperClient,
    refreshHelperChatgptAuth,
    preflightAuth,
    assertRuntimeAuthReady,
    markReconnectRequired,
    readPlanUsage,
    resetPlanUsage,
    observeAccountNotification,
    blockHelper,
    forgetHelper
  });
}
