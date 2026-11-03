import { CODEX_APP_SERVER_EXECUTION_MODES, CODEX_APP_SERVER_PROCESS_STATE, CODEX_APP_SERVER_PROVIDER_ID, CODEX_APP_SERVER_TRANSPORT, codexAppServerExecutionMode, codexAppServerHelperWorkspaceDir, codexAppServerRuntimeIdentity, codexAppServerTerminalEnvHash, ensureWritablePrivateDirectory, tailTextFile } from "./codexProcess.js";
import { CodexAppServerJsonRpcClient } from "./codexClient.js";
import { codexAppServerHelperRequestError } from "./codexProviderAuth.js";
import { codexAppServerTextHasControlCharacters } from "./codexConfiguration.js";
import { codexAuthOutputRequiresReconnect } from "./codexAccountReader.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import path from "node:path";
import { interruptNativeTurn, stopCommandExecution } from "./codexProviderTurns.js";

/** @typedef {import("./codexProvider.js").CodexAppServerAgentProvider} CodexAppServerAgentProvider */

const CODEX_APP_SERVER_HELPER_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

const CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH = 512;

function normalizeCodexAppServerInfo(initializeResult = null) {
  if (!isRecord(initializeResult)) {
    return null;
  }
  const rawUserAgent = initializeResult.userAgent;
  if (
    typeof rawUserAgent !== "string" ||
    rawUserAgent.length === 0 ||
    rawUserAgent.length > CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH ||
    codexAppServerTextHasControlCharacters(rawUserAgent)
  ) {
    return Object.freeze({ userAgent: "" });
  }
  return Object.freeze({
    userAgent: rawUserAgent.trim()
  });
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

/** @param {CodexAppServerAgentProvider} provider */
export async function ensureRuntime(provider) {
  if (provider.runtimePromise) {
    return provider.runtimePromise;
  }
  const operation = provider.prepareRuntime();
  provider.runtimePromise = operation;
  try {
    return await operation;
  } finally {
    if (provider.runtimePromise === operation) {
      provider.runtimePromise = null;
    }
  }
}

/**
 * An account change leaves a runtime that is still working on the
 * credentials it started with. Codex reads them once, so this provider
 * finishes its running turn on them and then stops; it never re-checks,
 * replaces or restarts its runtime, and never marks the new account invalid.
 * @param {CodexAppServerAgentProvider} provider
 */
export function markStale(provider) {
  provider.stale = true;
}

/** @param {CodexAppServerAgentProvider} provider */
export function staleRuntimeError(provider) {
  return Object.assign(new Error("Codex (OpenAI) changed account. Send your message again."), {
    code: `${provider.errorPrefix}codex_account_changed`, retryable: true
  });
}

/** @param {CodexAppServerAgentProvider} provider */
export async function prepareRuntime(provider) {
  if (provider.stale) throw provider.staleRuntimeError();
  const previousRuntime = provider.runtime;
  const nextRuntime = await provider.host.runtime.ensure(provider.host.parameters);
  if (provider.options.modelProviderId) nextRuntime.modelProviderId = provider.options.modelProviderId;
  if (
    provider.client &&
    previousRuntime &&
    codexAppServerRuntimeIdentity(previousRuntime) !== codexAppServerRuntimeIdentity(nextRuntime)
  ) {
    provider.client.close();
    provider.client = null;
    provider.initializeResult = null;
  }
  provider.runtime = nextRuntime;
  provider.runtimeStopOwner = nextRuntime;
  await provider.assertRuntimeAuthReady("codex-app-server-runtime");
  return provider.runtime;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function runRequest(provider, operation, reason = "codex-app-server-request") {
  try {
    await provider.assertHelperAccountIdentityCurrent();
    const result = await operation();
    await provider.assertHelperAccountIdentityCurrent();
    await provider.assertRuntimeAuthReady(reason);
    return result;
  } catch (error) {
    if (provider.isHelperProvider()) {
      throw codexAppServerHelperRequestError(error, reason, provider.errorPrefix);
    }
    const observed = [
      error?.message || "",
      error?.observed || "",
      await tailTextFile(provider.runtime?.logPath || "")
    ].filter(Boolean).join("\n");
    if (!provider.stale && codexAuthOutputRequiresReconnect(observed)) {
      const runtime = provider.runtime || {};
      if (runtime.runtimeDir) {
        await provider.stopRuntimeAndRequireDrain(reason);
      }
      await provider.markReconnectRequired({
        toolHomeSource: runtime.toolHomeSource || provider.options.toolHomeSource,
        observed,
        reason
      });
    }
    throw error;
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function stopRuntimeAndRequireDrain(provider, reason = "codex-app-server-stop") {
  const result = await provider.stopRuntime({
    preserveProcessExitProof: !provider.isHelperProvider()
  });
  if (
    result?.processExitVerified === true ||
    result?.runtimeDirRemoved === true ||
    result?.stopped === true
  ) {
    return result;
  }
  const error = new Error("Codex app-server execution could not be proven empty.");
  error.code = provider.isHelperProvider()
    ? `${provider.errorPrefix}codex_helper_runtime_cleanup_required`
    : `${provider.errorPrefix}codex_app_server_cleanup_required`;
  error.cleanupRequired = true;
  error.reason = normalizeAgentText(reason);
  error.retryable = false;
  throw error;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function connect(provider) {
  if (provider.observationFailure) throw provider.observationFailure;
  if (provider.client?.isOpen() && provider.runtime) {
    return {
      initializeResult: null,
      reusedClient: true,
      runtime: provider.runtime
    };
  }
  if (provider.connectPromise) {
    return provider.connectPromise;
  }
  const operation = provider.openConnection();
  provider.connectPromise = operation;
  try {
    return await operation;
  } finally {
    if (provider.connectPromise === operation) {
      provider.connectPromise = null;
    }
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function openConnection(provider) {
  if (provider.client?.isOpen() && provider.runtime) {
    return {
      initializeResult: null,
      reusedClient: true,
      runtime: provider.runtime
    };
  }
  const runtime = await provider.ensureRuntime();
  if (provider.client?.isOpen()) {
    return {
      initializeResult: null,
      reusedClient: true,
      runtime
    };
  }
  provider.client?.close();
  provider.client = null;
  provider.initializeResult = null;
  const client = new CodexAppServerJsonRpcClient({
    endpoint: runtime.endpoint,
    onDisconnect: (error) => {
      if (provider.client === client) {
        for (const reject of provider.settingsWaiters) reject(error);
        provider.failObservation(error);
      }
    },
    ...(provider.isHelperProvider()
      ? { maxMessageBytes: CODEX_APP_SERVER_HELPER_MAX_MESSAGE_BYTES }
      : {}),
    requestTimeoutMs: provider.options.requestTimeoutMs,
    WebSocketImpl: provider.options.WebSocketImpl
  });
  client.setRequestHandler((request) => provider.handleServerRequest(request, client));
  let initializeResult = null;
  try {
    await client.connect();
    initializeResult = await provider.runRequest(
      () => client.initialize({ clientInfo: provider.configuration.clientInfo, ...provider.options.initialize }),
      "codex-app-server-initialize"
    );
    await provider.authenticateHelperClient(client, runtime);
  } catch (error) {
    client.close();
    if (!runtime.runtimeDir) {
      throw error;
    }
    const helper = provider.isHelperProvider();
    const cleanup = await provider.host.runtime.cleanupFailedStart(runtime.runtimeDir, {
      helper,
      executionId: runtime.executionId,
      pid: runtime.pid,
      processIdentity: runtime.processIdentity
    }, provider.host.parameters);
    provider.runtimeStopOwner = cleanup.processExitVerified === true
      ? {
        ...runtime,
        processExitVerifiedAt: new Date().toISOString(),
        processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      }
      : runtime;
    provider.runtime = null;
    if (helper) {
      provider.helperAuth = null;
      provider.helperAuthBlocked = true;
    }
    if (cleanup.cleanupFailed) {
      const failure = new Error(
        helper
          ? "Codex isolated helper runtime could not be retired after startup failed."
          : "Codex app-server runtime could not be retired after initialization failed.",
        { cause: error }
      );
      failure.code = helper
        ? `${provider.errorPrefix}codex_helper_runtime_cleanup_required`
        : `${provider.errorPrefix}codex_app_server_cleanup_required`;
      failure.cleanupRequired = true;
      failure.retryable = false;
      throw failure;
    }
    throw error;
  }
  provider.client = client;
  provider.planUsage = null;
  provider.planUsagePending = null;
  client.subscribe((notification = {}) => {
    if (provider.client !== client || provider.observationFailure) return;
    if (notification.method === "account/updated") {
      provider.planUsage = null;
      provider.planUsageAuthGeneration += 1;
    }
    if (notification.method === "account/rateLimits/updated") {
      const limits = notification.params?.rateLimits;
      if (!limits?.limitId || limits.limitId === "codex") provider.planUsage = codexPlanUsage(limits);
    }
    provider.publishNotification(notification);
  });
  provider.initializeResult = normalizeCodexAppServerInfo(initializeResult);
  provider.connectionGeneration += 1;
  return {
    initializeResult: provider.isHelperProvider() ? provider.initializeResult : initializeResult,
    runtime
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export function publishNotification(provider, notification) {
  const threadId = notification.params?.threadId;
  if (notification.method === "thread/goal/updated") {
    notification = { ...notification, params: { ...notification.params,
      goal: provider.conversationRuntime.projectGoal(threadId, notification.params.goal) } };
  }
  const turnId = notification.params?.turnId;
  const item = notification.params?.item;
  if (item?.type === "commandExecution" && item.processId && item.source === "unifiedExecStartup") {
    const key = JSON.stringify([threadId, turnId, item.id]);
    if (notification.method === "item/completed") {
      const command = provider.commandExecutions.get(key);
      if (command) command.completed = true;
      provider.commandExecutions.delete(key);
    } else if (notification.method === "item/started") {
      const command = provider.commandExecutions.get(key) || {
        threadId, turnId, itemId: item.id, processId: item.processId, client: provider.client
      };
      provider.commandExecutions.set(key, command);
      // Native startup may finish after turn/interrupt has already returned.
      if (provider.interruptedTurns.has(JSON.stringify([threadId, turnId]))) {
        void stopCommandExecution(provider, command).catch(() => null);
      }
    }
  }
  const probe = provider.threadControlProbes.get(threadId);
  const method = notification.method;
  if (probe && (/^(turn|item)\//u.test(method) || method === "thread/status/changed")) {
    const turnId = notification.params?.turnId || notification.params?.turn?.id;
    if (method === "turn/started" && probe.turnId && probe.turnId !== turnId) {
      provider.threadControlProbes.delete(threadId);
    } else if (probe.verified) {
      if (turnId === probe.turnId) {
        if (method === "item/completed" && notification.params.item?.id === probe.itemId) {
          probe.result = notification.params.item;
        }
        if (method === "turn/completed") probe.completed = true;
      }
      return;
    } else {
      if (method === "turn/started") probe.turnId = turnId;
      probe.pending.push(notification);
      if (method === "item/started" || probe.pending.length >= 32) {
        const item = notification.params?.item;
        if (item?.type === "commandExecution" && item.command?.includes(probe.marker)) {
          probe.verified = true;
          probe.itemId = item.id;
          probe.pending = [];
        } else {
          // A concurrent native user turn must retain every event. Only a
          // positively identified control probe may be hidden from chat.
          provider.threadControlProbes.delete(threadId);
          for (const pending of probe.pending) provider.publishNotification(pending);
        }
      }
      return;
    }
  }
  for (const subscriber of provider.notificationSubscribers) {
    try {
      subscriber(notification);
    } catch (error) {
      provider.failObservation(error);
    }
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function currentRuntimeInfo(provider) {
  const runtime = provider.runtime || {};
  const executionMode = codexAppServerExecutionMode(provider.options);
  const parameters = provider.host.parameters;
  return Object.freeze({
    accountIdentitySignature: await provider.credentials.identity(provider.host.parameters, {
      includeInteractive: true
    }),
    authStateSignature: await provider.credentials.generation(parameters),
    endpoint: normalizeAgentText(runtime.endpoint),
    executionMode,
    executionContextHash: normalizeAgentText(runtime.executionContextHash) ||
      normalizeAgentText(parameters.compatibility?.executionContextHash),
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    runtimeDir: normalizeAgentText(
      runtime.runtimeDir || parameters.runtimeDir
    ),
    runtimesHash: normalizeAgentText(runtime.runtimesHash) ||
      normalizeAgentText(parameters.compatibility?.runtimesHash),
    terminalEnvHash: normalizeAgentText(runtime.terminalEnvHash) ||
      codexAppServerTerminalEnvHash(provider.isHelperProvider() ? {} : provider.options.terminalEnv),
    toolHomeSource: executionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
      ? ""
      : normalizeAgentText(provider.options.toolHomeSource),
    transport: normalizeAgentText(runtime.transport) || CODEX_APP_SERVER_TRANSPORT.UNIX
  });
}

/** @param {CodexAppServerAgentProvider} provider */
export async function currentHelperExecutionContext(provider) {
  const runtime = await provider.ensureRuntime();
  const cwd = normalizeAgentText(provider.options.helperWorkdir)
    ? path.resolve(provider.options.helperWorkdir)
    : codexAppServerHelperWorkspaceDir(runtime.runtimeDir);
  if (!runtime.runtimeDir) {
    throw provider.accountReader.error(
      `${provider.errorPrefix}codex_helper_runtime_invalid`,
      "Codex helper runtime isolation could not be verified."
    );
  }
  await ensureWritablePrivateDirectory(cwd);
  return Object.freeze({
    accountIdentitySignature: await provider.credentials.identity(provider.host.parameters, {
      includeInteractive: true
    }),
    cwd,
    executionMode: CODEX_APP_SERVER_EXECUTION_MODES.HELPER
  });
}

/** @param {CodexAppServerAgentProvider} provider */
export async function activeClient(provider) {
  if (provider.observationFailure) throw provider.observationFailure;
  if (provider.client?.isOpen()) {
    return provider.client;
  }
  await provider.connect();
  return provider.client;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function ensureAvailable(provider, { modelProviderId = "" } = {}) {
  if (provider.observationFailure) throw provider.observationFailure;
  if (provider.stale && !provider.isAvailable()) throw provider.staleRuntimeError();
  if (provider.isAvailable()) {
    return {
      client: provider.client,
      ok: true,
      reusedClient: true,
      runtime: provider.runtime
    };
  }
  if (provider.availabilityPromise) {
    return provider.availabilityPromise;
  }
  const operation = (async () => {
    if (!provider.isHelperProvider()) {
      await provider.preflightAuth("codex-app-server-ensure-available", modelProviderId);
    }
    const client = await provider.activeClient();
    return {
      client,
      ok: true,
      runtime: provider.runtime
    };
  })();
  provider.availabilityPromise = operation;
  try {
    return await operation;
  } finally {
    if (provider.availabilityPromise === operation) {
      provider.availabilityPromise = null;
    }
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function readPlanUsage(provider) {
  const client = provider.client;
  if (!client?.isOpen()) return { status: "unavailable", windows: [] };
  if (provider.planUsage && Date.now() - provider.planUsage.checkedAt < 60_000) return provider.planUsage;
  if (provider.planUsagePending) return provider.planUsagePending;
  const previous = provider.planUsage;
  const authGeneration = provider.planUsageAuthGeneration;
  const signal = AbortSignal.timeout(10_000);
  const operation = (async () => {
    try {
      const account = await client.request("account/read", { refreshToken: false }, { signal });
      if (provider.client !== client || provider.planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
      if (account?.account?.type !== "chatgpt") {
        provider.planUsage = { status: "unsupported", windows: [], checkedAt: Date.now() };
      } else {
        const result = await client.request("account/rateLimits/read", {}, { signal });
        if (provider.client !== client || provider.planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
        // A live event received during the read is newer than this request.
        if (provider.planUsage === previous) provider.planUsage = codexPlanUsage(result.rateLimitsByLimitId?.codex || result.rateLimits);
      }
      return provider.planUsage;
    } catch {
      return { status: "unavailable", windows: [] };
    }
  })();
  provider.planUsagePending = operation;
  try { return await operation; }
  finally { if (provider.planUsagePending === operation) provider.planUsagePending = null; }
}

/** @param {CodexAppServerAgentProvider} provider */
export function failObservation(provider, cause) {
  const message = cause?.code === `${provider.errorPrefix}agent_control_recovery_failed`
    ? cause.message
    : "Codex observation failed. Work must be stopped before it can continue.";
  provider.observationFailure ||= Object.assign(
    new Error(message, { cause }),
    { code: `${provider.errorPrefix}codex_observation_lost` }
  );
  // readable-check: allow optional-call - optional operation: only a provider an owner creates is told when its observation is lost
  return provider.options.onObservationLost?.(provider.observationFailure);
}

/** @param {CodexAppServerAgentProvider} provider */
export async function stopThreadForObservationLoss(provider, threadId, turnId) {
  // Control uses only this existing socket. It must not spawn or resume work
  // to find out whether the work we lost sight of has stopped.
  const client = provider.client;
  if (!client?.isOpen()) throw new Error("Codex control connection is unavailable.");
  if (provider.commandStopFailure) throw provider.commandStopFailure;
  const signal = AbortSignal.timeout(5_000);
  const request = (method, params) => client.request(method, params, { signal });
  let { goal } = await request("thread/goal/get", { threadId });
  if (goal?.status === "active") {
    const result = await request("thread/goal/set", { threadId, status: "paused" });
    if (result.goal?.status !== "paused" || result.goal?.createdAt !== goal.createdAt || result.goal?.objective !== goal.objective) {
      throw new Error("Codex did not confirm that the same goal was paused.");
    }
    goal = result.goal;
  }
  const readStatus = async () => {
    const { thread } = await request("thread/read", { threadId, includeTurns: false });
    return typeof thread?.status === "string" ? thread.status : thread?.status?.type;
  };
  if (!["idle", "notLoaded"].includes(await readStatus())) {
    if (!turnId) {
      const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" });
      turnId = page.data?.[0]?.id;
    }
    if (!turnId) throw new Error("Codex's running turn could not be identified.");
    await interruptNativeTurn(provider, client, threadId, turnId, signal);
    if (await readStatus() !== "idle") throw new Error("Codex did not confirm that its turn stopped.");
  }
  return { goal };
}

/** @param {CodexAppServerAgentProvider} provider */
export function setServerRequestHandler(provider, callback) {
  const handler = typeof callback === "function" ? callback : null;
  provider.serverRequestHandler = handler;
  const client = provider.client;
  client?.setRequestHandler((request) => provider.handleServerRequest(request, client));
  return () => {
    if (provider.serverRequestHandler === handler) {
      provider.serverRequestHandler = null;
      const client = provider.client;
      client?.setRequestHandler((request) => provider.handleServerRequest(request, client));
    }
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export function registerThreadRequestHandler(provider, threadId, handler) {
  if (typeof threadId !== "string" || !threadId.trim() || typeof handler !== "function") {
    throw new TypeError("Codex tool dispatch requires its exact thread and handler.");
  }
  if (provider.threadRequestHandlers.has(threadId)) throw new Error("This Codex thread already has an application tool owner.");
  const runInContext = provider.options.runInContext;
  const registration = { handler: typeof runInContext === "function"
    ? request => runInContext(() => handler(request)) : handler };
  provider.threadRequestHandlers.set(threadId, registration);
  const client = provider.client;
  client?.setRequestHandler(request => provider.handleServerRequest(request, client));
  return Object.freeze({
    isCurrent: () => provider.threadRequestHandlers.get(threadId) === registration,
    release: () => {
      if (provider.threadRequestHandlers.get(threadId) === registration) provider.threadRequestHandlers.delete(threadId);
    }
  });
}

/** @param {CodexAppServerAgentProvider} provider */
export function close(provider) {
  // readable-check: allow optional-call - optional operation: only a provider an owner creates with thread controls is told when it closes
  provider.options.onClose?.();
  for (const reject of provider.settingsWaiters) reject(new Error("The assistant connection closed before confirming its settings."));
  provider.settingsWaiters.clear();
  provider.conversationRuntime.close();
  provider.threadControlProbes.clear();
  provider.commandExecutions.clear();
  provider.interruptedTurns.clear();
  provider.planUsage = null;
  provider.planUsagePending = null;
  provider.notificationSubscribers.clear();
  provider.threadRequestHandlers.clear();
  provider.client?.close();
  provider.client = null;
  provider.initializeResult = null;
  provider.helperAuth = null;
  provider.helperAuthBlocked = false;
}

/** @param {CodexAppServerAgentProvider} provider */
export async function stopRuntime(provider, {
    expectedAccountIdentitySignature = "",
    preserveProcessExitProof = false
  } = {}) {
  provider.close();
  provider.runtimeStopOwner = provider.runtime || provider.runtimeStopOwner;
  const runtime = provider.runtimeStopOwner || {};
  const result = await provider.host.runtime.stop({
    ...provider.host.parameters,
    expectedAccountIdentitySignature,
    ownedRuntime: runtime,
    preserveProcessExitProof,
    runtimeDir: runtime.runtimeDir || provider.options.runtimeDir
  });
  if (result.processExitVerified === true && provider.runtimeStopOwner === runtime) {
    provider.runtimeStopOwner = {
      ...runtime,
      processExitVerifiedAt: runtime.processExitVerifiedAt || new Date().toISOString(),
      processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
    };
  }
  if (provider.runtime === runtime) {
    provider.runtime = null;
  }
  return result;
}
