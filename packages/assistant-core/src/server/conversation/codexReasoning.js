import { normalizeCodexRunText, codexAppServerTurnCanReceiveProviderActivity, codexAppServerTurnKey } from "./codexTurnState.js";
import { codexAppServerContentText, codexAppServerNotificationItem, codexAppServerOutputOwnerTurnId, codexAppServerNotificationParams, codexAppServerNotificationTurnId } from "./codexEvents.js";

// Original per-turn reasoning channels, persistence queue and cleanup.
// The containing output instance shares these exact Maps with its run owner.
export function createCodexAppServerReasoning({
  createStore,
  publish,
  turnStateFromAgentRun,
  debugLog,
  readCodexAppServerAgentRunForSession
}) {
  const codexAppServerReasoningTurns = new Map();
  const codexAppServerReasoningPersistQueues = new Map();

  function codexAppServerReasoningTurnKey(threadId = "", turnId = "") {
    return codexAppServerTurnKey(threadId, turnId || "*");
  }

  function codexAppServerReasoningTurnState(threadId = "", turnId = "") {
    const key = codexAppServerReasoningTurnKey(threadId, turnId);
    const existing = codexAppServerReasoningTurns.get(key);
    if (existing) {
      return existing;
    }
    const created = {
      createdAt: new Date().toISOString(),
      segments: [],
      channels: new Map(),
      summaries: new Map()
    };
    codexAppServerReasoningTurns.set(key, created);
    return created;
  }

  function codexAppServerReasoningExistingTurnState(threadId = "", turnId = "") {
    return codexAppServerReasoningTurns.get(codexAppServerReasoningTurnKey(threadId, turnId)) ||
      codexAppServerReasoningTurns.get(codexAppServerReasoningTurnKey(threadId, "*"));
  }

  function codexAppServerReasoningSummaryKey(notification = {}) {
    const params = codexAppServerNotificationParams(notification);
    const item = codexAppServerNotificationItem(notification);
    const itemId = normalizeCodexRunText(params.itemId || item?.id || "summary");
    const summaryIndex = String(params.summaryIndex ?? params.contentIndex ?? params.index ?? 0).trim() || "0";
    return `${itemId}:${summaryIndex}`;
  }

  function createCodexAppServerReasoningSegment(state = {}, summary = null, summaryKey = "") {
    const segment = {
      chunks: [],
      persistedAt: "",
      persistedText: "",
      summaryKey
    };
    if (Array.isArray(state.segments)) {
      state.segments.push(segment);
    }
    if (summary) {
      summary.currentSegment = segment;
    }
    return segment;
  }

  function codexAppServerReasoningSummaryDisplayText(value = "") {
    let text = normalizeCodexRunText(value).replace(/\r\n/gu, "\n");
    if (!text) {
      return "";
    }
    text = text.replace(/\*\*([^*\n][\s\S]*?)\*\*/gu, "$1");
    text = text.replace(/^\*\*\s*/u, "").replace(/\s*\*\*$/u, "");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function codexAppServerReasoningDisplayText(value = "") {
    return normalizeCodexRunText(value)
      .replace(/\r\n/gu, "\n")
      .split(/\n{2,}/u)
      .map(codexAppServerReasoningSummaryDisplayText)
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function recordCodexAppServerReasoningNotification(threadId = "", notification = {}, {
    turnId = ""
  } = {}) {
    const method = normalizeCodexRunText(notification.method);
    const item = codexAppServerNotificationItem(notification);
    const completed = method === "item/completed" && item?.type === "reasoning";
    if (!completed && !["item/reasoning/summaryPartAdded", "item/reasoning/summaryTextDelta", "item/reasoning/textDelta"].includes(method)) {
      return false;
    }
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId) || codexAppServerNotificationTurnId(notification);
    if (!normalizedThreadId) {
      return false;
    }
    const state = codexAppServerReasoningTurnState(normalizedThreadId, normalizedTurnId);
    const params = codexAppServerNotificationParams(notification);
    const itemId = normalizeCodexRunText(params.itemId || item?.id || "summary");
    if (completed) {
      // Completed-only providers expose the same readable parts in the item.
      // Streamed items have already been recorded; do not replay their text.
      if (state.channels.has(itemId)) return false;
      const summary = codexAppServerContentText(item.summary);
      const text = normalizeCodexRunText(summary) ? summary : codexAppServerContentText(item.content);
      return recordCodexAppServerReasoningNotification(normalizedThreadId, {
        method: normalizeCodexRunText(summary) ? "item/reasoning/summaryTextDelta" : "item/reasoning/textDelta",
        params: { itemId, delta: text }
      }, { turnId: normalizedTurnId });
    }
    const channel = method === "item/reasoning/textDelta" ? "content" : "summary";
    // Some providers expose both channels. Keep the first readable stream once.
    if (state.channels.has(itemId) && state.channels.get(itemId) !== channel) return false;
    const summaryKey = codexAppServerReasoningSummaryKey(notification);
    const summary = state.summaries.get(summaryKey) || {
      currentSegment: null
    };
    if (!summary.currentSegment) {
      createCodexAppServerReasoningSegment(state, summary, summaryKey);
    }
    if (method !== "item/reasoning/summaryPartAdded") {
      let delta = codexAppServerContentText(params.delta || params.text);
      if (delta) {
        state.channels.set(itemId, channel);
        const startsNewSegment = /^\s*\n/u.test(delta) &&
          summary.currentSegment?.chunks?.length &&
          summary.currentSegment?.persistedText;
        if (startsNewSegment) {
          delta = delta.replace(/^\s*\n+/u, "");
          createCodexAppServerReasoningSegment(state, summary, summaryKey);
        }
        summary.currentSegment.chunks.push(delta);
        state.summaries.set(summaryKey, summary);
        return true;
      }
    }
    state.summaries.set(summaryKey, summary);
    return false;
  }

  async function recordCodexAppServerReasoningForSession(sessionId = "", threadId = "", notifications = []) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    const currentTurn = turnStateFromAgentRun(run || {});
    const ownerTurnId = codexAppServerOutputOwnerTurnId({
      notificationThreadId: normalizedThreadId,
      notificationTurnId: codexAppServerNotificationTurnId(notifications[0]),
      trackedActive: currentTurn.active,
      trackedState: currentTurn.state,
      trackedThreadId: currentTurn.threadId,
      trackedTurnId: currentTurn.turnId
    });
    let changed = false;
    for (const notification of notifications) {
      if (recordCodexAppServerReasoningNotification(normalizedThreadId, notification, { turnId: ownerTurnId })) {
        changed = true;
      }
    }
    if (!changed) return false;
    await queueCodexAppServerReasoningPersist(
      normalizedSessionId,
      normalizedThreadId,
      ownerTurnId
    );
    return true;
  }

  function readCodexAppServerReasoningText(threadId = "", turnId = "") {
    const state = codexAppServerReasoningExistingTurnState(threadId, turnId);
    if (!state) {
      return "";
    }
    return (Array.isArray(state.segments) ? state.segments : [])
      .map((segment) => codexAppServerReasoningDisplayText(segment.chunks.join("")))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  function codexAppServerReasoningPersistKey(sessionId = "", threadId = "", turnId = "") {
    return [
      normalizeCodexRunText(sessionId),
      normalizeCodexRunText(threadId),
      normalizeCodexRunText(turnId) || "*"
    ].filter(Boolean).join(":");
  }

  async function persistCodexAppServerReasoningSummary(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const state = codexAppServerReasoningExistingTurnState(threadId, turnId);
    const segments = Array.isArray(state?.segments) ? state.segments : [];
    const pendingSegments = segments
      .map((segment) => ({
        segment,
        text: codexAppServerReasoningDisplayText(segment.chunks.join(""))
      }))
      .filter(({ segment, text }) => text && segment.persistedText !== text);
    if (!normalizedSessionId || !state || !pendingSegments.length) {
      return;
    }
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    if (normalizeCodexRunText(run?.inputSource) === "terminal") {
      return;
    }
    const turn = turnStateFromAgentRun(run || {});
    if (!codexAppServerTurnCanReceiveProviderActivity(turn, threadId, turnId)) {
      debugLog("appServerReasoningSummary.ignored", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizeCodexRunText(threadId),
        turnId: normalizeCodexRunText(turnId)
      });
      return;
    }
    for (const {
      segment,
      text
    } of pendingSegments) {
      segment.persistedAt ||= new Date().toISOString();
      const written = await store.writeConversationThinkingMessage(normalizedSessionId, {
        at: segment.persistedAt,
        nativeIdentity: { threadId, turnId },
        requireOpenTurn: false,
        text
      });
      if (!written) {
        continue;
      }
      segment.persistedText = text;
      await publish(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason: "codex-app-server-reasoning-summary"
      });
    }
  }

  function queueCodexAppServerReasoningPersist(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerReasoningPersistKey(sessionId, threadId, turnId);
    if (!key) {
      return Promise.resolve();
    }
    return runQueuedCodexAppServerReasoningPersist(key, sessionId, threadId, turnId);
  }

  async function flushCodexAppServerReasoningPersist(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerReasoningPersistKey(sessionId, threadId, turnId);
    const queued = key ? codexAppServerReasoningPersistQueues.get(key) : null;
    if (queued) {
      await queued.catch(() => null);
    }
    await persistCodexAppServerReasoningSummary(sessionId, threadId, turnId);
  }

  function runQueuedCodexAppServerReasoningPersist(key = "", sessionId = "", threadId = "", turnId = "") {
    const previous = codexAppServerReasoningPersistQueues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => null)
      .then(() => persistCodexAppServerReasoningSummary(sessionId, threadId, turnId));
    codexAppServerReasoningPersistQueues.set(key, next);
    next
      .finally(() => {
        if (codexAppServerReasoningPersistQueues.get(key) === next) {
          codexAppServerReasoningPersistQueues.delete(key);
        }
      })
      .catch(() => null);
    return next;
  }

  function cleanupCodexAppServerReasoningTurn(threadId = "", turnId = "") {
    codexAppServerReasoningTurns.delete(codexAppServerReasoningTurnKey(threadId, turnId));
    codexAppServerReasoningTurns.delete(codexAppServerReasoningTurnKey(threadId, "*"));
  }

  function splitCodexAppServerReasoningTurn(threadId = "", turnId = "") {
    const state = codexAppServerReasoningExistingTurnState(threadId, turnId);
    if (!state) {
      return false;
    }
    for (const summary of state.summaries.values()) {
      summary.currentSegment = null;
    }
    return true;
  }

  return {
    reasoningTurns: codexAppServerReasoningTurns,
    reasoningPersistQueues: codexAppServerReasoningPersistQueues,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    readReasoningText: readCodexAppServerReasoningText,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    cleanupReasoningTurn: cleanupCodexAppServerReasoningTurn,
    splitReasoningTurn: splitCodexAppServerReasoningTurn
  };
}
