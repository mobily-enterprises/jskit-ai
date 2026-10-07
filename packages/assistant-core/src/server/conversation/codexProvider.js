import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { CodexAppServerJsonRpcClient } from "./codexClient.js";
import {
  createCodexAccountReader, codexAuthOutputRequiresReconnect, codexAppServerProjectHookTrustConfig,
  codexAppServerTextHasControlCharacters, CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH
} from "./codexConfiguration.js";
import {
  CODEX_APP_SERVER_PROCESS_STATE, CODEX_APP_SERVER_TRANSPORT,
  assertExistingDirectory, codexAppServerCommandBaseEnv, codexAppServerCredentialHome,
  codexAppServerExecutionMode, codexAppServerHelperWorkspaceDir, codexAppServerIsHelper,
  codexAppServerProcessCwd, codexAppServerRuntimeIdentity, codexAppServerTerminalEnvHash,
  ensureWritablePrivateDirectory, normalizeCodexAppServerTerminalEnv, tailTextFile
} from "./codexProcess.js";
import { prepareCodexHistory } from "./codexHistoryAdapter.js";
import { createCodexConversationAdapter } from "./providers/codex.js";
import { exportCodexNativeHistory } from "./codexNativeHistoryExport.js";
import { retireNativeConversation } from "./nativeHistoryExport.js";
import { isPlainObject, normalizeText as normalizeAgentText } from "./normalize.js";
import {
  codexAppServerProviderThreadTurns,
  codexAppServerProviderTurnItems,
  codexAppServerProviderTurnClientIds,
  codexAppServerThreadRawValue
} from "./codexEvents.js";

const CODEX_APP_SERVER_PROVIDER_ID = "codex_app_server";
const CODEX_APP_SERVER_EXECUTION_MODES = Object.freeze({ HELPER: "helper", INTERACTIVE: "interactive" });
const codexAppServerHelperAuthError = createCodexAccountReader().error;

const CODEX_APP_SERVER_INVALID_REQUEST_CODE = -32600;
const CODEX_RENEWAL_UNMATERIALIZED_THREAD_SUFFIX =
  "is not materialized yet; includeTurns is unavailable before first user message";
const CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT = 100;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES = 100;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRIES = 1000;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRY_BYTES = 32 * 1024;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH = 512;
const CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT = 100;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_PAGES = 100;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT = 1000;
const CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH = 512;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_ENTRY_BYTES = 64 * 1024;
const CODEX_APP_SERVER_THREAD_INVENTORY_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const CODEX_APP_SERVER_HELPER_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const CODEX_APP_SERVER_SERVER_INFO_USER_AGENT_MAX_LENGTH = 512;
const CODEX_AUTH_PREFLIGHT_TIMEOUT_MS = 15000;
const CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES = 4096;
const CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD = "account/chatgptAuthTokens/refresh";
const CODEX_NATIVE_STORAGE_SOURCE_KINDS = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview",
  "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function codexAppServerRequestIsInvalid(error = null, method = "") {
  const expectedMethod = normalizeAgentText(method);
  const actualMethod = normalizeAgentText(error?.method);
  return Number(error?.code) === CODEX_APP_SERVER_INVALID_REQUEST_CODE &&
    (!expectedMethod || !actualMethod || actualMethod === expectedMethod);
}

function codexAppServerThreadIsMissing(error = null, threadId = "") {
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

async function retireCodexConversationHistory(provider, binding, {
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

async function codexAppServerThreadHasReadableHistory(provider = null, threadId = "") {
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
async function inspectCodexAppServerMessageAdmission({ provider, threadId, messageId } = {}) {
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
async function deleteCodexAppServerThread({ provider, threadId } = {}) {
  const result = await provider.deleteThread(threadId);
  if (!isPlainObject(result)) {
    const error = new Error("Codex app-server returned an invalid thread deletion result.");
    error.code = "codex_helper_thread_delete_unconfirmed";
    throw error;
  }
  return result;
}

// The caller persists cleanup ownership before this operation and removes that
// receipt only after success. Native failure details remain local to that owner.
async function deleteCodexAppServerHelperThread({ provider, threadId, turnId = "" } = {}) {
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

/** Retained thread selection keeps observation ahead of a resume that can start work. */
async function ensureCodexAppServerThread({
  observeThread,
  provider,
  settings,
  projectHooks = false,
  identity,
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
  let config = null;
  if (projectHooks) {
    stageStartedAt = Date.now();
    config = await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir);
    onStage({ durationMs: Date.now() - stageStartedAt, stage: "hook-config" });
  }
  const { threadSettings, threadStartSettings } = await settings(normalizedWorkdir, config);
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
  await identity.write({ appServerRuntime, threadId, workdir: normalizedWorkdir });
  onStage({ durationMs: Date.now() - stageStartedAt, stage: "identity-metadata" });
  return {
    appServerRuntime,
    thread,
    threadId
  };
}

function defineCodexRenewalThreadIds(value = [], {
  errorCode = "codex_renewal_fresh_thread_required"
} = {}) {
  if (
    !Array.isArray(value) ||
    value.length > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The successor assistant thread inventory is invalid."
    );
  }
  const threadIds = value.map((threadId) => normalizeAgentText(threadId));
  if (
    threadIds.some((threadId) => (
      !threadId ||
      threadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH ||
      codexAppServerTextHasControlCharacters(threadId)
    )) ||
    new Set(threadIds).size !== threadIds.length
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The successor assistant thread inventory contains an invalid identity."
    );
  }
  return Object.freeze([...threadIds].sort());
}

async function listCodexRenewalThreadIds(provider, workdir, errorCode) {
  if (typeof provider?.listAppServerThreadsForCwd !== "function") {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider cannot inventory the successor's exact session threads."
    );
  }
  const normalizedWorkdir = normalizeAgentText(workdir);
  const inventory = await provider.listAppServerThreadsForCwd({
    cwd: normalizedWorkdir
  });
  if (normalizeAgentText(inventory?.cwd) !== normalizedWorkdir) {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider returned a thread inventory for a different session source."
    );
  }
  return defineCodexRenewalThreadIds(inventory?.threadIds, { errorCode });
}

function assertCodexRenewalThreadSnapshot(threadSnapshot = null, {
  threadId = "",
  workdir = "",
  errorCode
} = {}) {
  const expectedThreadId = normalizeAgentText(threadId);
  const expectedWorkdir = normalizeAgentText(workdir);
  const actualThreadId = codexAppServerThreadResponseId(threadSnapshot);
  const actualWorkdir = normalizeAgentText(
    threadSnapshot?.cwd ||
    threadSnapshot?.raw?.cwd ||
    threadSnapshot?.response?.thread?.cwd
  );
  if (actualThreadId !== expectedThreadId || actualWorkdir !== expectedWorkdir) {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider could not verify the exact successor thread and session source.",
      {
        actualThreadId,
        actualWorkdir,
        expectedThreadId,
        expectedWorkdir
      }
    );
  }
  return threadSnapshot;
}

function codexRenewalThreadNeedsStatusRead(error = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  return Boolean(
    normalizedThreadId &&
    (
      (
        codexAppServerRequestIsInvalid(error, "thread/read") &&
        normalizeAgentText(error?.message) ===
          `thread ${normalizedThreadId} ${CODEX_RENEWAL_UNMATERIALIZED_THREAD_SUFFIX}`
      ) ||
      (
        Number(error?.code) === -32601 &&
        normalizeAgentText(error?.method) === "thread/read"
      )
    )
  );
}

async function readCodexRenewalSuccessorThreadSnapshot({
  provider,
  threadId = "",
  workdir = "",
  errorCode
} = {}) {
  try {
    return assertCodexRenewalThreadSnapshot(
      await provider.readThread(threadId),
      { threadId, workdir, errorCode }
    );
  } catch (error) {
    if (
      !codexRenewalThreadNeedsStatusRead(error, threadId) ||
      typeof provider?.readThreadStatus !== "function"
    ) {
      throw error;
    }
    return assertCodexRenewalThreadSnapshot(
      await provider.readThreadStatus(threadId),
      { threadId, workdir, errorCode }
    );
  }
}

function codexRenewalThreadError(code, message, details = {}, {
  retryable = false
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = {
    ...details,
    retryable
  };
  error.retryable = retryable;
  return error;
}

function codexAppServerThreadResponseId(thread = null, fallback = "") {
  return normalizeAgentText(
    thread?.id ||
    thread?.response?.thread?.id ||
    fallback
  );
}

/** Resume only the supplied retained thread; native read failures never replace it. */
async function resumeExactCodexAppServerThread({
  expectedThreadId = "",
  provider,
  settings,
  projectHooks = false,
  workdir = "",
  errorCode = "codex_renewal_thread_unreadable"
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir);
  const normalizedExpectedThreadId = normalizeAgentText(expectedThreadId);
  if (
    typeof provider?.ensureRuntime !== "function" ||
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.readThread !== "function"
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The old assistant provider cannot read its exact main thread.",
      { expectedThreadId: normalizedExpectedThreadId }
    );
  }
  const appServerRuntime = await provider.ensureRuntime();
  const config = projectHooks
    ? await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir)
    : null;
  const { threadSettings } = await settings(normalizedWorkdir, config);
  let thread = null;
  let threadSnapshot = null;
  try {
    thread = await provider.resumeThread(normalizedExpectedThreadId, threadSettings);
    const resumedThreadId = codexAppServerThreadResponseId(thread, normalizedExpectedThreadId);
    if (resumedThreadId !== normalizedExpectedThreadId) {
      throw codexRenewalThreadError(
        errorCode,
        "The old assistant provider resumed a different thread.",
        {
          expectedThreadId: normalizedExpectedThreadId,
          resumedThreadId
        }
      );
    }
    threadSnapshot = await provider.readThread(normalizedExpectedThreadId);
  } catch (error) {
    if (
      error?.code === errorCode ||
      codexAppServerRequestIsInvalid(error, "thread/resume") ||
      codexAppServerRequestIsInvalid(error, "thread/read")
    ) {
      if (error?.code === errorCode) {
        throw error;
      }
      throw codexRenewalThreadError(
        errorCode,
        "The old assistant thread cannot be read. Write or edit the handover manually instead.",
        {
          expectedThreadId: normalizedExpectedThreadId,
          providerError: normalizeAgentText(error?.message)
        }
      );
    }
    throw error;
  }
  return Object.freeze({
    appServerRuntime,
    thread,
    threadId: normalizedExpectedThreadId,
    threadSnapshot,
    threadSettings
  });
}

/** Preserve the original baseline → create/adopt → durable identity → first-read order. */
async function startFreshCodexAppServerThread({
  provider,
  settings,
  projectHooks = false,
  identity,
  resumableThreadId = "",
  forbiddenThreadId = "",
  operationId = "",
  workdir = "",
  errorCode = "codex_renewal_fresh_thread_required",
  applicationName = "The application"
} = {}) {
  const normalizedWorkdir = normalizeAgentText(workdir);
  const normalizedForbiddenThreadId = normalizeAgentText(forbiddenThreadId);
  const normalizedOperationId = normalizeAgentText(operationId);
  if (resumableThreadId && resumableThreadId === normalizedForbiddenThreadId) {
    throw codexRenewalThreadError(
      errorCode,
      "The renewed session cannot reuse the old session's assistant thread.",
      { forbiddenThreadId: normalizedForbiddenThreadId }
    );
  }
  if (
    typeof provider?.ensureRuntime !== "function" ||
    typeof provider?.resumeThread !== "function" ||
    typeof provider?.readThread !== "function" ||
    typeof provider?.startThread !== "function"
  ) {
    throw codexRenewalThreadError(
      errorCode,
      "The assistant provider cannot prove a genuinely fresh renewal thread."
    );
  }
  const appServerRuntime = await provider.ensureRuntime();
  const config = projectHooks
    ? await codexAppServerProjectHookTrustConfig(provider, normalizedWorkdir)
    : null;
  const { threadSettings, threadStartSettings } = await settings(normalizedWorkdir, config);
  let fresh = false;
  let thread = null;
  let threadSnapshot = null;
  let baselineThreadIds = Object.freeze([]);
  if (resumableThreadId) {
    try {
      thread = await provider.resumeThread(resumableThreadId, threadSettings);
      const resumedThreadId = codexAppServerThreadResponseId(thread, resumableThreadId);
      if (resumedThreadId !== resumableThreadId) {
        throw codexRenewalThreadError(
          errorCode,
          "The assistant provider resumed a different renewal thread.",
          {
            expectedThreadId: resumableThreadId,
            resumedThreadId
          }
        );
      }
      threadSnapshot = await readCodexRenewalSuccessorThreadSnapshot({
        provider,
        threadId: resumableThreadId,
        workdir: normalizedWorkdir,
        errorCode
      });
    } catch (error) {
      if (
        error?.code === errorCode ||
        codexAppServerRequestIsInvalid(error, "thread/resume") ||
        codexAppServerRequestIsInvalid(error, "thread/read")
      ) {
        if (error?.code === errorCode) {
          throw error;
        }
        throw codexRenewalThreadError(
          errorCode,
          `The previously started renewal thread is no longer readable; ${applicationName} will not replace it silently.`,
          {
            expectedThreadId: resumableThreadId,
            providerError: normalizeAgentText(error?.message)
          }
        );
      }
      throw error;
    }
  } else {
    if (!normalizedOperationId) {
      throw codexRenewalThreadError(
        errorCode,
        "Starting a fresh successor thread requires its exact renewal operation id."
      );
    }
    baselineThreadIds = await identity.readBaseline();
    if (!baselineThreadIds) {
      baselineThreadIds = await listCodexRenewalThreadIds(
        provider,
        normalizedWorkdir,
        errorCode
      );
      await identity.writeBaseline(baselineThreadIds);
    }
    const currentThreadIds = await listCodexRenewalThreadIds(
      provider,
      normalizedWorkdir,
      errorCode
    );
    const baseline = new Set(baselineThreadIds);
    const candidateThreadIds = currentThreadIds.filter((threadId) => !baseline.has(threadId));
    if (candidateThreadIds.length > 1) {
      throw codexRenewalThreadError(
        errorCode,
        `More than one unclaimed assistant thread appeared for this renewal; ${applicationName} will not guess which one is authoritative.`,
        { candidateThreadIds }
      );
    }
    if (candidateThreadIds.length === 1) {
      const [candidateThreadId] = candidateThreadIds;
      thread = await provider.resumeThread(candidateThreadId, threadSettings);
      const resumedThreadId = codexAppServerThreadResponseId(thread, candidateThreadId);
      if (resumedThreadId !== candidateThreadId) {
        throw codexRenewalThreadError(
          errorCode,
          "The assistant provider resumed a different recovered renewal thread.",
          {
            expectedThreadId: candidateThreadId,
            resumedThreadId
          }
        );
      }
      threadSnapshot = await readCodexRenewalSuccessorThreadSnapshot({
        provider,
        threadId: candidateThreadId,
        workdir: normalizedWorkdir,
        errorCode
      });
    } else {
      thread = await provider.startThread(threadStartSettings);
      fresh = true;
    }
  }
  const threadId = codexAppServerThreadResponseId(thread, resumableThreadId);
  if (
    !threadId ||
    threadId === normalizedForbiddenThreadId ||
    (fresh && baselineThreadIds.includes(threadId))
  ) {
    throw codexRenewalThreadError(
      errorCode,
      threadId
        ? "The assistant provider reused the old session's thread instead of starting a fresh one."
        : "The assistant provider did not return a fresh renewal thread id.",
      {
        forbiddenThreadId: normalizedForbiddenThreadId,
        threadId
      }
    );
  }
  await identity.write({ appServerRuntime, threadId, workdir: normalizedWorkdir });
  if (fresh) {
    try {
      threadSnapshot = await readCodexRenewalSuccessorThreadSnapshot({
        provider,
        threadId,
        workdir: normalizedWorkdir,
        errorCode
      });
    } catch (error) {
      throw codexRenewalThreadError(
        errorCode,
        `The newly started renewal thread cannot be read; ${applicationName} will not replace it silently.`,
        {
          providerError: normalizeAgentText(error?.message),
          threadId
        },
        { retryable: true }
      );
    }
  }
  return Object.freeze({
    appServerRuntime,
    fresh,
    thread,
    threadId,
    threadSnapshot,
    threadStartSettings,
    threadSettings
  });
}

function codexAppServerModelCatalogError(message = "", errorPrefix = "") {
  const error = new Error(normalizeAgentText(message) || "Codex returned an invalid model catalog.");
  error.code = `${errorPrefix}codex_model_catalog_invalid`;
  return error;
}

function codexAppServerProviderConnectionGeneration(provider = null) {
  const generation = typeof provider?.currentConnectionGeneration === "function"
    ? provider.currentConnectionGeneration()
    : typeof provider?.connectionGeneration === "function"
      ? provider.connectionGeneration()
      : provider?.connectionGeneration;
  return normalizeAgentText(generation || "");
}

function codexAppServerModelCatalogSnapshot(value = null, errorPrefix = "") {
  if (!Array.isArray(value?.data)) {
    throw codexAppServerModelCatalogError("Codex did not return a usable live model catalog.", errorPrefix);
  }
  return Object.freeze({
    data: Object.freeze(value.data.map((model = {}) => Object.freeze({
      hidden: model.hidden === true,
      model: normalizeAgentText(model.model || ""),
      supportedReasoningEfforts: Object.freeze((Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts
        : []).map((option = {}) => Object.freeze({
        reasoningEffort: normalizeAgentText(option.reasoningEffort || "")
      })))
    })))
  });
}

function createCodexAppServerModelCatalogCache({
  cacheMs = 30_000,
  errorPrefix = ""
} = {}) {
  const codexAppServerModelCatalogs = new WeakMap();
  return async function readCodexAppServerModelCatalog(provider, { signal = null } = {}) {
    if (typeof provider.listModels !== "function") {
      const error = new Error("Codex live model discovery is unavailable.");
      error.code = `${errorPrefix}codex_model_catalog_unavailable`;
      throw error;
    }
    const connectionGeneration = codexAppServerProviderConnectionGeneration(provider);
    const now = Date.now();
    const cached = codexAppServerModelCatalogs.get(provider);
    if (
      cached?.connectionGeneration === connectionGeneration &&
      cached.value &&
      cached.expiresAt > now
    ) {
      return cached.value;
    }
    if (
      cached?.connectionGeneration === connectionGeneration &&
      cached.pending
    ) {
      return cached.pending;
    }

    const pending = provider.listModels({
      includeHidden: false,
      limit: 100
    }, { signal }).then((result) => {
      if (codexAppServerProviderConnectionGeneration(provider) !== connectionGeneration) {
        const error = new Error("Codex reconnected while resolving the helper model catalog.");
        error.code = `${errorPrefix}codex_model_catalog_stale`;
        throw error;
      }
      return codexAppServerModelCatalogSnapshot(result, errorPrefix);
    });
    codexAppServerModelCatalogs.set(provider, {
      connectionGeneration,
      expiresAt: 0,
      pending,
      value: null
    });
    try {
      const value = await pending;
      codexAppServerModelCatalogs.set(provider, {
        connectionGeneration,
        expiresAt: Date.now() + cacheMs,
        pending: null,
        value
      });
      return value;
    } catch (error) {
      if (codexAppServerModelCatalogs.get(provider)?.pending === pending) {
        codexAppServerModelCatalogs.delete(provider);
      }
      throw error;
    }
  };
}

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

function codexAppServerHelperRequestError(error = null, reason = "", errorPrefix = "") {
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

function normalizeCodexAppServerInfo(initializeResult = null) {
  if (!isPlainObject(initializeResult)) {
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

function tailAppend(text = "", chunk = "", maxBytes = CODEX_AUTH_PREFLIGHT_OUTPUT_TAIL_BYTES) {
  const next = `${String(text || "")}${String(chunk || "")}`;
  return next.length > maxBytes ? next.slice(-maxBytes) : next;
}

function codexAuthPreflightArgs() {
  return [
    "-c",
    "check_for_update_on_startup=false",
    "debug",
    "models"
  ];
}

async function runCodexAuthPreflight({
  codexCommand = "codex",
  env = process.env,
  executionRoot = "",
  runtimeDir = "",
  terminalEnv = {},
  timeoutMs = CODEX_AUTH_PREFLIGHT_TIMEOUT_MS,
  toolHomeSource = "",
  workdir = ""
} = {}, execution) {
  const normalizedToolHomeSource = normalizeAgentText(toolHomeSource);
  if (normalizedToolHomeSource) {
    await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
  }
  const normalizedRuntimeDir = normalizeAgentText(runtimeDir);
  if (normalizedRuntimeDir) {
    await ensureWritablePrivateDirectory(path.resolve(normalizedRuntimeDir));
  }
  const baseEnv = codexAppServerCommandBaseEnv({
    env,
    terminalEnv
  });
  const processCwd = codexAppServerProcessCwd({
    executionRoot,
    runtimeDir,
    workdir
  });
  try {
    const result = await execution.run({
      args: codexAuthPreflightArgs(),
      baseEnv,
      command: codexCommand,
      credentialHome: codexAppServerCredentialHome(normalizedToolHomeSource, baseEnv),
      cwd: processCwd,
      inheritProcessEnv: false,
      mode: "capture",
      timeout: normalizePositiveInteger(timeoutMs, CODEX_AUTH_PREFLIGHT_TIMEOUT_MS)
    });
    return {
      code: result.exitCode,
      ok: result.ok === true,
      output: tailAppend("", result.output || [
        result.stderr,
        result.stdout
      ].filter(Boolean).join("\n")),
      signal: result.signal,
      timedOut: result.timedOut === true
    };
  } catch (error) {
    return {
      error,
      ok: false,
      output: normalizeAgentText(error?.message || error)
    };
  }
}

function codexAppServerEndpointForTarget(endpoint = "") {
  const normalizedEndpoint = normalizeAgentText(endpoint);
  if (!normalizedEndpoint) {
    return "";
  }
  return normalizedEndpoint;
}

function codexAppServerThreadRequestParams(params = {}, threadEnv = {}) {
  const source = isPlainObject(params) ? params : {};
  const config = isPlainObject(source.config) ? source.config : {};
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

function codexTextInput(text = "") {
  return {
    text: String(text ?? ""),
    text_elements: [],
    type: "text"
  };
}

function codexLocalImageInput(attachments = []) {
  return attachments
    .filter((attachment) => attachment.contentType?.startsWith("image/"))
    .map((attachment) => ({ type: "localImage", path: attachment.path }));
}

async function sendCodexAppServerPrompt({
  attachments = [],
  clientUserMessageId = "",
  outputSchema = null,
  provider,
  prompt = "",
  threadId = "",
  readOnly = false
} = {}, authorized = {}) {
  const authoredInput = String(prompt ?? "");
  const preparedInput = authorized.preparedInput;
  if (preparedInput === undefined && !authoredInput.trim()) {
    throw new Error("Codex app-server prompt is empty.");
  }
  const input = preparedInput === undefined ? [authoredInput, ...codexLocalImageInput(attachments)] : preparedInput;
  const turnSettings = {
    ...authorized.turnSettings,
    ...(readOnly
      ? {
          sandboxPolicy: {
            networkAccess: false,
            type: "readOnly"
          }
        }
      : {}),
    ...(normalizeAgentText(clientUserMessageId)
      ? { clientUserMessageId: normalizeAgentText(clientUserMessageId) }
      : {})
  };
  if (outputSchema && typeof outputSchema === "object" && !Array.isArray(outputSchema)) {
    turnSettings.outputSchema = outputSchema;
  }
  const turn = await provider.sendTurn(threadId, input, turnSettings);
  return {
    input,
    turn
  };
}

function codexTurnInput(input = []) {
  const values = Array.isArray(input) ? input : [input];
  return values.map((item) => {
    if (isPlainObject(item) && item.type === "localImage" && typeof item.path === "string") {
      return { type: "localImage", path: item.path };
    }
    if (isPlainObject(item) && item.type === "image" && typeof item.url === "string") {
      return { type: "image", url: item.url };
    }
    if (isPlainObject(item) && item.type === "text") {
      return codexTextInput(item.text);
    }
    return codexTextInput(item);
  });
}

function shellQuote(value = "") {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function codexControlProbeCommand(keys, marker) {
  const source = [
    "const {createHash}=require('node:crypto');",
    `const keys=${JSON.stringify(keys)};`,
    `process.stdout.write(${JSON.stringify(marker)}+createHash('sha256').update(JSON.stringify(keys.map(key=>[key,process.env[key]]))).digest('hex'))`
  ].join("");
  return `${shellQuote(process.execPath)} -e ${shellQuote(source)}`;
}

function codexCliResumeCommand({
  codexCommand = "",
  endpoint = "",
  threadId = ""
} = {}) {
  const normalizedEndpoint = codexAppServerEndpointForTarget(endpoint);
  const resolvedCodexCommand = normalizeAgentText(codexCommand) || "codex";
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedEndpoint) {
    throw new Error("Codex app-server endpoint is required for the native CLI command.");
  }
  if (!normalizedThreadId) {
    throw new Error("Codex thread id is required for the native CLI command.");
  }
  const argv = [
    resolvedCodexCommand,
    "-c",
    "check_for_update_on_startup=false",
    "--remote",
    normalizedEndpoint,
    "resume",
    normalizedThreadId
  ];
  return {
    argv,
    command: argv.map(shellQuote).join(" ")
  };
}

function codexAppServerThreadInventoryError(errorCode, label, detail) {
  const error = new Error(`Codex ${label} thread inventory ${detail}.`);
  error.code = errorCode;
  return error;
}

async function listBoundedCodexAppServerThreadIds({
  ancestorThreadId = "",
  archived = false,
  client,
  cwd = "",
  errorCode = "",
  label = "",
  requestLabel = "",
  runRequest,
  signal = null,
  sourceKinds = ["appServer"],
  state,
  verifyCwd = false
} = {}) {
  const seenCursors = new Set();
  let cursor = "";
  for (let page = 0; page < CODEX_APP_SERVER_THREAD_INVENTORY_MAX_PAGES; page += 1) {
    if (cursor && seenCursors.has(cursor)) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "repeated a pagination cursor"
      );
    }
    if (cursor) {
      seenCursors.add(cursor);
    }
    const response = await runRequest(
      () => client.request("thread/list", {
        archived,
        ...(cursor ? { cursor } : {}),
        ...(ancestorThreadId ? { ancestorThreadId } : cwd ? { cwd } : {}),
        limit: CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT,
        modelProviders: [],
        sourceKinds,
        useStateDbOnly: false
      }, { signal }),
      requestLabel
    );
    if (
      !Array.isArray(response?.data) ||
      response.data.length > CODEX_APP_SERVER_THREAD_INVENTORY_PAGE_LIMIT ||
      state.entryCount + response.data.length > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_COUNT
    ) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "exceeded its entry limit"
      );
    }
    for (const entry of response.data) {
      const threadId = normalizeAgentText(entry?.id);
      const threadCwd = normalizeAgentText(entry?.cwd);
      let entryBytes = 0;
      try {
        entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
      } catch {
        entryBytes = CODEX_APP_SERVER_THREAD_INVENTORY_MAX_ENTRY_BYTES + 1;
      }
      if (
        !isPlainObject(entry) ||
        !threadId ||
        threadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH ||
        codexAppServerTextHasControlCharacters(threadId) ||
        (verifyCwd && threadCwd !== cwd) ||
        entryBytes > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_ENTRY_BYTES ||
        state.totalBytes + entryBytes > CODEX_APP_SERVER_THREAD_INVENTORY_MAX_TOTAL_BYTES
      ) {
        throw codexAppServerThreadInventoryError(
          errorCode,
          label,
          "contained an invalid entry"
        );
      }
      state.entryCount += 1;
      state.totalBytes += entryBytes;
      state.threadIds.add(threadId);
    }
    const nextCursor = response.nextCursor === undefined || response.nextCursor === null || response.nextCursor === ""
      ? ""
      : typeof response.nextCursor === "string"
        ? response.nextCursor.trim()
        : null;
    if (
      nextCursor === null ||
      nextCursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH ||
      (nextCursor && seenCursors.has(nextCursor))
    ) {
      throw codexAppServerThreadInventoryError(
        errorCode,
        label,
        "returned an invalid pagination cursor"
      );
    }
    if (!nextCursor) {
      return state;
    }
    cursor = nextCursor;
  }
  throw codexAppServerThreadInventoryError(
    errorCode,
    label,
    "exceeded its page limit"
  );
}

function codexPlanUsage(limits = {}) {
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

function normalizeAgentThread(value = {}) {
  const thread = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeAgentText(thread.id || thread.threadId),
    provider: normalizeAgentText(thread.provider),
    raw: thread.raw || thread
  };
}

function normalizeAgentTurn(value = {}) {
  const turn = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeAgentText(turn.id || turn.turnId),
    provider: normalizeAgentText(turn.provider),
    raw: turn.raw || turn,
    status: normalizeAgentText(turn.status || turn.raw?.status)
  };
}

async function assertCodexAuthPreflightReady(options = {}, {
  reason = "codex-auth-preflight", execution, credentials
} = {}) {
  const result = await runCodexAuthPreflight(options, execution);
  if (result.ok && !codexAuthOutputRequiresReconnect(result.output)) {
    return result;
  }
  const observed = normalizeAgentText(result.output || result.error?.message || "Codex auth preflight failed.");
  if (codexAuthOutputRequiresReconnect(observed)) {
    await credentials.markInvalid( {
      reason
    });
    throw credentials.reconnectError({
      modelProviderId: "",
      observed
    });
  }
  throw new Error(observed || "Codex auth preflight failed.");
}

export class CodexAppServerAgentProvider {
  constructor(options = {}, host = {}) {
    this.host = host;
    this.credentials = host.credentials;
    this.configuration = {
      errorPrefix: "",
      clientInfo: { name: "jskit", title: "JSKIT", version: "0.1.0" },
      historyClientInfo: { name: "jskit-history-export", title: "JSKIT", version: "0.1.0" },
      controlEnvironmentPrefix: "JSKIT_",
      controlProbePrefix: "JSKIT_CONTROL_CHECK_",
      ...host.configuration
    };
    this.errorPrefix = this.configuration.errorPrefix;
    this.accountReader = createCodexAccountReader({ errorPrefix: this.errorPrefix, ...this.configuration.accountReader });
    this.modelCatalogError = (message) => codexAppServerModelCatalogError(message, this.errorPrefix);
    this.planUsage = null;
    this.planUsagePending = null;
    this.planUsageAuthGeneration = 0;
    this.availabilityPromise = null;
    this.options = options;
    this.client = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.notificationSubscribers = new Set();
    this.helperAuth = null;
    this.helperAuthBlocked = false;
    this.initializeResult = null;
    this.runtime = null;
    this.runtimeStopOwner = null;
    this.runtimePromise = null;
    this.serverRequestHandler = null;
    this.conversationRuntime = createCodexConversationAdapter({
      readInstructions: (params, threadId) => this.options.readInstructions?.(params, threadId),
      client: () => this.activeClient(),
      runtime: () => this.runtime,
      runRequest: (run, reason) => this.runRequest(run, reason),
      timeoutMs: options.threadControlTimeoutMs,
      environment: options.threadEnv,
      prepareEnvironment: (environment) => this.options.prepareThreadEnvironment(environment),
      prepareParameters: (params) => this.options.prepareThreadParams?.(params),
      prepareResume: (id, params, context) => this.options.prepareThreadResumeParams?.(id, params, context),
      beforeResume: (id) => this.options.beforeResumeThread?.(id),
      prepareHistory: (params, client, context) => this.withHistoryAdapter(params, client, context),
      threadParameters: codexAppServerThreadRequestParams,
      verifyEnvironment: (...args) => this.#verifyThreadEnvironment(...args),
      recordInterruption: (threadId, turnId) => {
        const key = JSON.stringify([threadId, turnId]);
        this.interruptedTurns.set(key, this.interruptedTurns.get(key) || "control_reconfiguration");
      },
      onRecoveryFailure: (id) => {
        const probe = this.threadControlProbes.get(id);
        if (probe && !probe.verified) {
          this.threadControlProbes.delete(id);
          for (const pending of probe.pending) this.publishNotification(pending);
        }
      },
      log: (event, fields, context) => host.log?.(event, fields, {
        ...context, connectionGeneration: this.connectionGeneration
      })
    });
    this.threadControlProbes = new Map();
    this.commandExecutions = new Map();
    this.interruptedTurns = new Map();
    this.commandStopFailure = null;
  }

  get threadEnvironments() { return this.conversationRuntime.threadEnvironments; }

  get threadEnvironmentTasks() { return this.conversationRuntime.threadEnvironmentTasks; }

  isHelperProvider() {
    return codexAppServerIsHelper(this.options);
  }

  async selectedHelperAuth() {
    if (!this.isHelperProvider()) {
      return null;
    }
    if (this.host.parameters.providerHome) {
      return { identitySignature: await this.credentials.identity(this.host.parameters) };
    }
    return this.accountReader.readSelected(this.options);
  }

  async assertHelperAccountIdentityCurrent() {
    if (!this.isHelperProvider() || !this.helperAuth) {
      return;
    }
    if (this.helperAuthBlocked) {
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed during helper work. Retry the task with the current account."
      );
    }
    const current = await this.selectedHelperAuth();
    if (current.identitySignature !== this.helperAuth.identitySignature) {
      this.helperAuthBlocked = true;
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed during helper work. Retry the task with the current account."
      );
    }
  }

  async authenticateHelperClient(client, runtime = {}) {
    if (!this.isHelperProvider()) {
      return null;
    }
    const auth = await this.selectedHelperAuth();
    if (
      !runtime.accountIdentitySignature ||
      auth.identitySignature !== runtime.accountIdentitySignature
    ) {
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed while helper execution was starting. Retry the task."
      );
    }
    this.helperAuth = auth;
    this.helperAuthBlocked = false;
    if (this.host.parameters.providerHome) return auth;
    try {
      const login = await client.request(
        "account/login/start",
        codexAppServerHelperLoginParams(auth, this.errorPrefix)
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
      this.helperAuth = null;
      this.helperAuthBlocked = true;
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_unavailable`,
        "Codex could not activate the selected account for isolated helper work. Reconnect Codex and retry."
      );
    }
  }

  async refreshHelperChatgptAuth(params = {}) {
    const currentAuth = this.helperAuth;
    const previousAccountId = params.previousAccountId;
    if (
      !this.isHelperProvider() ||
      currentAuth?.authMode !== "chatgpt" ||
      params.reason !== "unauthorized" ||
      typeof previousAccountId !== "string" ||
      previousAccountId.length === 0 ||
      previousAccountId.length > CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH ||
      previousAccountId !== currentAuth.accountId
    ) {
      this.helperAuthBlocked = true;
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_refresh_rejected`,
        "Codex helper authentication refresh was rejected. Reconnect Codex and retry."
      );
    }
    const refreshed = await this.selectedHelperAuth();
    if (
      refreshed.authMode !== "chatgpt" ||
      refreshed.identitySignature !== currentAuth.identitySignature
    ) {
      this.helperAuthBlocked = true;
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_changed`,
        "The selected Codex account changed during helper work. Retry the task with the current account."
      );
    }
    if (refreshed.secretSignature === currentAuth.secretSignature) {
      this.helperAuthBlocked = true;
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_auth_refresh_pending`,
        "The selected Codex account has not produced a newer access token yet. Reconnect Codex and retry."
      );
    }
    this.helperAuth = refreshed;
    return {
      accessToken: refreshed.accessToken,
      chatgptAccountId: refreshed.accountId,
      chatgptPlanType: refreshed.planType || null
    };
  }

  async handleServerRequest(request = {}) {
    if (
      this.isHelperProvider() &&
      request.method === CODEX_APP_SERVER_CHATGPT_REFRESH_METHOD
    ) {
      return this.refreshHelperChatgptAuth(request.params);
    }
    if (this.isHelperProvider()) {
      const error = new Error("Codex isolated helper execution does not accept server requests.");
      error.code = -32601;
      throw error;
    }
    if (typeof this.serverRequestHandler === "function") {
      return this.serverRequestHandler(request);
    }
    const error = new Error("Codex app-server request is not supported by this client.");
    error.code = -32601;
    throw error;
  }

  async ensureRuntime() {
    if (this.runtimePromise) {
      return this.runtimePromise;
    }
    const operation = this.prepareRuntime();
    this.runtimePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.runtimePromise === operation) {
        this.runtimePromise = null;
      }
    }
  }

  async prepareRuntime() {
    const previousRuntime = this.runtime;
    const nextRuntime = await this.host.runtime.ensure(this.host.parameters);
    if (this.options.modelProviderId) nextRuntime.modelProviderId = this.options.modelProviderId;
    if (
      this.client &&
      previousRuntime &&
      codexAppServerRuntimeIdentity(previousRuntime) !== codexAppServerRuntimeIdentity(nextRuntime)
    ) {
      this.client.close();
      this.client = null;
      this.initializeResult = null;
    }
    this.runtime = nextRuntime;
    this.runtimeStopOwner = nextRuntime;
    await this.assertRuntimeAuthReady("codex-app-server-runtime");
    return this.runtime;
  }

  async preflightAuth(reason = "codex-auth-preflight", modelProviderId = "") {
    if (await this.options.prepareAuth?.(modelProviderId) === "external") {
      await this.assertRuntimeAuthReady(reason);
      return;
    }
    if (this.options.modelProviderId && this.options.modelProviderId !== "openai") {
      await this.credentials.assertCurrent("");
      return;
    }
    await this.assertRuntimeAuthReady(reason);
    try {
      return await assertCodexAuthPreflightReady({ ...this.options, codexCommand: this.host.parameters.codexCommand }, {
        execution: this.host.execution, credentials: this.credentials, reason
      });
    } catch (error) {
      if (error?.code === this.credentials.reconnectRequiredCode && this.runtime?.runtimeDir) {
        await this.stopRuntimeAndRequireDrain(reason);
      }
      throw error;
    }
  }

  async assertRuntimeAuthReady(reason = "codex-app-server") {
    if (this.isHelperProvider()) {
      return;
    }
    const runtime = this.runtime || {};
    let generationError = null;
    try {
      await this.credentials.assertCurrent(runtime.authStateSignature);
    } catch (error) {
      generationError = error;
    }
    const logTail = await tailTextFile(runtime.logPath || "");
    const reconnectRequired = codexAuthOutputRequiresReconnect(logTail);
    if (!generationError && !reconnectRequired) {
      return;
    }
    await this.stopRuntimeAndRequireDrain(reason);
    if (reconnectRequired) {
      await this.markReconnectRequired({
        toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource,
        observed: logTail,
        reason
      });
      throw this.credentials.reconnectError({
        observed: logTail
      });
    }
    throw generationError;
  }

  async markReconnectRequired({ reason = "codex-app-server", observed = "", toolHomeSource } = {}) {
    await this.credentials.markInvalid({ reason, toolHomeSource });
    throw this.credentials.reconnectError({ modelProviderId: this.options.modelProviderId, observed });
  }

  async runRequest(operation, reason = "codex-app-server-request") {
    try {
      await this.assertHelperAccountIdentityCurrent();
      const result = await operation();
      await this.assertHelperAccountIdentityCurrent();
      await this.assertRuntimeAuthReady(reason);
      return result;
    } catch (error) {
      if (this.isHelperProvider()) {
        throw codexAppServerHelperRequestError(error, reason, this.errorPrefix);
      }
      const observed = [
        error?.message || "",
        error?.observed || "",
        await tailTextFile(this.runtime?.logPath || "")
      ].filter(Boolean).join("\n");
      if (codexAuthOutputRequiresReconnect(observed)) {
        const runtime = this.runtime || {};
        if (runtime.runtimeDir) {
          await this.stopRuntimeAndRequireDrain(reason);
        }
        await this.markReconnectRequired({
          toolHomeSource: runtime.toolHomeSource || this.options.toolHomeSource,
          observed,
          reason
        });
      }
      throw error;
    }
  }

  async stopRuntimeAndRequireDrain(reason = "codex-app-server-stop") {
    const result = await this.stopRuntime({
      preserveProcessExitProof: !this.isHelperProvider()
    });
    if (
      result?.processExitVerified === true ||
      result?.runtimeDirRemoved === true ||
      result?.stopped === true
    ) {
      return result;
    }
    const error = new Error("Codex app-server execution could not be proven empty.");
    error.code = this.isHelperProvider()
      ? `${this.errorPrefix}codex_helper_runtime_cleanup_required`
      : `${this.errorPrefix}codex_app_server_cleanup_required`;
    error.cleanupRequired = true;
    error.reason = normalizeAgentText(reason);
    error.retryable = false;
    throw error;
  }

  async connect() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.client?.isOpen?.() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const operation = this.openConnection();
    this.connectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.connectPromise === operation) {
        this.connectPromise = null;
      }
    }
  }

  async openConnection() {
    if (this.client?.isOpen?.() && this.runtime) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    const runtime = await this.ensureRuntime();
    if (this.client?.isOpen?.()) {
      return {
        initializeResult: null,
        reusedClient: true,
        runtime
      };
    }
    this.client?.close?.();
    this.client = null;
    this.initializeResult = null;
    const client = new CodexAppServerJsonRpcClient({
      endpoint: runtime.endpoint,
      onDisconnect: (error) => {
        if (this.client === client) this.failObservation(error);
      },
      ...(this.isHelperProvider()
        ? { maxMessageBytes: CODEX_APP_SERVER_HELPER_MAX_MESSAGE_BYTES }
        : {}),
      requestTimeoutMs: this.options.requestTimeoutMs,
      WebSocketImpl: this.options.WebSocketImpl
    });
    client.setRequestHandler((request) => this.handleServerRequest(request));
    let initializeResult = null;
    try {
      await client.connect();
      initializeResult = await this.runRequest(
        () => client.initialize({ clientInfo: this.configuration.clientInfo, ...this.options.initialize }),
        "codex-app-server-initialize"
      );
      await this.authenticateHelperClient(client, runtime);
    } catch (error) {
      client.close();
      if (!runtime.runtimeDir) {
        throw error;
      }
      const helper = this.isHelperProvider();
      const cleanup = await this.host.runtime.cleanupFailedStart(runtime.runtimeDir, {
        helper,
        executionId: runtime.executionId,
        pid: runtime.pid,
        processIdentity: runtime.processIdentity
      }, this.host.parameters);
      this.runtimeStopOwner = cleanup.processExitVerified === true
        ? {
          ...runtime,
          processExitVerifiedAt: new Date().toISOString(),
          processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
        }
        : runtime;
      this.runtime = null;
      if (helper) {
        this.helperAuth = null;
        this.helperAuthBlocked = true;
      }
      if (cleanup.cleanupFailed) {
        const failure = new Error(
          helper
            ? "Codex isolated helper runtime could not be retired after startup failed."
            : "Codex app-server runtime could not be retired after initialization failed.",
          { cause: error }
        );
        failure.code = helper
          ? `${this.errorPrefix}codex_helper_runtime_cleanup_required`
          : `${this.errorPrefix}codex_app_server_cleanup_required`;
        failure.cleanupRequired = true;
        failure.retryable = false;
        throw failure;
      }
      throw error;
    }
    this.client = client;
    this.planUsage = null;
    this.planUsagePending = null;
    client.subscribe((notification = {}) => {
      if (this.client !== client || this.observationFailure) return;
      if (notification.method === "account/updated") {
        this.planUsage = null;
        this.planUsageAuthGeneration += 1;
      }
      if (notification.method === "account/rateLimits/updated") {
        const limits = notification.params?.rateLimits;
        if (!limits?.limitId || limits.limitId === "codex") this.planUsage = codexPlanUsage(limits);
      }
      this.publishNotification(notification);
    });
    this.initializeResult = normalizeCodexAppServerInfo(initializeResult);
    this.connectionGeneration += 1;
    return {
      initializeResult: this.isHelperProvider() ? this.initializeResult : initializeResult,
      runtime
    };
  }

  currentConnectionGeneration() {
    return this.connectionGeneration;
  }

  publishNotification(notification) {
    const threadId = notification.params?.threadId;
    const turnId = notification.params?.turnId;
    const item = notification.params?.item;
    if (item?.type === "commandExecution" && item.processId && item.source === "unifiedExecStartup") {
      const key = JSON.stringify([threadId, turnId, item.id]);
      if (notification.method === "item/completed") {
        const command = this.commandExecutions.get(key);
        if (command) command.completed = true;
        this.commandExecutions.delete(key);
      } else if (notification.method === "item/started") {
        const command = this.commandExecutions.get(key) || {
          threadId, turnId, itemId: item.id, processId: item.processId, client: this.client
        };
        this.commandExecutions.set(key, command);
        // Native startup may finish after turn/interrupt has already returned.
        if (this.interruptedTurns.has(JSON.stringify([threadId, turnId]))) {
          void this.#stopCommand(command).catch(() => null);
        }
      }
    }
    const probe = this.threadControlProbes.get(threadId);
    const method = notification.method;
    if (probe && (/^(turn|item)\//u.test(method) || method === "thread/status/changed")) {
      const turnId = notification.params?.turnId || notification.params?.turn?.id;
      if (method === "turn/started" && probe.turnId && probe.turnId !== turnId) {
        this.threadControlProbes.delete(threadId);
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
            this.threadControlProbes.delete(threadId);
            for (const pending of probe.pending) this.publishNotification(pending);
          }
        }
        return;
      }
    }
    for (const subscriber of this.notificationSubscribers) {
      try {
        subscriber(notification);
      } catch (error) {
        this.failObservation(error);
      }
    }
  }

  currentServerInfo() {
    return this.initializeResult;
  }

  isControlProbeTurn(threadId, turnId) {
    const probe = this.threadControlProbes.get(threadId);
    return Boolean(turnId && probe?.verified && probe.turnId === turnId);
  }

  async currentRuntimeInfo() {
    const runtime = this.runtime || {};
    const executionMode = codexAppServerExecutionMode(this.options);
    const parameters = this.host.parameters;
    return Object.freeze({
      accountIdentitySignature: await this.credentials.identity(this.host.parameters, {
        includeInteractive: true
      }),
      authStateSignature: await this.credentials.generation(parameters),
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
        codexAppServerTerminalEnvHash(this.isHelperProvider() ? {} : this.options.terminalEnv),
      toolHomeSource: executionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
        ? ""
        : normalizeAgentText(this.options.toolHomeSource),
      transport: normalizeAgentText(runtime.transport) || CODEX_APP_SERVER_TRANSPORT.UNIX
    });
  }

  async currentHelperExecutionContext() {
    const runtime = await this.ensureRuntime();
    const cwd = normalizeAgentText(this.options.helperWorkdir)
      ? path.resolve(this.options.helperWorkdir)
      : codexAppServerHelperWorkspaceDir(runtime.runtimeDir);
    if (!runtime.runtimeDir) {
      throw this.accountReader.error(
        `${this.errorPrefix}codex_helper_runtime_invalid`,
        "Codex helper runtime isolation could not be verified."
      );
    }
    await ensureWritablePrivateDirectory(cwd);
    return Object.freeze({
      accountIdentitySignature: await this.credentials.identity(this.host.parameters, {
        includeInteractive: true
      }),
      cwd,
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.HELPER
    });
  }

  isAvailable() {
    return Boolean(this.client?.isOpen?.() && this.runtime);
  }

  async activeClient() {
    if (this.observationFailure) throw this.observationFailure;
    if (this.client?.isOpen?.()) {
      return this.client;
    }
    await this.connect();
    return this.client;
  }

  async ensureAvailable({ modelProviderId = "" } = {}) {
    if (this.observationFailure) throw this.observationFailure;
    if (this.isAvailable()) {
      return {
        client: this.client,
        ok: true,
        reusedClient: true,
        runtime: this.runtime
      };
    }
    if (this.availabilityPromise) {
      return this.availabilityPromise;
    }
    const operation = (async () => {
      if (!this.isHelperProvider()) {
        await this.preflightAuth("codex-app-server-ensure-available", modelProviderId);
      }
      const client = await this.activeClient();
      return {
        client,
        ok: true,
        runtime: this.runtime
      };
    })();
    this.availabilityPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.availabilityPromise === operation) {
        this.availabilityPromise = null;
      }
    }
  }

  async readPlanUsage() {
    const client = this.client;
    if (!client?.isOpen?.()) return { status: "unavailable", windows: [] };
    if (this.planUsage && Date.now() - this.planUsage.checkedAt < 60_000) return this.planUsage;
    if (this.planUsagePending) return this.planUsagePending;
    const previous = this.planUsage;
    const authGeneration = this.planUsageAuthGeneration;
    const signal = AbortSignal.timeout(10_000);
    const operation = (async () => {
      try {
        const account = await client.request("account/read", { refreshToken: false }, { signal });
        if (this.client !== client || this.planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
        if (account?.account?.type !== "chatgpt") {
          this.planUsage = { status: "unsupported", windows: [], checkedAt: Date.now() };
        } else {
          const result = await client.request("account/rateLimits/read", {}, { signal });
          if (this.client !== client || this.planUsageAuthGeneration !== authGeneration) return { status: "unavailable", windows: [] };
          // A live event received during the read is newer than this request.
          if (this.planUsage === previous) this.planUsage = codexPlanUsage(result.rateLimitsByLimitId?.codex || result.rateLimits);
        }
        return this.planUsage;
      } catch {
        return { status: "unavailable", windows: [] };
      }
    })();
    this.planUsagePending = operation;
    try { return await operation; }
    finally { if (this.planUsagePending === operation) this.planUsagePending = null; }
  }

  subscribe(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Codex app-server observer must be a function.");
    }
    // Observation belongs to this provider, not one replaceable socket.
    this.notificationSubscribers.add(callback);
    return () => this.notificationSubscribers.delete(callback);
  }

  failObservation(cause) {
    const message = cause?.code === `${this.errorPrefix}agent_control_recovery_failed`
      ? cause.message
      : "Codex observation failed. Work must be stopped before it can continue.";
    this.observationFailure ||= Object.assign(
      new Error(message, { cause }),
      { code: `${this.errorPrefix}codex_observation_lost` }
    );
    return this.options.onObservationLost?.(this.observationFailure);
  }

  async stopThreadForObservationLoss(threadId, turnId) {
    // Control uses only this existing socket. It must not spawn or resume work
    // to find out whether the work we lost sight of has stopped.
    const client = this.client;
    if (!client?.isOpen()) throw new Error("Codex control connection is unavailable.");
    if (this.commandStopFailure) throw this.commandStopFailure;
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
      await this.#interruptTurn(client, threadId, turnId, signal);
      if (await readStatus() !== "idle") throw new Error("Codex did not confirm that its turn stopped.");
    }
    return { goal };
  }

  setServerRequestHandler(callback) {
    const handler = typeof callback === "function" ? callback : null;
    this.serverRequestHandler = handler;
    this.client?.setRequestHandler?.((request) => this.handleServerRequest(request));
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
        this.client?.setRequestHandler?.((request) => this.handleServerRequest(request));
      }
    };
  }

  async startThread({ hostContext, ...params } = {}) {
    params = await this.conversationRuntime.prepareInstructions({ ...params, hostContext });
    delete params.hostContext;
    params = await this.options.prepareThreadParams?.(params) || params;
    const client = await this.activeClient();
    params = await this.withHistoryAdapter(params, client);
    const environment = this.options.prepareThreadEnvironment
      ? await this.options.prepareThreadEnvironment(this.options.threadEnv || {})
      : this.options.threadEnv;
    const requestParams = this.conversationRuntime.threadParameters(params, environment);
    if (params.ephemeral !== true) requestParams.historyMode = "paginated";
    const response = await this.runRequest(
      () => client.request("thread/start", requestParams),
      "codex-app-server-thread-start"
    );
    if (hostContext) {
      await this.options.bindThreadContext(response?.thread?.id, hostContext, params);
    }
    // Native ephemeral helpers have no stored history and report "legacy".
    // Paginated history is required only for persistent conversations.
    if (params.ephemeral !== true && response?.thread?.historyMode === "legacy") {
      throw Object.assign(new Error("Codex did not create the required paginated conversation history. Update Codex before starting a conversation."), {
        code: `${this.errorPrefix}codex_history_unsupported`
      });
    }
    if (response?.thread?.historyMode === "paginated" && response.thread.ephemeral !== true) {
      const threadId = normalizeAgentText(response.thread.id);
      // A new paginated thread needs its metadata and empty rollout persisted
      // before it can be resumed. This initializes only the just-created,
      // empty thread; it never hydrates an existing conversation.
      await this.runRequest(async () => {
        await client.request("thread/name/set", { threadId, name: threadId });
        await client.request("thread/read", { threadId, includeTurns: true });
      }, "codex-app-server-thread-initialize-history");
    }
    if (this.options.prepareThreadEnvironment && response?.thread?.id) {
      this.conversationRuntime.registerThread(response.thread.id, {
        client, executionId: normalizeAgentText(this.runtime?.executionId),
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

  async resumeThread(threadId = "", { hostContext, ...params } = {}) {
    if (hostContext) await this.options.bindThreadContext(threadId, hostContext, params);
    params = await this.conversationRuntime.prepareInstructions({ ...params, hostContext }, threadId);
    delete params.hostContext;
    params = await this.options.prepareThreadParams?.(params) || params;
    await this.options.beforeResumeThread?.(threadId);
    const client = await this.activeClient();
    let response;
    if (this.options.prepareThreadEnvironment) {
      response = await this.withThreadEnvironment(threadId, params, (requestParams, resumed) =>
        resumed || client.request("thread/resume", { excludeTurns: true, ...requestParams, threadId }));
    } else {
      params = await this.withHistoryAdapter(params, client, { threadId });
      const requestParams = codexAppServerThreadRequestParams(params, this.options.threadEnv);
      response = await this.runRequest(
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

  async withHistoryAdapter(params, client, options = {}) {
    return prepareCodexHistory(params, client, { ...options,
      baseUrl: this.runtime?.historyAdapterBaseUrl, modelProviderId: this.options.modelProviderId });
  }

  async withThreadEnvironment(threadId, params, operation) {
    try {
      return await this.conversationRuntime.withThreadContext(threadId, params, operation);
    } catch (error) {
      if (typeof error.code === "string" && error.code.startsWith("assistant_")) error.code = `${this.errorPrefix}${error.code.slice(10)}`;
      throw error;
    }
  }

  async #verifyThreadEnvironment(threadId, environment, request, signal, { requiredKeys = [] } = {}) {
    const keys = Object.keys(environment).filter((key) => key.startsWith(this.configuration.controlEnvironmentPrefix) || requiredKeys.includes(key)).sort();
    if (!keys.length) return;

    const marker = `${this.configuration.controlProbePrefix}${randomUUID()}:`;
    const probe = { marker, pending: [], verified: false, turnId: "" };
    this.threadControlProbes.set(threadId, probe);
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

  async ensureThreadControls(threadId) {
    if (!this.options.prepareThreadEnvironment) return;
    return this.withThreadEnvironment(threadId, {}, async (_params, resumed) => ({ ok: true, recovered: Boolean(resumed) }));
  }

  async readGoal(threadId = "", { signal } = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/goal/get", { threadId: normalizeAgentText(threadId) }, { signal }),
      "codex-app-server-goal-read"
    );
  }

  async setGoal(threadId, { objective, tokenBudget } = {}, { signal } = {}) {
    if (typeof objective !== "string" || !objective.trim() ||
        (tokenBudget !== undefined && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0))) {
      throw new TypeError("A Codex goal requires an objective and an optional positive token budget.");
    }
    this.conversationRuntime.goalChanged(threadId);
    const operation = async () => {
      const client = await this.activeClient();
      return client.request("thread/goal/set", {
        threadId: normalizeAgentText(threadId), objective: objective.trim(), status: "active",
        ...(tokenBudget === undefined ? {} : { tokenBudget })
      }, { signal });
    };
    return this.options.prepareThreadEnvironment
      ? this.withThreadEnvironment(threadId, {}, operation)
      : this.runRequest(operation, "codex-app-server-goal-set");
  }

  async setGoalStatus(threadId = "", status = "", { signal } = {}) {
    if (!["active", "paused"].includes(status)) {
      throw new TypeError("Invalid Codex goal status.");
    }
    this.conversationRuntime.goalChanged(threadId);
    const operation = async () => {
      const client = await this.activeClient();
      return client.request("thread/goal/set", { threadId: normalizeAgentText(threadId), status }, { signal });
    };
    return status === "active" && this.options.prepareThreadEnvironment
      ? this.withThreadEnvironment(threadId, {}, operation)
      : this.runRequest(operation, "codex-app-server-goal-status");
  }

  async clearGoal(threadId = "", { signal } = {}) {
    this.conversationRuntime.goalChanged(threadId);
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/goal/clear", { threadId: normalizeAgentText(threadId) }, { signal }),
      "codex-app-server-goal-clear"
    );
  }

  async readThread(threadId = "") {
    const client = await this.activeClient();
    const response = await this.runRequest(
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

  async readThreadStatus(threadId = "") {
    const client = await this.activeClient();
    const response = await this.runRequest(
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

  async listThreadTurns(threadId = "", params = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/turns/list", {
        ...params,
        threadId: normalizeAgentText(threadId || params.threadId)
      }),
      "codex-app-server-thread-turns-list"
    );
  }

  async exportThreadHistory(threadId, onRecord, { signal } = {}) {
    const active = await this.activeClient();
    // Oversized native items must fail preservation without disconnecting the
    // shared conversation observer. Reuse JSKIT's transport on a separate socket.
    const client = new CodexAppServerJsonRpcClient({
      endpoint: active.endpoint,
      maxMessageBytes: 64 * 1024 ** 2,
      requestTimeoutMs: 30_000,
      WebSocketImpl: this.options.WebSocketImpl
    });
    const deadline = AbortSignal.timeout(300_000);
    const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    boundedSignal.throwIfAborted();
    const abort = () => client.close();
    boundedSignal.addEventListener("abort", abort, { once: true });
    try {
      await client.connect();
      boundedSignal.throwIfAborted();
      await client.initialize({ clientInfo: this.configuration.historyClientInfo });
      boundedSignal.throwIfAborted();
      return await exportCodexNativeHistory(client, normalizeAgentText(threadId), onRecord, { signal: boundedSignal, errorPrefix: this.errorPrefix });
    } finally {
      boundedSignal.removeEventListener("abort", abort);
      client.close();
    }
  }

  async listLoadedThreads(params = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/loaded/list", params),
      "codex-app-server-thread-loaded-list"
    );
  }

  async listAppServerThreadsForCwd({
    cwd = "",
    signal = null
  } = {}) {
    const normalizedCwd = normalizeAgentText(cwd);
    if (!normalizedCwd || codexAppServerTextHasControlCharacters(normalizedCwd)) {
      const error = new Error("Codex session thread inventory requires an exact cwd.");
      error.code = `${this.errorPrefix}codex_session_thread_inventory_invalid`;
      throw error;
    }
    const client = await this.activeClient();
    const state = await listBoundedCodexAppServerThreadIds({
      archived: false,
      client,
      cwd: normalizedCwd,
      errorCode: `${this.errorPrefix}codex_session_thread_inventory_invalid`,
      label: "session",
      requestLabel: "codex-app-server-session-thread-list",
      runRequest: this.runRequest.bind(this),
      signal,
      state: {
        entryCount: 0,
        threadIds: new Set(),
        totalBytes: 0
      },
      verifyCwd: true
    });
    return Object.freeze({
      cwd: normalizedCwd,
      threadIds: Object.freeze([...state.threadIds].sort())
    });
  }

  // Native thread/delete cascades through all spawned descendants, including
  // archived and non-app-server threads. Never infer its scope from cwd alone.
  async listThreadDescendants(threadId) {
    const ancestorThreadId = normalizeAgentText(threadId);
    if (!ancestorThreadId || ancestorThreadId.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH ||
        codexAppServerTextHasControlCharacters(ancestorThreadId)) {
      throw new TypeError("Codex descendant inventory requires an exact thread id.");
    }
    const client = await this.activeClient();
    const state = { entryCount: 0, threadIds: new Set(), totalBytes: 0 };
    for (const archived of [false, true]) {
      await listBoundedCodexAppServerThreadIds({
        ancestorThreadId, archived, client, state,
        sourceKinds: CODEX_NATIVE_STORAGE_SOURCE_KINDS,
        errorCode: `${this.errorPrefix}codex_retirement_inventory_invalid`, label: "retirement",
        requestLabel: "codex-app-server-descendant-list", runRequest: this.runRequest.bind(this)
      });
    }
    return [...state.threadIds].sort();
  }

  async listNativeThreadsForCwd(cwd) {
    if (!path.isAbsolute(cwd || "") || codexAppServerTextHasControlCharacters(cwd)) throw new TypeError("Native inventory requires an exact absolute directory.");
    const client = await this.activeClient();
    const state = { entryCount: 0, threadIds: new Set(), totalBytes: 0 };
    for (const archived of [false, true]) {
      await listBoundedCodexAppServerThreadIds({ archived, client, cwd, state, verifyCwd: true,
        sourceKinds: CODEX_NATIVE_STORAGE_SOURCE_KINDS,
        errorCode: `${this.errorPrefix}codex_retirement_inventory_invalid`, label: "native storage",
        requestLabel: "codex-app-server-native-storage-list", runRequest: this.runRequest.bind(this) });
    }
    return [...state.threadIds].sort();
  }

  async nativeThreadExists(threadId, { signal } = {}) {
    const id = normalizeAgentText(threadId);
    if (!id || id.length > CODEX_APP_SERVER_THREAD_INVENTORY_ID_MAX_LENGTH || codexAppServerTextHasControlCharacters(id)) {
      throw new TypeError("Native existence checks require an exact thread id.");
    }
    const client = await this.activeClient();
    const state = { entryCount: 0, threadIds: new Set(), totalBytes: 0 };
    for (const archived of [false, true]) {
      await listBoundedCodexAppServerThreadIds({ archived, client, state, signal,
        sourceKinds: CODEX_NATIVE_STORAGE_SOURCE_KINDS,
        errorCode: `${this.errorPrefix}codex_retirement_inventory_invalid`, label: "native storage",
        requestLabel: "codex-app-server-native-existence", runRequest: this.runRequest.bind(this) });
      if (state.threadIds.has(id)) return true;
    }
    return false;
  }

  async listHelperThreads({
    signal = null
  } = {}) {
    const client = await this.activeClient();
    const execution = await this.currentHelperExecutionContext();
    const state = {
      entryCount: 0,
      threadIds: new Set(),
      totalBytes: 0
    };
    for (const archived of [false, true]) {
      await listBoundedCodexAppServerThreadIds({
        archived,
        client,
        cwd: execution.cwd,
        errorCode: `${this.errorPrefix}codex_helper_thread_inventory_invalid`,
        label: "helper",
        requestLabel: "codex-app-server-helper-thread-list",
        runRequest: this.runRequest.bind(this),
        signal,
        state
      });
    }
    return Object.freeze({
      threadIds: Object.freeze([...state.threadIds].sort())
    });
  }

  async listModels(params = {}, {
    signal = null
  } = {}) {
    const client = await this.activeClient();
    const data = [];
    const seenCursors = new Set();
    const includeHidden = params.includeHidden === true;
    const limit = normalizePositiveInteger(
      params.limit,
      CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT
    );
    const boundedLimit = Math.min(limit, CODEX_APP_SERVER_MODEL_CATALOG_PAGE_LIMIT);
    let totalBytes = 0;
    let cursor = params.cursor === undefined || params.cursor === null || params.cursor === ""
      ? ""
      : typeof params.cursor === "string"
        ? params.cursor.trim()
        : null;
    if (cursor === null || cursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH) {
      throw this.modelCatalogError("Codex model catalog cursor is invalid.");
    }
    for (let page = 0; page < CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES; page += 1) {
      if (cursor && seenCursors.has(cursor)) {
        throw this.modelCatalogError("Codex model catalog repeated a pagination cursor.");
      }
      if (cursor) {
        seenCursors.add(cursor);
      }
      const response = await this.runRequest(
        () => client.request("model/list", {
          ...(cursor ? { cursor } : {}),
          includeHidden,
          limit: boundedLimit
        }, { signal }),
        "codex-app-server-model-list"
      );
      if (!Array.isArray(response?.data)) {
        throw this.modelCatalogError(
          "Codex model catalog response did not contain a data array."
        );
      }
      if (
        response.data.length > boundedLimit ||
        data.length + response.data.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRIES
      ) {
        throw this.modelCatalogError("Codex model catalog exceeded its entry limit.");
      }
      for (const entry of response.data) {
        if (!isPlainObject(entry)) {
          throw this.modelCatalogError("Codex model catalog contained an invalid entry.");
        }
        let entryBytes = 0;
        try {
          entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
        } catch {
          throw this.modelCatalogError("Codex model catalog contained an invalid entry.");
        }
        if (
          entryBytes > CODEX_APP_SERVER_MODEL_CATALOG_MAX_ENTRY_BYTES ||
          totalBytes + entryBytes > CODEX_APP_SERVER_MODEL_CATALOG_MAX_TOTAL_BYTES
        ) {
          throw this.modelCatalogError("Codex model catalog exceeded its response limit.");
        }
        totalBytes += entryBytes;
        data.push(entry);
      }
      const nextCursor = response.nextCursor === undefined || response.nextCursor === null || response.nextCursor === ""
        ? ""
        : typeof response.nextCursor === "string"
          ? response.nextCursor.trim()
          : null;
      if (nextCursor === null || nextCursor.length > CODEX_APP_SERVER_MODEL_CATALOG_MAX_CURSOR_LENGTH) {
        throw this.modelCatalogError("Codex model catalog cursor is invalid.");
      }
      if (!nextCursor) {
        return {
          data,
          nextCursor: null
        };
      }
      if (seenCursors.has(nextCursor)) {
        throw this.modelCatalogError("Codex model catalog repeated a pagination cursor.");
      }
      cursor = nextCursor;
    }
    throw this.modelCatalogError(
      `Codex model catalog exceeded ${CODEX_APP_SERVER_MODEL_CATALOG_MAX_PAGES} pages.`
    );
  }

  async readConfig(params = {}) {
    const client = await this.activeClient();
    const cwd = normalizeAgentText(params.cwd);
    return this.runRequest(
      () => client.request("config/read", {
        ...(cwd ? { cwd } : {}),
        includeLayers: params.includeLayers === true
      }),
      "codex-app-server-config-read"
    );
  }

  async trustProject(cwd = "") {
    if (!path.isAbsolute(cwd)) throw new TypeError("Codex project trust requires an absolute worktree path.");
    const projectRoot = path.resolve(cwd);
    const client = await this.activeClient();
    return this.runRequest(async () => {
      const { config } = await client.request("config/read", { cwd: projectRoot, includeLayers: false });
      if (config?.projects?.[projectRoot]?.trust_level === "trusted") return;
      // Codex discovers project hooks before applying thread config overrides.
      // Trust only this managed worktree through its native configuration API.
      await client.request("config/batchWrite", {
        edits: [{
          keyPath: `projects.${JSON.stringify(projectRoot)}.trust_level`,
          value: "trusted",
          mergeStrategy: "upsert"
        }],
        expectedVersion: null,
        filePath: null,
        reloadUserConfig: true
      });
    }, "codex-app-server-project-trust");
  }

  async listHooks(cwds = []) {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("hooks/list", {
        cwds: (Array.isArray(cwds) ? cwds : [cwds])
          .map(normalizeAgentText)
          .filter(Boolean)
      }),
      "codex-app-server-hooks-list"
    );
  }

  async writeHookTrustState(state = {}) {
    if (!isPlainObject(state) || Object.keys(state).length === 0) {
      return null;
    }
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("config/batchWrite", {
        edits: [{
          keyPath: "hooks.state",
          mergeStrategy: "upsert",
          value: state
        }],
        expectedVersion: null,
        filePath: null,
        reloadUserConfig: true
      }),
      "codex-app-server-hook-trust-write"
    );
  }

  async unsubscribeThread(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/unsubscribe", {
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-unsubscribe"
    );
  }

  async deleteThread(threadId = "") {
    const client = await this.activeClient();
    return this.runRequest(
      () => client.request("thread/delete", {
        threadId: normalizeAgentText(threadId)
      }),
      "codex-app-server-thread-delete"
    );
  }

  async sendTurn(threadId = "", input = [], params = {}, { signal } = {}) {
    const operation = async () => {
      const client = await this.activeClient();
      return client.request("turn/start", {
        ...params,
        input: codexTurnInput(input),
        threadId: normalizeAgentText(threadId || params.threadId)
      }, { signal });
    };
    const response = this.options.prepareThreadEnvironment
      ? await this.withThreadEnvironment(threadId || params.threadId, {}, operation)
      : await this.runRequest(operation, "codex-app-server-turn-start");
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  async steerTurn(threadId = "", turnId = "", input = [], params = {}, { signal } = {}) {
    const client = await this.activeClient();
    const response = await this.runRequest(
      () => client.request("turn/steer", {
        ...params,
        expectedTurnId: normalizeAgentText(turnId || params.expectedTurnId),
        input: codexTurnInput(input),
        threadId: normalizeAgentText(threadId || params.threadId)
      }, { signal }),
      "codex-app-server-turn-steer"
    );
    return {
      ...normalizeAgentTurn({
        id: response?.turn?.id || response?.turnId || turnId,
        provider: CODEX_APP_SERVER_PROVIDER_ID,
        raw: response?.turn || response
      }),
      response
    };
  }

  interruptionOutcome(threadId = "", turnId = "") {
    const key = JSON.stringify([normalizeAgentText(threadId), normalizeAgentText(turnId)]);
    return this.interruptedTurns.get(key) || "";
  }

  async interruptTurn(threadId = "", turnId = "", { outcome = "" } = {}) {
    const client = await this.activeClient();
    return this.runRequest(
      () => this.#interruptTurn(client, normalizeAgentText(threadId), normalizeAgentText(turnId), undefined, outcome),
      "codex-app-server-turn-interrupt"
    );
  }

  async #interruptTurn(client, threadId, turnId, signal, outcome = "") {
    const key = JSON.stringify([threadId, turnId]);
    this.interruptedTurns.set(key, outcome || this.interruptedTurns.get(key) || "");
    const result = await client.request("turn/interrupt", { threadId, turnId }, { signal });
    await Promise.all([...this.commandExecutions.values()]
      .filter((command) => command.threadId === threadId && command.turnId === turnId)
      .map((command) => this.#stopCommand(command)));
    return result;
  }

  #stopCommand(command) {
    if (command.stopTask) return command.stopTask;
    command.stopTask = (async () => {
      const signal = AbortSignal.timeout(5000);
      const request = (method, params) => command.client.request(method, params, { signal });
      while (!command.completed) {
        signal.throwIfAborted();
        let cursor;
        let terminal;
        const cursors = new Set();
        do {
          const page = await request("thread/backgroundTerminals/list", {
            threadId: command.threadId, limit: 100, ...(cursor ? { cursor } : {})
          });
          if (!Array.isArray(page.data)) throw new Error("Codex returned no command inventory.");
          terminal = page.data.find((entry) => entry.processId === command.processId);
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor)) throw new Error("Codex repeated its command inventory cursor.");
          cursors.add(cursor);
        } while (!terminal && cursor);
        if (command.completed) return;
        if (terminal) {
          // A recycled process ID must never target a different command.
          if (terminal.itemId !== command.itemId) throw new Error("The native command identity changed during Stop.");
          const stopped = await request("thread/backgroundTerminals/terminate", {
            threadId: command.threadId, processId: command.processId
          });
          if (stopped.terminated === true) return;
        }
        // Codex emits command-start before adding it to the process inventory.
        // Absence during that interval is not proof that the command exited.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })().catch((cause) => {
      const error = Object.assign(new Error("Codex could not confirm that the stopped turn's command exited.", { cause }), {
        code: `${this.errorPrefix}codex_command_stop_unconfirmed`
      });
      this.commandStopFailure = error;
      // Reuse the existing verified-runtime-stop owner when native control fails.
      // That owner may already be awaiting this command while stopping a lost
      // observation. Do not make command cleanup wait on its own caller.
      void Promise.resolve(this.failObservation(error)).catch(() => null);
      throw error;
    });
    return command.stopTask;
  }

  nativeCliResumeCommand(threadId = "") {
    const runtime = this.runtime || {};
    return codexCliResumeCommand({
      codexCommand: this.options.codexCommand || "codex",
      endpoint: runtime.endpoint,
      threadId
    });
  }

  close() {
    this.options.onClose?.();
    this.conversationRuntime.close();
    this.threadControlProbes.clear();
    this.commandExecutions.clear();
    this.interruptedTurns.clear();
    this.planUsage = null;
    this.planUsagePending = null;
    this.notificationSubscribers.clear();
    this.client?.close();
    this.client = null;
    this.initializeResult = null;
    this.helperAuth = null;
    this.helperAuthBlocked = false;
  }

  async stopRuntime({
    expectedAccountIdentitySignature = "",
    preserveProcessExitProof = false
  } = {}) {
    this.close();
    this.runtimeStopOwner = this.runtime || this.runtimeStopOwner;
    const runtime = this.runtimeStopOwner || {};
    const result = await this.host.runtime.stop({
      ...this.host.parameters,
      expectedAccountIdentitySignature,
      ownedRuntime: runtime,
      preserveProcessExitProof,
      runtimeDir: runtime.runtimeDir || this.options.runtimeDir
    });
    if (result.processExitVerified === true && this.runtimeStopOwner === runtime) {
      this.runtimeStopOwner = {
        ...runtime,
        processExitVerifiedAt: runtime.processExitVerifiedAt || new Date().toISOString(),
        processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      };
    }
    if (this.runtime === runtime) {
      this.runtime = null;
    }
    return result;
  }
}

export {
  CODEX_APP_SERVER_INVALID_REQUEST_CODE, assertCodexAuthPreflightReady,
  createCodexAppServerModelCatalogCache, codexAppServerProviderConnectionGeneration,
  ensureCodexAppServerThread, sendCodexAppServerPrompt,
  resumeExactCodexAppServerThread, startFreshCodexAppServerThread,
  defineCodexRenewalThreadIds, codexRenewalThreadError,
  codexAppServerEndpointForTarget, codexAppServerRequestIsInvalid, codexAppServerThreadIsMissing,
  codexAppServerThreadHasReadableHistory, deleteCodexAppServerThread, deleteCodexAppServerHelperThread,
  inspectCodexAppServerMessageAdmission,
  codexCliResumeCommand, codexLocalImageInput, codexTextInput, codexTurnInput, shellQuote,
  exportCodexNativeHistory, retireCodexConversationHistory
};
export {
  createCodexAppServerProviderOwner,
  codexAppServerOwnedRuntimeKey,
  codexAppServerRuntimeStopWasVerified
} from "./codexProviderOwner.js";
