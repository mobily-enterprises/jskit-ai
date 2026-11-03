import { codexAppServerTurnCanReceiveProviderActivity, codexAppServerTurnKey } from "./codexTurnState.js";
import { codexAppServerContentText, codexAppServerNotificationItem, codexAppServerOutputOwnerTurnId, codexAppServerNotificationParams, codexAppServerNotificationTurnId } from "./codexEvents.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Per-turn reasoning channels, their persistence queue and cleanup. The output owner that builds it shares these Maps
 * with its run owner.
 * @param {object} dependencies
 * @param {import("./codexTurn.js").CodexCreateStore} dependencies.createStore
 * @param {import("./codexTurn.js").CodexPublish} dependencies.publish
 * @param {import("./codexTurn.js").CodexAgentRunTurnStateReader} dependencies.turnStateFromAgentRun
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {(store: object, sessionId?: string) => Promise<object | null>} dependencies.readCodexAppServerAgentRunForSession
 */
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
    const itemId = normalizeText(params.itemId || item?.id || "summary");
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
    let text = normalizeText(value).replace(/\r\n/gu, "\n");
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
    return normalizeText(value)
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
    const method = normalizeText(notification.method);
    const item = codexAppServerNotificationItem(notification);
    const completed = method === "item/completed" && item?.type === "reasoning";
    if (!completed && !["item/reasoning/summaryPartAdded", "item/reasoning/summaryTextDelta", "item/reasoning/textDelta"].includes(method)) {
      return false;
    }
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId) || codexAppServerNotificationTurnId(notification);
    if (!normalizedThreadId) {
      return false;
    }
    const state = codexAppServerReasoningTurnState(normalizedThreadId, normalizedTurnId);
    const params = codexAppServerNotificationParams(notification);
    const itemId = normalizeText(params.itemId || item?.id || "summary");
    if (completed) {
      // Completed-only providers expose the same readable parts in the item.
      // Streamed items have already been recorded; do not replay their text.
      if (state.channels.has(itemId)) return false;
      const summary = codexAppServerContentText(item.summary);
      const text = normalizeText(summary) ? summary : codexAppServerContentText(item.content);
      return recordCodexAppServerReasoningNotification(normalizedThreadId, {
        method: normalizeText(summary) ? "item/reasoning/summaryTextDelta" : "item/reasoning/textDelta",
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
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
      normalizeText(sessionId),
      normalizeText(threadId),
      normalizeText(turnId) || "*"
    ].filter(Boolean).join(":");
  }

  async function persistCodexAppServerReasoningSummary(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeText(sessionId);
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
    if (normalizeText(run?.inputSource) === "terminal") {
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
        threadId: normalizeText(threadId),
        turnId: normalizeText(turnId)
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

  return Object.freeze({
    reasoningTurns: codexAppServerReasoningTurns,
    reasoningPersistQueues: codexAppServerReasoningPersistQueues,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    readReasoningText: readCodexAppServerReasoningText,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    cleanupReasoningTurn: cleanupCodexAppServerReasoningTurn,
    splitReasoningTurn: splitCodexAppServerReasoningTurn
  });
}
