import crypto from "node:crypto";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeCodexRunText,
  codexAppServerConversationMessageId,
  codexAppServerTurnCanReceiveProviderActivity
} from "./codexTurnState.js";
import {
  codexAppServerAgentMessageText,
  codexAppServerAssistantItemText,
  classifyCodexAppServerEvent,
  codexAppServerNotificationEvent,
  codexAppServerNotificationEventType,
  codexAppServerNotificationEventPayload,
  codexAppServerNotificationItem,
  codexAppServerNotificationItemId,
  codexAppServerNotificationTurnId
} from "./codexEvents.js";

export function codexAppServerLiveProgressCandidate(notification = {}) {
  const method = normalizeCodexRunText(notification.method);
  const event = codexAppServerNotificationEvent(notification);
  if (isRecord(event)) {
    const eventType = codexAppServerNotificationEventType(notification, event);
    const payload = codexAppServerNotificationEventPayload(notification, event);
    const payloadType = normalizeCodexRunText(payload.type);
    const phase = normalizeCodexRunText(payload.phase || event.phase);
    if (eventType === "event_msg" && payloadType === "agent_message" && phase && phase !== "final_answer") {
      return {
        explicit: Boolean(phase),
        phase,
        source: "event",
        text: codexAppServerAgentMessageText(payload)
      };
    }
  }

  if (method !== "item/completed") {
    return null;
  }
  const item = codexAppServerNotificationItem(notification);
  const text = codexAppServerAssistantItemText(item);
  if (!text) {
    return null;
  }
  const phase = normalizeCodexRunText(item?.phase || item?.purpose || item?.category);
  if (phase === "final_answer") {
    return null;
  }
  return {
    explicit: ["commentary", "progress", "status", "thinking"].includes(phase),
    phase,
    source: "item",
    text
  };
}

function codexAppServerLiveProgressKey(sessionId = "", threadId = "", notification = {}) {
  const itemId = codexAppServerNotificationItemId(notification);
  if (!itemId) {
    return "";
  }
  return [
    normalizeCodexRunText(sessionId),
    normalizeCodexRunText(threadId),
    codexAppServerNotificationTurnId(notification) || "*",
    "live-progress",
    itemId
  ].join(":");
}

function codexAppServerLiveProgressFingerprintKey(
  sessionId = "",
  threadId = "",
  turnId = "",
  text = ""
) {
  const normalizedText = normalizeCodexRunText(text);
  if (!normalizedText) {
    return "";
  }
  return [
    normalizeCodexRunText(sessionId),
    normalizeCodexRunText(threadId),
    normalizeCodexRunText(turnId) || "*",
    "live-progress-text",
    crypto.createHash("sha256").update(normalizedText).digest("hex")
  ].join(":");
}

function codexAppServerTerminalItemMirrorKey(sessionId = "", threadId = "", notification = {}, role = "") {
  const itemId = codexAppServerNotificationItemId(notification);
  if (!itemId) {
    return "";
  }
  return [
    normalizeCodexRunText(sessionId),
    normalizeCodexRunText(threadId),
    codexAppServerNotificationTurnId(notification) || "*",
    normalizeCodexRunText(role),
    itemId
  ].join(":");
}

/**
 * Native items other than the final answer that the conversation log shows as they happen: live progress
 * (commentary and thinking) and the messages of a turn started from the terminal. Each item is written once.
 * @param {object} dependencies
 * @param {import("./codexTurn.js").CodexCreateStore} dependencies.createStore
 * @param {import("./codexTurn.js").CodexPublish} dependencies.publish
 * @param {import("./codexTurn.js").CodexAgentRunTurnStateReader} dependencies.turnStateFromAgentRun
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {(store: object, sessionId?: string) => Promise<object | null>} dependencies.readCodexAppServerAgentRunForSession
 * @param {import("./codexTurn.js").CodexMessageMetadataHooks} dependencies.messageMetadata
 * @param {boolean} dependencies.persistCommentary
 * @param {number} dependencies.liveProgressMaxLength
 */
export function createCodexAppServerLiveItems({
  createStore,
  publish,
  turnStateFromAgentRun,
  debugLog,
  readCodexAppServerAgentRunForSession,
  messageMetadata,
  persistCommentary,
  liveProgressMaxLength
}) {
  const codexAppServerLiveProgressItems = new Set();
  const codexAppServerLiveProgressFingerprints = new Set();
  const codexAppServerMirroredTerminalItems = new Set();

  function codexAppServerLiveProgressText(notification = {}) {
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = normalizeCodexRunText(candidate?.text);
    if (!text) {
      return "";
    }
    if (candidate?.phase === "commentary") {
      return text;
    }
    if (text.length > liveProgressMaxLength) {
      return "";
    }
    if (text.includes("\n") || text.includes("\r") || text.includes("```")) {
      return "";
    }
    return text;
  }

  async function writeMirroredCodexAppServerTerminalMessage({
    notification = {},
    role = "",
    sessionId = "",
    text = "",
    threadId = ""
  } = {}) {
    const normalizedRole = normalizeCodexRunText(role);
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedText = normalizeCodexRunText(text);
    if (!normalizedSessionId || !normalizedText || !["assistant", "user"].includes(normalizedRole)) {
      return null;
    }
    const key = codexAppServerTerminalItemMirrorKey(
      normalizedSessionId,
      threadId,
      notification,
      normalizedRole
    );
    if (!key) {
      return null;
    }
    if (codexAppServerMirroredTerminalItems.has(key)) {
      return null;
    }
    codexAppServerMirroredTerminalItems.add(key);
    let written = null;
    try {
      const store = await createStore(sessionId);
      const writer = normalizedRole === "user"
        ? store?.writeConversationUserMessage
        : store?.writeConversationAssistantMessage;
      if (typeof writer !== "function") {
        codexAppServerMirroredTerminalItems.delete(key);
        return null;
      }
      let turnMetadata = null;
      if (normalizedRole === "user") {
        turnMetadata = await messageMetadata.terminal(store, normalizedSessionId) ?? null;
      }
      written = await writer.call(store, normalizedSessionId, {
        messageId: codexAppServerConversationMessageId(
          threadId,
          codexAppServerNotificationTurnId(notification),
          normalizedRole,
          normalizedText
        ),
        text: normalizedText,
        nativeIdentity: { threadId, turnId: codexAppServerNotificationTurnId(notification) },
        ...(turnMetadata ? { turnMetadata } : {})
      });
      if (!written) {
        codexAppServerMirroredTerminalItems.delete(key);
        return null;
      }
      const reason = normalizedRole === "user"
        ? "codex-app-server-terminal-user-message"
        : "codex-app-server-terminal-assistant-message";
      await publish(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason
      });
      debugLog(`appServerTerminal${normalizedRole === "user" ? "User" : "Assistant"}Message.mirrored`, {
        itemId: normalizeCodexRunText(codexAppServerNotificationItem(notification)?.id),
        sessionId: normalizedSessionId,
        threadId: normalizeCodexRunText(threadId),
        turnId: codexAppServerNotificationTurnId(notification)
      });
      return written;
    } catch (error) {
      if (!written) {
        codexAppServerMirroredTerminalItems.delete(key);
      }
      throw error;
    }
  }

  async function mirrorCodexAppServerTerminalAssistantMessage(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    if (codexAppServerLiveProgressCandidate(notification)?.explicit === true) {
      return;
    }
    const classification = classifyCodexAppServerEvent(notification);
    // Completed finals use the same native-item publication owner as UI chat.
    if (classification.kind === "final_assistant_result") {
      return;
    }
    const text = normalizeCodexRunText(
      codexAppServerAssistantItemText(codexAppServerNotificationItem(notification))
    );
    if (!normalizedSessionId || !text) {
      return;
    }
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    if (normalizeCodexRunText(run?.inputSource) !== "terminal") {
      return;
    }
    await writeMirroredCodexAppServerTerminalMessage({
      notification,
      role: "assistant",
      sessionId: normalizedSessionId,
      text,
      threadId: normalizedThreadId
    });
  }

  async function writeCodexAppServerLiveProgress(sessionId = "", threadId = "", notification = {}) {
    // Phase-less providers also send short updates as agent messages.
    // Reasoning items are recorded separately from these user-facing updates.
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = codexAppServerLiveProgressText(notification);
    if (!normalizedSessionId || !normalizedThreadId || !text) {
      return null;
    }
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    const turn = turnStateFromAgentRun(run || {});
    const notificationTurnId = codexAppServerNotificationTurnId(notification);
    const ownerTurnId = notificationTurnId || turn.turnId;
    if (!codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, notificationTurnId)) {
      return null;
    }
    const key = codexAppServerLiveProgressKey(normalizedSessionId, normalizedThreadId, notification);
    if (!key) {
      return null;
    }
    const fingerprintKey = codexAppServerLiveProgressFingerprintKey(
      normalizedSessionId,
      normalizedThreadId,
      ownerTurnId,
      text
    );
    const streamMessageId = codexAppServerConversationMessageId(
      normalizedThreadId, notificationTurnId,
      "assistant-item", codexAppServerNotificationItemId(notification)
    );
    if (
      codexAppServerLiveProgressItems.has(key) ||
      codexAppServerLiveProgressFingerprints.has(fingerprintKey)
    ) {
      await publish(normalizedSessionId, {
        payload: { conversationStream: store.completeConversationStreamMessage(normalizedSessionId, streamMessageId) },
        reason: "assistant-stream"
      });
      return null;
    }
    codexAppServerLiveProgressItems.add(key);
    codexAppServerLiveProgressFingerprints.add(fingerprintKey);
    let written = null;
    try {
      const role = !candidate.phase || candidate.phase === "commentary" ? "commentary" : "thinking";
      const writer = role === "commentary"
        ? store.writeConversationCommentaryMessage
        : store.writeConversationThinkingMessage;
      if (role !== "commentary" || persistCommentary) {
        written = await writer.call(store, normalizedSessionId, {
          ...(streamMessageId ? { outputId: streamMessageId } : {}),
          messageId: codexAppServerConversationMessageId(
            normalizedThreadId,
            ownerTurnId,
            role,
            text
          ),
          requireOpenTurn: false,
          nativeIdentity: { threadId: normalizedThreadId, turnId: ownerTurnId },
          text
        });
        if (!written) {
          codexAppServerLiveProgressItems.delete(key);
          codexAppServerLiveProgressFingerprints.delete(fingerprintKey);
        }
      }
      const payload = {
        conversationStream: await store.completeConversationStreamMessage(normalizedSessionId, streamMessageId, {
          text, role, nativeIdentity: { threadId: normalizedThreadId, turnId: ownerTurnId }
        })
      };
      if (written) {
        payload.conversationLogPatch = { turn: written, type: "upsert-turn" };
      }
      await publish(normalizedSessionId, {
        payload,
        reason: role === "commentary"
          ? "codex-app-server-commentary"
          : "codex-app-server-live-progress"
      });
      return written;
    } catch (error) {
      if (!written) {
        codexAppServerLiveProgressItems.delete(key);
        codexAppServerLiveProgressFingerprints.delete(fingerprintKey);
      }
      throw error;
    }
  }

  function forgetCodexAppServerLiveTurnItems(threadId = "", turnId = "") {
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedThreadId) {
      return;
    }
    const markers = [
      `:${normalizedThreadId}:*:`,
      ...(normalizedTurnId ? [`:${normalizedThreadId}:${normalizedTurnId}:`] : [])
    ];
    for (const set of [
      codexAppServerLiveProgressItems,
      codexAppServerLiveProgressFingerprints,
      codexAppServerMirroredTerminalItems
    ]) {
      for (const key of set) {
        if (markers.some((marker) => key.includes(marker))) {
          set.delete(key);
        }
      }
    }
  }

  return Object.freeze({
    liveProgressItems: codexAppServerLiveProgressItems,
    liveProgressFingerprints: codexAppServerLiveProgressFingerprints,
    mirroredTerminalItems: codexAppServerMirroredTerminalItems,
    writeLiveProgress: writeCodexAppServerLiveProgress,
    writeMirroredTerminalMessage: writeMirroredCodexAppServerTerminalMessage,
    mirrorTerminalAssistantMessage: mirrorCodexAppServerTerminalAssistantMessage,
    forgetTurnItems: forgetCodexAppServerLiveTurnItems
  });
}
