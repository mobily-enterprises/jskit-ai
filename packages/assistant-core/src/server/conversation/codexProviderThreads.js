import { CODEX_APP_SERVER_PROVIDER_ID, normalizeCodexAppServerTerminalEnv } from "./codexProcess.js";
import { CodexAppServerJsonRpcClient } from "./codexClient.js";
import { codexAppServerProjectHookTrustConfig } from "./codexConfiguration.js";
import { codexAppServerProviderThreadTurns, codexAppServerProviderTurnClientIds, codexAppServerProviderTurnItems, codexAppServerThreadRawValue } from "./codexEvents.js";
import { codexControlProbeCommand } from "./codexProviderTurns.js";
import { createHash, randomUUID } from "node:crypto";
import { exportCodexNativeHistory } from "./codexNativeHistoryExport.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { lstat, realpath } from "node:fs/promises";
import { normalizeNullableText as normalizeAgentText } from "./normalize.js";
import path from "node:path";
import { prepareCodexHistory } from "./codexHistoryAdapter.js";
import { readStoppedNativeDatabase, retireNativeConversation } from "./nativeHistoryExport.js";
import { releaseSupersededCodexRuntime } from "./codexRuntimeInventory.js";

/** @typedef {import("./codexProvider.js").CodexAppServerAgentProvider} CodexAppServerAgentProvider */

export const CODEX_APP_SERVER_INVALID_REQUEST_CODE = -32600;

export function codexAppServerRequestIsInvalid(error = null, method = "") {
  const expectedMethod = normalizeAgentText(method);
  const actualMethod = normalizeAgentText(error?.method);
  return Number(error?.code) === CODEX_APP_SERVER_INVALID_REQUEST_CODE &&
    (!expectedMethod || !actualMethod || actualMethod === expectedMethod);
}

export function codexAppServerThreadIsMissing(error = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId || "").toLowerCase();
  if (
    !normalizedThreadId ||
    !codexAppServerRequestIsInvalid(error, "thread/read")
  ) {
    return false;
  }
  // Codex also uses -32600 for unrelated invalid requests, so recovery must
  // match both the missing-thread wording and the exact durable thread id.
  const message = normalizeAgentText(error?.message || "").toLowerCase();
  return [
    `thread not loaded: ${normalizedThreadId}`,
    `thread ${normalizedThreadId} not found`,
    `no rollout found for thread id ${normalizedThreadId}`
  ].includes(message);
}

export async function retireCodexConversationHistory(provider, binding, {
  toolHomeSource, beforeDelete, signal, errorPrefix = ""
} = {}) {
  const inspect = async () => {
    const ids = [...new Set([binding.conversationId, ...await provider.listThreadDescendants(binding.conversationId)])].sort();
    const records = [];
    for (const conversationId of ids) {
      let thread;
      try { thread = codexAppServerThreadRawValue(await provider.readThreadStatus(conversationId)); }
      catch (error) {
        // Native thread/read also says "not loaded" after deletion. Only
        // an exhaustive native inventory can distinguish absence from an
        // existing unloaded thread, including one moved to another cwd.
        if (codexAppServerThreadIsMissing(error, conversationId) &&
            !await provider.nativeThreadExists(conversationId, { signal })) continue;
        throw error;
      }
      if (thread.id !== conversationId || thread.cwd !== binding.workdir ||
          !["idle", "notLoaded"].includes(thread.status?.type)) {
        throw new Error("Codex retirement requires an idle native family in the exact saved directory.");
      }
      if (thread.historyMode !== "paginated") {
        throw Object.assign(new Error("Codex native retirement requires paginated history. This unsupported conversation needs operator cleanup."),
          { code: `${errorPrefix}codex_paginated_history_required` });
      }
      const relative = path.isAbsolute(thread.path || "") && toolHomeSource
        ? path.relative(path.join(toolHomeSource, ".codex"), thread.path) : "";
      if (thread.path && (!/^(?:sessions|archived_sessions)\//u.test(relative) || !/\.jsonl(?:\.zst)?$/u.test(thread.path))) {
        throw new Error("Codex returned an unsafe or unknown rollout path.");
      }
      const files = [];
      const plainPath = thread.path?.replace(/\.zst$/u, "");
      for (const file of plainPath ? [plainPath, `${plainPath}.zst`] : []) {
        try {
          const info = await lstat(file);
          if (!info.isFile() || info.isSymbolicLink() || await realpath(file) !== path.resolve(file)) {
            throw new Error("Codex rollout is not a regular file at its exact native path.");
          }
          files.push({ path: file, inode: info.ino, size: info.size, modified: info.mtimeMs });
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      records.push({ conversationId, workdir: thread.cwd, historyMode: thread.historyMode, ...(files[0] || {}), files,
        nativePath: thread.path ?? null, status: thread.status.type,
        ...(Number.isFinite(thread.createdAt) ? { createdAt: new Date(thread.createdAt * 1000).toISOString() } : {}),
        ...(Number.isFinite(thread.updatedAt) ? { updatedAt: new Date(thread.updatedAt * 1000).toISOString() } : {}) });
    }
    return records;
  };
  return retireNativeConversation({ binding, inspect, beforeDelete,
    exportConversation: (id, onRecord) => provider.exportThreadHistory(id, onRecord, { signal }),
    remove: () => provider.deleteThread(binding.conversationId) });
}

// Native Codex0.159.1 keeps goals in its separate goals_1.sqlite store.
// Return its original SQL fields; the host owns stopped conversion eligibility,
// including rejecting active/blocked/limited goals and resolving SQLite home.
export async function readCodexNativeGoal(databasePath, { threadId, signal } = {}) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(threadId || "") ||
      path.basename(databasePath || "") !== "goals_1.sqlite") {
    throw new TypeError("Codex goal inspection requires its exact thread ID and supported goals_1.sqlite path.");
  }
  return readStoppedNativeDatabase(databasePath, database => {
    const columns = database.prepare("PRAGMA table_info(thread_goals)").all();
    const text = ["thread_id", "goal_id", "objective", "status"];
    const integers = ["token_budget", "tokens_used", "time_used_seconds", "created_at_ms", "updated_at_ms"];
    if (!columns.some(column => column.name === "thread_id" && column.pk === 1) ||
        text.some(name => !columns.some(column => column.name === name && column.type === "TEXT")) ||
        integers.some(name => !columns.some(column => column.name === name && column.type === "INTEGER"))) {
      throw new Error("Codex's saved native goal schema is unsupported; no history was changed.");
    }
    const rows = database.prepare(`SELECT thread_id, goal_id, objective, status, token_budget,
      tokens_used, time_used_seconds, created_at_ms, updated_at_ms
      FROM thread_goals WHERE thread_id = ? LIMIT 2`).all(threadId);
    if (!rows.length) return null;
    const row = rows[0];
    if (rows.length !== 1 || row.thread_id !== threadId ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(row.goal_id || "") ||
        typeof row.objective !== "string" ||
        !["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"].includes(row.status) ||
        row.token_budget !== null && (!Number.isSafeInteger(row.token_budget) || row.token_budget < 0) ||
        ["tokens_used", "time_used_seconds", "created_at_ms", "updated_at_ms"].some(key =>
          !Number.isSafeInteger(row[key]) || row[key] < 0)) {
      throw new Error("Codex's saved native goal is unsupported or ambiguous; no history was changed.");
    }
    return row;
  }, { signal });
}

export async function codexAppServerThreadHasReadableHistory(provider = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId || typeof provider?.readThread !== "function") {
    return false;
  }
  try {
    await provider.readThread(normalizedThreadId);
    return true;
  } catch (error) {
    if (codexAppServerRequestIsInvalid(error, "thread/read")) {
      return false;
    }
    throw error;
  }
}

// The caller has already checked the requested thread against its current
// conversation. History can confirm this exact authored input, never infer it
// from an assistant item or from a failed read.
export async function inspectCodexAppServerMessageAdmission({ provider, threadId, messageId } = {}) {
  try {
    const thread = await provider.readThread(threadId);
    const accepted = codexAppServerProviderThreadTurns(thread).find((turn) =>
      codexAppServerProviderTurnItems(turn).some((item) => item.type === "userMessage" &&
        codexAppServerProviderTurnClientIds({ items: [item] }).includes(messageId)));
    return { ok: true, admission: accepted ? "accepted" : "unknown", messageId, threadId,
      turnId: normalizeAgentText(accepted?.id) };
  } catch {
    return { ok: true, admission: "unknown", messageId, threadId };
  }
}

// Native result validation only. The caller owns any interruption, absence
// proof and durable cleanup receipt.
export async function deleteCodexAppServerThread({ provider, threadId } = {}) {
  const result = await provider.deleteThread(threadId);
  if (!isRecord(result)) {
    const error = new Error("Codex app-server returned an invalid thread deletion result.");
    error.code = "codex_helper_thread_delete_unconfirmed";
    throw error;
  }
  return result;
}

// The caller persists cleanup ownership before this operation and removes that
// receipt only after success. Native failure details remain local to that owner.
export async function deleteCodexAppServerHelperThread({ provider, threadId, turnId = "" } = {}) {
  let interruptError = null;
  if (turnId) {
    if (typeof provider?.interruptTurn === "function") {
      try {
        await provider.interruptTurn(threadId, turnId);
      } catch (error) {
        interruptError = error;
      }
    } else {
      interruptError = new Error("Codex provider cannot interrupt an active helper turn.");
    }
  }
  if (typeof provider?.deleteThread !== "function") {
    return { ok: false, error: new Error("Codex provider cannot delete a helper thread."), interruptError };
  }
  try {
    const result = await deleteCodexAppServerThread({ provider, threadId });
    return {
      deleted: true,
      interrupted: Boolean(turnId) && !interruptError,
      ok: true,
      result,
      status: "deleted",
      threadId,
      turnId,
      interruptError
    };
  } catch (error) {
    let absent = false;
    if (codexAppServerRequestIsInvalid(error, "thread/delete")) {
      try {
        absent = !await codexAppServerThreadHasReadableHistory(provider, threadId);
      } catch {
        absent = false;
      }
    }
    if (absent) {
      return {
        deleted: false,
        interrupted: Boolean(turnId) && !interruptError,
        ok: true,
        status: "notFound",
        threadId,
        turnId,
        interruptError
      };
    }
    return { ok: false, error, interruptError };
  }
}

export function codexApplicationToolConfiguration(tools) {
  const dynamicTools = (tools?.schemas || []).map(({ function: tool }) => ({
    type: "function", name: tool.name, description: tool.description, inputSchema: tool.parameters
  }));
  return { dynamicTools, toolSchemaIdentity: createHash("sha256").update(JSON.stringify(dynamicTools)).digest("hex") };
}

export function assertCodexApplicationToolSchemaIdentity(threadId, savedIdentity, toolSchemaIdentity) {
  if (threadId && (savedIdentity || codexApplicationToolConfiguration().toolSchemaIdentity) !== toolSchemaIdentity) {
    throw new Error("This Codex conversation was created with different application tool entry points. Start a new conversation to enable or remove application tools.");
  }
}

/** Retained thread selection keeps observation ahead of a resume that can start work. */
export async function ensureCodexAppServerThread({
  observeThread,
  provider,
  settings,
  projectHooks = false,
  identity,
  applicationTools,
  providerReady,
  workdir = "",
  onStage = () => {}
} = {}) {
  if (typeof observeThread !== "function") {
    throw new TypeError("Main Codex threads require an observer before they can resume.");
  }
  const normalizedWorkdir = normalizeAgentText(workdir);
  let stageStartedAt = Date.now();
  const availability = typeof provider.ensureAvailable === "function"
    ? await provider.ensureAvailable()
    : null;
  const appServerRuntime = availability?.runtime || await provider.ensureRuntime();
  onStage({ durationMs: Date.now() - stageStartedAt, stage: "runtime" });
  const existingThreadId = identity.read(normalizedWorkdir);
  const toolConfiguration = applicationTools ? codexApplicationToolConfiguration(applicationTools) : null;
  if (toolConfiguration) {
    if (typeof identity.readToolSchemaIdentity !== "function") throw new TypeError("Bound Codex application tools require the original schema identity reader and writer.");
    assertCodexApplicationToolSchemaIdentity(existingThreadId, await identity.readToolSchemaIdentity(normalizedWorkdir), toolConfiguration.toolSchemaIdentity);
  }
  let config = null;
  if (projectHooks) {
    stageStartedAt = Date.now();
    config = await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir);
    onStage({ durationMs: Date.now() - stageStartedAt, stage: "hook-config" });
  }
  let { threadSettings, threadStartSettings } = await settings(normalizedWorkdir, config);
  if (toolConfiguration) {
    threadSettings = { ...threadSettings, dynamicTools: toolConfiguration.dynamicTools };
    threadStartSettings = { ...threadStartSettings, dynamicTools: toolConfiguration.dynamicTools };
  }
  if (providerReady) await providerReady({ provider, threadId: existingThreadId });
  let thread = null;
  stageStartedAt = Date.now();
  if (existingThreadId) {
    if (identity.pauseGoal) {
      const { goal } = await provider.readGoal(existingThreadId);
      if (goal?.status === "active") await provider.setGoalStatus(existingThreadId, "paused");
    }
    // Resuming can immediately start an active goal before the RPC returns.
    await observeThread(existingThreadId);
    thread = await provider.resumeThread(existingThreadId, threadSettings);
    if (identity.pauseGoal) {
      await identity.clearPause();
    }
  } else {
    thread = await provider.startThread(threadStartSettings);
  }
  onStage({ durationMs: Date.now() - stageStartedAt, stage: existingThreadId ? "resume" : "start" });
  const threadId = normalizeAgentText(thread.id || existingThreadId);
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  stageStartedAt = Date.now();
  const recorded = await identity.write({ appServerRuntime, threadId, workdir: normalizedWorkdir,
    ...(toolConfiguration ? { toolSchemaIdentity: toolConfiguration.toolSchemaIdentity } : {}) });
  // The session no longer uses the runtime directory it recorded before (an
  // earlier sign-in's). Releasing it is cleanup: a failure keeps the directory.
  const superseded = normalizeAgentText(recorded?.supersededRuntimeDir);
  if (superseded) await releaseSupersededCodexRuntime(superseded).catch(() => null);
  if (providerReady) await providerReady({ provider, threadId });
  onStage({ durationMs: Date.now() - stageStartedAt, stage: "identity-metadata" });
  return {
    appServerRuntime,
    thread,
    threadId
  };
}

export function codexAppServerThreadRequestParams(params = {}, threadEnv = {}) {
  const source = isRecord(params) ? params : {};
  const config = isRecord(source.config) ? source.config : {};
  if (Object.hasOwn(config, "shell_environment_policy")) {
    return source;
  }
  return {
    ...source,
    config: {
      ...config,
      shell_environment_policy: {
        inherit: "none",
        set: normalizeCodexAppServerTerminalEnv(threadEnv)
      }
    }
  };
}

export function normalizeAgentThread(value = {}) {
  const thread = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeAgentText(thread.id || thread.threadId),
    provider: normalizeAgentText(thread.provider),
    raw: thread.raw || thread
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function startThread(provider, { hostContext, ...params } = {}) {
  params = await provider.conversationRuntime.prepareInstructions({ ...params, hostContext });
  delete params.hostContext;
  params = await provider.options.prepareThreadParams?.(params) || params;
  const client = await provider.activeClient();
  params = await provider.withHistoryAdapter(params, client);
  const environment = provider.options.prepareThreadEnvironment
    ? await provider.options.prepareThreadEnvironment(provider.options.threadEnv || {})
    : provider.options.threadEnv;
  const requestParams = provider.conversationRuntime.threadParameters(params, environment);
  if (params.ephemeral !== true) requestParams.historyMode = "paginated";
  const response = await provider.runRequest(
    () => client.request("thread/start", requestParams),
    "codex-app-server-thread-start"
  );
  if (hostContext) {
    await provider.options.bindThreadContext(response?.thread?.id, hostContext, params);
  }
  // Native ephemeral helpers have no stored history and report "legacy".
  // Paginated history is required only for persistent conversations.
  if (params.ephemeral !== true && response?.thread?.historyMode === "legacy") {
    throw Object.assign(new Error("Codex did not create the required paginated conversation history. Update Codex before starting a conversation."), {
      code: `${provider.errorPrefix}codex_history_unsupported`
    });
  }
  if (response?.thread?.historyMode === "paginated" && response.thread.ephemeral !== true) {
    const threadId = normalizeAgentText(response.thread.id);
    // A new paginated thread needs its metadata and empty rollout persisted
    // before it can be resumed. This initializes only the just-created,
    // empty thread; it never hydrates an existing conversation.
    await provider.runRequest(async () => {
      await client.request("thread/name/set", { threadId, name: threadId });
      await client.request("thread/read", { threadId, includeTurns: true });
    }, "codex-app-server-thread-initialize-history");
  }
  if (provider.options.prepareThreadEnvironment && response?.thread?.id) {
    provider.conversationRuntime.registerThread(response.thread.id, {
      client, executionId: normalizeAgentText(provider.runtime?.executionId),
      params: requestParams, managed: !Object.hasOwn(params.config || {}, "shell_environment_policy")
    });
  }
  return {
    ...normalizeAgentThread({
      id: response?.thread?.id,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      raw: response?.thread
    }),
    response
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function resumeThread(provider, threadId = "", { hostContext, ...params } = {}) {
  if (hostContext) await provider.options.bindThreadContext(threadId, hostContext, params);
  params = await provider.conversationRuntime.prepareInstructions({ ...params, hostContext }, threadId);
  delete params.hostContext;
  params = await provider.options.prepareThreadParams?.(params) || params;
  await provider.options.beforeResumeThread?.(threadId);
  const client = await provider.activeClient();
  let response;
  if (provider.options.prepareThreadEnvironment) {
    response = await provider.withThreadEnvironment(threadId, params, (requestParams, resumed) =>
      resumed || client.request("thread/resume", { excludeTurns: true, ...requestParams, threadId }));
  } else {
    params = await provider.withHistoryAdapter(params, client, { threadId });
    const requestParams = codexAppServerThreadRequestParams(params, provider.options.threadEnv);
    response = await provider.runRequest(
      () => client.request("thread/resume", {
        excludeTurns: true,
        ...requestParams,
        threadId: normalizeAgentText(threadId || requestParams.threadId)
      }),
      "codex-app-server-thread-resume"
    );
  }
  return {
    ...normalizeAgentThread({
      id: response?.thread?.id,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      raw: response?.thread
    }),
    response
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function withHistoryAdapter(provider, params, client, options = {}) {
  return prepareCodexHistory(params, client, { ...options,
    baseUrl: provider.runtime?.historyAdapterBaseUrl, modelProviderId: provider.options.modelProviderId });
}

/** @param {CodexAppServerAgentProvider} provider */
export async function withThreadEnvironment(provider, threadId, params, operation) {
  try {
    return await provider.conversationRuntime.withThreadContext(threadId, params, operation);
  } catch (error) {
    if (typeof error.code === "string" && error.code.startsWith("assistant_")) error.code = `${provider.errorPrefix}${error.code.slice(10)}`;
    throw error;
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function verifyThreadEnvironment(provider, threadId, environment, request, signal, { requiredKeys = [] } = {}) {
  const keys = Object.keys(environment).filter((key) => key.startsWith(provider.configuration.controlEnvironmentPrefix) || requiredKeys.includes(key)).sort();
  if (!keys.length) return;

  const marker = `${provider.configuration.controlProbePrefix}${randomUUID()}:`;
  const probe = { marker, pending: [], verified: false, turnId: "" };
  provider.threadControlProbes.set(threadId, probe);
  const expected = createHash("sha256").update(JSON.stringify(keys.map((key) => [key, environment[key]]))).digest("hex");
  // This bounded native shell check uses no model and prints only a digest,
  // never credentials or environment values.
  await request("thread/shellCommand", {
    threadId, command: codexControlProbeCommand(keys, marker), timeoutMs: 2000
  });
  while (true) {
    signal.throwIfAborted();
    // The native completion event owns this result; saved history is not a
    // second acknowledgement of this live control operation.
    if (probe.completed && probe.result) {
      if (probe.result.type !== "commandExecution" || probe.result.exitCode !== 0 ||
          probe.result.aggregatedOutput?.trim() !== `${marker}${expected}`) {
        throw Object.assign(new Error("Another native subscriber retained the previous assistant settings. Close the native assistant terminal and retry Resume."), {
          code: "assistant_agent_control_binding_retained"
        });
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function ensureThreadControls(provider, threadId) {
  if (!provider.options.prepareThreadEnvironment) return;
  return provider.withThreadEnvironment(threadId, {}, async (_params, resumed) => ({ ok: true, recovered: Boolean(resumed) }));
}

/** @param {CodexAppServerAgentProvider} provider */
export async function readGoal(provider, threadId = "", { signal } = {}) {
  const client = await provider.activeClient();
  const result = await provider.runRequest(
    () => client.request("thread/goal/get", { threadId: normalizeAgentText(threadId) }, { signal }),
    "codex-app-server-goal-read"
  );
  return { ...result, goal: provider.conversationRuntime.projectGoal(threadId, result.goal) };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function updateThreadSettings(provider, threadId, { model, effort } = {}, { signal } = {}) {
  if (!normalizeAgentText(threadId) || !normalizeAgentText(model)) {
    throw new TypeError("Codex settings require an existing thread and a model.");
  }
  const client = await provider.activeClient();
  threadId = normalizeAgentText(threadId);
  const requested = { model, effort, ...(effort ? { config: { model_reasoning_effort: effort } } : {}) };
  const params = await provider.options.prepareThreadParams?.(requested) || requested;
  const update = async selected => {
    const current = await provider.activeClient();
    const applied = Promise.withResolvers();
    // A successful RPC only queues the update. Observe its applied snapshot
    // before resuming a goal or accepting a dependent settings operation.
    const deadline = AbortSignal.any([AbortSignal.timeout(provider.options.requestTimeoutMs || 10_000), ...(signal ? [signal] : [])]);
    const abort = () => applied.reject(deadline.reason);
    const unsubscribe = current.subscribe(notification => {
      const settings = notification.params?.threadSettings;
      if (notification.method === "thread/settings/updated" && notification.params?.threadId === threadId &&
          settings?.model === selected.model && (!selected.effort || settings.effort === selected.effort)) applied.resolve();
    });
    provider.settingsWaiters.add(applied.reject);
    deadline.addEventListener("abort", abort, { once: true });
    void applied.promise.catch(() => {});
    try {
      deadline.throwIfAborted();
      const { thread } = await provider.runRequest(() => current.request("thread/read", {
        threadId, includeTurns: false
      }, { signal: deadline }), "codex-app-server-settings-read");
      // Native no-op updates may emit no settings event. A current snapshot
      // also confirms values already applied by the provider reload.
      if (thread?.model === selected.model && (!selected.effort || thread.reasoningEffort === selected.effort) &&
          (!selected.modelProvider || thread.modelProvider === selected.modelProvider)) return {};
      const result = await provider.runRequest(() => current.request("thread/settings/update", {
        threadId, model: selected.model, ...(selected.effort ? { effort: selected.effort } : {})
      }, { signal: deadline }), "codex-app-server-settings-update");
      await applied.promise;
      return result;
    } finally {
      unsubscribe();
      deadline.removeEventListener("abort", abort);
      provider.settingsWaiters.delete(applied.reject);
    }
  };
  if (params.modelProvider || provider.conversationRuntime.hasPendingSettings(threadId)) {
    const { thread } = await client.request("thread/read", { threadId, includeTurns: false }, { signal });
    if (params.modelProvider !== thread?.modelProvider || provider.conversationRuntime.hasPendingSettings(threadId)) {
      return provider.conversationRuntime.scheduleSettings(threadId, params, update);
    }
  }
  return update(params);
}

/** @param {CodexAppServerAgentProvider} provider */
export async function setGoal(provider, threadId, { objective, tokenBudget } = {}, { signal } = {}) {
  if (typeof objective !== "string" || !objective.trim() ||
      (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0))) {
    throw new TypeError("A Codex goal requires an objective and an optional positive token budget.");
  }
  provider.conversationRuntime.goalChanged(threadId);
  const operation = async () => {
    const client = await provider.activeClient();
    return client.request("thread/goal/set", {
      threadId: normalizeAgentText(threadId), objective: objective.trim(), status: "active",
      ...(tokenBudget === undefined ? {} : { tokenBudget })
    }, { signal });
  };
  return provider.options.prepareThreadEnvironment
    ? provider.withThreadEnvironment(threadId, {}, operation)
    : provider.runRequest(operation, "codex-app-server-goal-set");
}

/** @param {CodexAppServerAgentProvider} provider */
export async function setGoalStatus(provider, threadId = "", status = "", { signal } = {}) {
  if (!["active", "paused"].includes(status)) {
    throw new TypeError("Invalid Codex goal status.");
  }
  provider.conversationRuntime.goalChanged(threadId);
  const operation = async () => {
    const client = await provider.activeClient();
    return client.request("thread/goal/set", { threadId: normalizeAgentText(threadId), status }, { signal });
  };
  return status === "active" && provider.options.prepareThreadEnvironment
    ? provider.withThreadEnvironment(threadId, {}, operation)
    : provider.runRequest(operation, "codex-app-server-goal-status");
}

/** @param {CodexAppServerAgentProvider} provider */
export async function clearGoal(provider, threadId = "", { signal } = {}) {
  provider.conversationRuntime.goalChanged(threadId);
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("thread/goal/clear", { threadId: normalizeAgentText(threadId) }, { signal }),
    "codex-app-server-goal-clear"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function readThread(provider, threadId = "") {
  const client = await provider.activeClient();
  const response = await provider.runRequest(
    () => client.request("thread/read", {
      includeTurns: true,
      threadId: normalizeAgentText(threadId)
    }),
    "codex-app-server-thread-read"
  );
  return {
    ...normalizeAgentThread({
      id: response?.thread?.id || threadId,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      raw: response?.thread || response
    }),
    response
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function readThreadStatus(provider, threadId = "") {
  const client = await provider.activeClient();
  const response = await provider.runRequest(
    () => client.request("thread/read", {
      includeTurns: false,
      threadId: normalizeAgentText(threadId)
    }),
    "codex-app-server-thread-status"
  );
  return {
    ...normalizeAgentThread({
      id: response?.thread?.id || threadId,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      raw: response?.thread || response
    }),
    response
  };
}

/** @param {CodexAppServerAgentProvider} provider */
export async function listThreadTurns(provider, threadId = "", params = {}) {
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("thread/turns/list", {
      ...params,
      threadId: normalizeAgentText(threadId || params.threadId)
    }),
    "codex-app-server-thread-turns-list"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function exportThreadHistory(provider, threadId, onRecord, { signal } = {}) {
  const active = await provider.activeClient();
  // Oversized native items must fail preservation without disconnecting the
  // shared conversation observer. Reuse JSKIT's transport on a separate socket.
  const client = new CodexAppServerJsonRpcClient({
    endpoint: active.endpoint,
    maxMessageBytes: 64 * 1024 ** 2,
    requestTimeoutMs: 30_000,
    WebSocketImpl: provider.options.WebSocketImpl
  });
  const deadline = AbortSignal.timeout(300_000);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  boundedSignal.throwIfAborted();
  const abort = () => client.close();
  boundedSignal.addEventListener("abort", abort, { once: true });
  try {
    await client.connect();
    boundedSignal.throwIfAborted();
    await client.initialize({ clientInfo: provider.configuration.historyClientInfo });
    boundedSignal.throwIfAborted();
    return await exportCodexNativeHistory(client, normalizeAgentText(threadId), onRecord, { signal: boundedSignal, errorPrefix: provider.errorPrefix });
  } finally {
    boundedSignal.removeEventListener("abort", abort);
    client.close();
  }
}

/** @param {CodexAppServerAgentProvider} provider */
export async function unsubscribeThread(provider, threadId = "") {
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("thread/unsubscribe", {
      threadId: normalizeAgentText(threadId)
    }),
    "codex-app-server-thread-unsubscribe"
  );
}

/** @param {CodexAppServerAgentProvider} provider */
export async function deleteThread(provider, threadId = "") {
  const client = await provider.activeClient();
  return provider.runRequest(
    () => client.request("thread/delete", {
      threadId: normalizeAgentText(threadId)
    }),
    "codex-app-server-thread-delete"
  );
}
