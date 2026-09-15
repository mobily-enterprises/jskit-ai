import { normalizeText, isPlainObject } from "./normalize.js";
import { classifyCodexAppServerEvent, codexAppServerNotificationParams, codexAppServerNotificationThreadId, codexAppServerNotificationTurnId, codexAppServerNotificationTurnStatus, codexAppServerNotificationError, codexAppServerStatusFromValue, codexAppServerProviderThreadAssistantSegments } from "./codexEvents.js";
const CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS = 180_000;
const CODEX_APP_SERVER_DETACHED_FAILURE_DETAIL_GRACE_MS = 500;

function codexAppServerTurnStatusIsActive(status = "") {
  return normalizeText(status) === "inProgress";
}

function codexAppServerTurnStatusIsComplete(status = "") {
  return ["completed", "interrupted", "failed"].includes(normalizeText(status));
}

function codexAppServerTurnStatusIsSuccessfulComplete(status = "") {
  return normalizeText(status) === "completed";
}

function codexAppServerTurnStatusIsProviderFailure(status = "") {
  return ["failed", "interrupted"].includes(normalizeText(status));
}

function codexAppServerTurnTokenUsage(notification = {}) {
  if (normalizeText(notification.method) !== "thread/tokenUsage/updated") {
    return null;
  }
  const params = codexAppServerNotificationParams(notification);
  const tokenUsage = isPlainObject(params.tokenUsage) ? params.tokenUsage : {};
  const turnUsage = isPlainObject(tokenUsage.last) ? tokenUsage.last : tokenUsage;
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

function createCodexAppServerDetachedTurnWatcher(provider = null, threadId = "", {
  includeThreadHistory = true,
  onEvent = null,
  timeoutMs = CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
} = {}) {
  const normalizedThreadId = normalizeText(threadId);
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

  function emitWatcherEvent(classification = {}) {
    if (typeof onEvent !== "function" || !classification?.kind) {
      return;
    }
    onEvent({
      ...classification,
      threadId: classification.threadId || normalizedThreadId,
      turnId: classification.turnId || targetTurnId
    });
  }

  async function resultFromThread() {
    if (
      !includeThreadHistory ||
      !normalizedThreadId ||
      !targetTurnId ||
      typeof provider?.readThread !== "function"
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
      statusType: normalizeText(typeof rawStatus === "string" ? rawStatus : rawStatus?.type),
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
        pendingCompletionStatus = normalizeText(status) || "completed";
        return;
      }
      const authoritative = await resultFromThread().catch(() => ({
        status: "",
        statusType: "",
        text: ""
      }));
      finalText = authoritative.text || finalText;
      if (!finalText) {
        pendingCompletionStatus = normalizeText(status) || "completed";
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

  return {
    async completeNow(status = "completed") {
      await finishFromCompletion(status);
    },
    failNow(error) {
      fail(error);
    },
    failAfterDetailGrace(error) {
      failAfterDetailGrace(error);
    },
    setTurnId(turnId = "") {
      targetTurnId = normalizeText(turnId);
      if (pendingFailure) {
        failAfterDetailGrace(pendingFailure);
        return;
      }
      if (pendingCompletionStatus) {
        const status = pendingCompletionStatus;
        pendingCompletionStatus = "";
        void finishFromCompletion(status);
      }
    },
    wait() {
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
          const generation = provider?.currentConnectionGeneration?.();
          connectionCheck = setInterval(() => {
            if (provider?.isAvailable?.() === false ||
              provider?.currentConnectionGeneration?.() !== generation) {
              fail(new Error("Connection to Codex was lost while the temporary AI was working."));
            }
          }, 1000);
          connectionCheck.unref?.();
        }
        unsubscribe = typeof provider?.subscribe === "function"
          ? provider.subscribe((notification = {}) => {
              if (!notificationMatches(notification)) {
                return;
              }
              usage = codexAppServerTurnTokenUsage(notification) || usage;
              const classification = classifyCodexAppServerEvent(notification);
              emitWatcherEvent(classification);
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
              const method = normalizeText(notification.method);
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
            })
          : null;
      });
    }
  };
}

export { createCodexAppServerDetachedTurnWatcher, codexAppServerTurnStatusIsActive, codexAppServerTurnStatusIsComplete, codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure };
