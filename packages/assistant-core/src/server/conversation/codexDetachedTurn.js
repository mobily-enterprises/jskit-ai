import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import { classifyCodexAppServerEvent, codexAppServerNotificationParams, codexAppServerNotificationThreadId, codexAppServerNotificationTurnId, codexAppServerNotificationTurnStatus, codexAppServerNotificationError, codexAppServerStatusFromValue } from "./codexEvents.js";
import {
  codexAppServerProviderThreadAssistantSegments,
  codexAppServerProviderTurnId,
  codexAppServerProviderTurnStatus,
  codexAppServerProviderTurnForOperation,
  codexAppServerProviderTurnText,
  codexAppServerProviderTurnError
} from "./codexThreadSnapshot.js";
import { codexAppServerTurnStatusIsProviderFailure, codexAppServerTurnStatusIsSuccessfulComplete } from "./codexTurnState.js";

const CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS = 180_000;
const CODEX_APP_SERVER_DETACHED_FAILURE_DETAIL_GRACE_MS = 500;

function codexAppServerTurnTokenUsage(notification = {}) {
  if (normalizeNullableText(notification.method) !== "thread/tokenUsage/updated") {
    return null;
  }
  const params = codexAppServerNotificationParams(notification);
  const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : {};
  const turnUsage = isRecord(tokenUsage.last) ? tokenUsage.last : tokenUsage;
  const snapshot = {};
  for (const field of [
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "inputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens"
  ]) {
    const value = Number(turnUsage[field]);
    if (Number.isSafeInteger(value) && value >= 0) {
      snapshot[field] = value;
    }
  }
  return Object.keys(snapshot).length ? Object.freeze(snapshot) : null;
}

/**
 * The provider methods a detached turn watcher reads.
 * @typedef {Pick<import("./codexProvider.js").CodexAppServerAgentProvider,
 *   "subscribe" | "readThread" | "isAvailable" | "currentConnectionGeneration">} CodexDetachedTurnProvider
 */

/**
 * The observer told about each classified notification of the watched turn.
 * @typedef {(classification: object, notification: object) => void} CodexDetachedTurnEventObserver
 */

function ignoreCodexDetachedTurnEvent() {}

/**
 * Watches one native turn of a thread until it completes, fails or times out.
 * @param {CodexDetachedTurnProvider} provider
 * @param {string} threadId
 * @param {object} [options]
 * @param {boolean} [options.includeThreadHistory]
 * @param {boolean} [options.allowEmptyResponse]
 * @param {CodexDetachedTurnEventObserver} [options.onEvent]
 * @param {number} [options.timeoutMs]
 */
function createCodexAppServerDetachedTurnWatcher(provider, threadId = "", {
  includeThreadHistory = true,
  allowEmptyResponse = false,
  onEvent = ignoreCodexDetachedTurnEvent,
  timeoutMs = CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
} = {}) {
  const normalizedThreadId = normalizeNullableText(threadId);
  let targetTurnId = "";
  let finalText = "";
  let usage = null;
  let failureDetailTimeout = null;
  let settled = false;
  let timeout = null;
  let connectionCheck = null;
  let unsubscribe = null;
  let pendingCompletionStatus = "";
  let pendingFailure = null;
  let resolveWaiter = null;
  let rejectWaiter = null;

  function cleanup() {
    clearTimeout(timeout);
    timeout = null;
    clearInterval(connectionCheck);
    connectionCheck = null;
    clearTimeout(failureDetailTimeout);
    failureDetailTimeout = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  function finish(result = {}) {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    resolveWaiter?.(result);
  }

  function fail(error) {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    rejectWaiter?.(error);
  }

  function emitWatcherEvent(classification, notification) {
    if (!classification.kind) {
      return;
    }
    onEvent({
      ...classification,
      threadId: classification.threadId || normalizedThreadId,
      turnId: classification.turnId || targetTurnId
    }, notification);
  }

  async function resultFromThread() {
    if (
      !includeThreadHistory ||
      !normalizedThreadId ||
      !targetTurnId
    ) {
      return {
        status: "",
        statusType: "",
        text: ""
      };
    }
    const thread = await provider.readThread(normalizedThreadId);
    const rawStatus = thread.raw?.status || thread.response?.thread?.status;
    return {
      status: codexAppServerStatusFromValue(rawStatus),
      statusType: normalizeNullableText(typeof rawStatus === "string" ? rawStatus : rawStatus?.type),
      text: codexAppServerProviderThreadAssistantSegments(thread, targetTurnId)
        .map((segment) => segment.text)
        .join("\n\n")
    };
  }

  function failAfterDetailGrace(error) {
    if (settled || failureDetailTimeout) {
      return;
    }
    failureDetailTimeout = setTimeout(() => {
      failureDetailTimeout = null;
      fail(error);
    }, CODEX_APP_SERVER_DETACHED_FAILURE_DETAIL_GRACE_MS);
  }

  async function finishFromCompletion(status = "completed") {
    try {
      if (!targetTurnId) {
        pendingCompletionStatus = normalizeNullableText(status) || "completed";
        return;
      }
      const authoritative = await resultFromThread().catch(() => ({
        status: "",
        statusType: "",
        text: ""
      }));
      finalText = authoritative.text || finalText;
      if (!finalText && !allowEmptyResponse) {
        pendingCompletionStatus = normalizeNullableText(status) || "completed";
        const systemError = authoritative.statusType === "systemError" || authoritative.status === "failed";
        failAfterDetailGrace(new Error(systemError
          ? "Codex app-server thread entered a system error before producing an assistant response."
          : "Codex app-server completed without producing an assistant response."));
        return;
      }
      finish({
        status,
        text: finalText,
        threadId: normalizedThreadId,
        turnId: targetTurnId,
        usage
      });
    } catch (error) {
      fail(error);
    }
  }

  function notificationMatches(notification = {}) {
    const notificationThreadId = codexAppServerNotificationThreadId(notification);
    if (notificationThreadId && notificationThreadId !== normalizedThreadId) {
      return false;
    }
    const notificationTurnId = codexAppServerNotificationTurnId(notification);
    return !targetTurnId || !notificationTurnId || notificationTurnId === targetTurnId;
  }

  function setTurnId(turnId = "") {
    targetTurnId = normalizeNullableText(turnId);
    if (pendingFailure) {
      failAfterDetailGrace(pendingFailure);
      return;
    }
    if (pendingCompletionStatus) {
      const status = pendingCompletionStatus;
      pendingCompletionStatus = "";
      void finishFromCompletion(status);
    }
  }

  function wait() {
    if (settled) {
      return Promise.reject(new Error("Codex app-server detached turn watcher was already settled."));
    }
    return new Promise((resolve, reject) => {
      resolveWaiter = resolve;
      rejectWaiter = reject;
      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          fail(new Error("Timed out waiting for Codex app-server response."));
        }, timeoutMs);
      } else {
        // Interactive repair turns may take longer than bounded helper jobs.
        // Retain their watcher until completion, interruption, or connection loss.
        const generation = provider.currentConnectionGeneration();
        connectionCheck = setInterval(() => {
          if (provider.isAvailable() === false ||
            provider.currentConnectionGeneration() !== generation) {
            fail(new Error("Connection to Codex was lost while the temporary AI was working."));
          }
        }, 1000);
        connectionCheck.unref();
      }
      unsubscribe = provider.subscribe((notification = {}) => {
        if (!notificationMatches(notification)) {
          return;
        }
        usage = codexAppServerTurnTokenUsage(notification) || usage;
        const classification = classifyCodexAppServerEvent(notification);
        emitWatcherEvent(classification, notification);
        if (
          classification.kind === "provider_error" &&
          classification.text &&
          codexAppServerNotificationParams(notification).willRetry !== true
        ) {
          const error = new Error(classification.text);
          if (!targetTurnId) {
            pendingFailure = error;
            return;
          }
          fail(error);
          return;
        }
        if (classification.kind === "final_assistant_result" && classification.text) {
          finalText = classification.text;
          if (pendingCompletionStatus && targetTurnId) {
            const status = pendingCompletionStatus;
            pendingCompletionStatus = "";
            clearTimeout(failureDetailTimeout);
            failureDetailTimeout = null;
            void finishFromCompletion(status);
          }
        }
        const method = normalizeNullableText(notification.method);
        if (method !== "turn/completed" && method !== "thread/status/changed") {
          return;
        }
        const status = codexAppServerNotificationTurnStatus(notification) || "completed";
        if (codexAppServerTurnStatusIsProviderFailure(status)) {
          const error = new Error(codexAppServerNotificationError(notification) || `Codex app-server turn ${status}.`);
          if (!targetTurnId) {
            pendingFailure = error;
            return;
          }
          failAfterDetailGrace(error);
          return;
        }
        if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
          void finishFromCompletion(status);
        }
      });
    });
  }

  return Object.freeze({
    completeNow: finishFromCompletion,
    failNow: fail,
    failAfterDetailGrace,
    // readable-check: allow setter-seam - not a slot: setTurnId records the turn identity that startup acknowledges after wait() has subscribed
    setTurnId,
    wait
  });
}

function codexAppServerTurnError(reason, details = {}, providerMessage = "") {
  const retryable = reason === "failed";
  const error = new Error(providerMessage || (reason === "identity_missing"
    ? "Codex did not return the exact turn identity."
    : `Codex app-server turn ${details.status}.`));
  error.code = `codex_app_server_turn_${reason}`;
  error.details = { ...details, retryable };
  error.retryable = retryable;
  return error;
}

/**
 * Waits for an already started native turn and returns its final answer.
 * @param {CodexDetachedTurnProvider} provider
 * @param {string} threadId
 * @param {object | null} turn
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {typeof codexAppServerTurnError} [options.createError]
 */
async function waitForCodexAppServerTurn(provider, threadId = "", turn = null, {
  timeoutMs = CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS,
  createError = codexAppServerTurnError
} = {}) {
  const normalizedThreadId = normalizeNullableText(threadId || "");
  const turnId = codexAppServerProviderTurnId(turn || {});
  const status = codexAppServerProviderTurnStatus(turn || {});
  if (!normalizedThreadId || !turnId) {
    throw createError("identity_missing", { threadId: normalizedThreadId, turnId });
  }
  if (codexAppServerTurnStatusIsProviderFailure(status)) {
    throw createError(
      "failed",
      { status, threadId: normalizedThreadId, turnId },
      codexAppServerProviderTurnError(turn || {})
    );
  }
  const existingText = codexAppServerProviderTurnText({
    raw: { turns: [turn] }
  }, turnId);
  if (codexAppServerTurnStatusIsSuccessfulComplete(status) && existingText) {
    return {
      status,
      text: existingText,
      threadId: normalizedThreadId,
      turnId,
      usage: null
    };
  }
  const watcher = createCodexAppServerDetachedTurnWatcher(provider, normalizedThreadId, {
    timeoutMs
  });
  watcher.setTurnId(turnId);
  const pending = watcher.wait();
  void pending.catch(() => null);
  if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
    await watcher.completeNow(status);
  } else {
    const latestThread = await provider.readThread(normalizedThreadId);
    const latestTurn = codexAppServerProviderTurnForOperation(latestThread, { turnId });
    const latestStatus = codexAppServerProviderTurnStatus(latestTurn || {});
    if (codexAppServerTurnStatusIsProviderFailure(latestStatus)) {
      watcher.failNow(createError(
        "failed",
        { status: latestStatus, threadId: normalizedThreadId, turnId },
        codexAppServerProviderTurnError(latestTurn || {})
      ));
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(latestStatus)) {
      await watcher.completeNow(latestStatus);
    }
  }
  return pending;
}

export {
  CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS,
  createCodexAppServerDetachedTurnWatcher,
  ignoreCodexDetachedTurnEvent,
  waitForCodexAppServerTurn
};
