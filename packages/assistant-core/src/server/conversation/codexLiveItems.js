import crypto from "node:crypto";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { codexAppServerConversationMessageId, codexAppServerTurnCanReceiveProviderActivity } from "./codexTurnState.js";
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
  const method = normalizeText(notification.method);
  const event = codexAppServerNotificationEvent(notification);
  if (isRecord(event)) {
    const eventType = codexAppServerNotificationEventType(notification, event);
    const payload = codexAppServerNotificationEventPayload(notification, event);
    const payloadType = normalizeText(payload.type);
    const phase = normalizeText(payload.phase || event.phase);
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
  const phase = normalizeText(item?.phase || item?.purpose || item?.category);
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
    normalizeText(sessionId),
    normalizeText(threadId),
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
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return "";
  }
  return [
    normalizeText(sessionId),
    normalizeText(threadId),
    normalizeText(turnId) || "*",
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
    normalizeText(sessionId),
    normalizeText(threadId),
    codexAppServerNotificationTurnId(notification) || "*",
    normalizeText(role),
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
  // What each turn's items decide about its agent messages (see observeCodexAppServerTurnItem).
  const codexAppServerTurnReplies = new Map();

  function codexAppServerTurnRepliesKey(sessionId = "", threadId = "", turnId = "") {
    return [normalizeText(sessionId), normalizeText(threadId), normalizeText(turnId), "steer-replies"].join(":");
  }

  /**
   * One item of a turn, observed in Codex's own order as it arrives, before
   * the writes it causes are queued. It returns the agent messages it settles
   * as progress, to write before this item's own writes.
   *
   * Codex records a message steered into its running turn as a user item of
   * that turn, which it reads at its next step and answers in its next agent
   * message before it works on. That message is a reply to the person, not
   * progress, with or without a phase.
   *
   * An agent message without a phase is progress when another item follows
   * it, and part of the turn's final answer when it ends the turn
   * (codexAppServerProviderTurnAssistantSegments). A long or multi-line one, a
   * reply, and any that follows one of those wait for that: the next item
   * that is not an agent message settles them as progress (a reply stays a
   * reply); at the turn's end they are its answer, saved once from its history.
   */
  function observeCodexAppServerTurnItem(sessionId = "", threadId = "", notification = {}) {
    const method = normalizeText(notification.method);
    const item = codexAppServerNotificationItem(notification);
    const itemId = codexAppServerNotificationItemId(notification);
    const turnId = codexAppServerNotificationTurnId(notification);
    if (!["item/started", "item/completed"].includes(method) || !isRecord(item) || !itemId || !turnId) {
      return [];
    }
    const key = codexAppServerTurnRepliesKey(sessionId, threadId, turnId);
    const turn = codexAppServerTurnReplies.get(key) ||
      { working: false, owed: false, replies: new Set(), waiting: [], waitingIds: new Set() };
    codexAppServerTurnReplies.set(key, turn);
    const type = normalizeText(item.type);
    const text = codexAppServerAssistantItemText(item);
    if (type === "agentMessage" && (method === "item/started" || text)) {
      turn.working = true;
      if (method === "item/started") return [];
      const reply = turn.owed;
      if (reply) {
        turn.owed = false;
        turn.replies.add(itemId);
      }
      const candidate = codexAppServerLiveProgressCandidate(notification);
      if (candidate && !candidate.phase && (reply || turn.waiting.length || !codexAppServerLiveProgressText(notification))) {
        turn.waiting.push(notification);
        turn.waitingIds.add(itemId);
      }
      return [];
    }
    const settled = turn.waiting;
    turn.waiting = [];
    if (type === "userMessage") {
      // The turn's own message opens it; one that arrives once it works was steered in.
      if (method === "item/completed") {
        turn.owed ||= turn.working;
        turn.working = true;
      }
    } else {
      turn.working = true;
    }
    return settled;
  }

  // Whether an agent message waits for the item that settles it (see observeCodexAppServerTurnItem).
  function codexAppServerAwaitsNextItem(sessionId = "", threadId = "", notification = {}) {
    const key = codexAppServerTurnRepliesKey(sessionId, threadId, codexAppServerNotificationTurnId(notification));
    return Boolean(codexAppServerTurnReplies.get(key)?.waitingIds.has(codexAppServerNotificationItemId(notification)));
  }

  function codexAppServerSteerReply(sessionId = "", threadId = "", notification = {}) {
    const key = codexAppServerTurnRepliesKey(sessionId, threadId, codexAppServerNotificationTurnId(notification));
    return Boolean(codexAppServerTurnReplies.get(key)?.replies.has(codexAppServerNotificationItemId(notification)));
  }

  function codexAppServerLiveProgressText(notification = {}) {
    const candidate = codexAppServerLiveProgressCandidate(notification);
    const text = normalizeText(candidate?.text);
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
    const normalizedRole = normalizeText(role);
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedText = normalizeText(text);
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
      let turnMetadata = null;
      if (normalizedRole === "user") {
        turnMetadata = await messageMetadata.terminal(store, normalizedSessionId) ?? null;
      }
      const message = {
        messageId: codexAppServerConversationMessageId(
          threadId,
          codexAppServerNotificationTurnId(notification),
          normalizedRole,
          normalizedText
        ),
        text: normalizedText,
        nativeIdentity: { threadId, turnId: codexAppServerNotificationTurnId(notification) },
        ...(turnMetadata ? { turnMetadata } : {})
      };
      written = normalizedRole === "user"
        ? await store.writeConversationUserMessage(normalizedSessionId, message)
        : await store.writeConversationAssistantMessage(normalizedSessionId, message);
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
        itemId: normalizeText(codexAppServerNotificationItem(notification)?.id),
        sessionId: normalizedSessionId,
        threadId: normalizeText(threadId),
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (codexAppServerLiveProgressCandidate(notification)?.explicit === true) {
      return;
    }
    const classification = classifyCodexAppServerEvent(notification);
    // Completed finals use the same native-item publication owner as UI chat.
    if (classification.kind === "final_assistant_result") {
      return;
    }
    const text = normalizeText(
      codexAppServerAssistantItemText(codexAppServerNotificationItem(notification))
    );
    if (!normalizedSessionId || !text) {
      return;
    }
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    if (normalizeText(run?.inputSource) !== "terminal") {
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

  async function writeCodexAppServerLiveProgress(sessionId = "", threadId = "", notification = {}, { settled = false } = {}) {
    // Phase-less providers also send short updates as agent messages. One
    // that waits for the next item is written once that item settles it as
    // progress (`settled`), whatever its length.
    // Reasoning items are recorded separately from these user-facing updates.
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!settled && codexAppServerAwaitsNextItem(normalizedSessionId, normalizedThreadId, notification)) {
      return null;
    }
    const candidate = codexAppServerLiveProgressCandidate(notification);
    // Commentary or a phase-less message that answers a steered message is that message's reply.
    const reply = persistCommentary && (!candidate?.phase || candidate.phase === "commentary") &&
      codexAppServerSteerReply(normalizedSessionId, normalizedThreadId, notification);
    const text = settled ? normalizeText(candidate?.text) : codexAppServerLiveProgressText(notification);
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
    // A terminal turn's agent messages are mirrored in full (mirrorCodexAppServerTerminalAssistantMessage).
    if (settled && normalizeText(run?.inputSource) === "terminal") {
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
      const progressRole = !candidate.phase || candidate.phase === "commentary" ? "commentary" : "thinking";
      const role = reply ? "assistant" : progressRole;
      const writer = reply ? store.writeConversationAssistantMessage
        : role === "commentary"
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
        reason: role === "thinking"
          ? "codex-app-server-live-progress"
          : "codex-app-server-commentary"
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
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
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
      codexAppServerMirroredTerminalItems,
      codexAppServerTurnReplies
    ]) {
      for (const key of set.keys()) {
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
    observeTurnItem: observeCodexAppServerTurnItem,
    writeMirroredTerminalMessage: writeMirroredCodexAppServerTerminalMessage,
    mirrorTerminalAssistantMessage: mirrorCodexAppServerTerminalAssistantMessage,
    forgetTurnItems: forgetCodexAppServerLiveTurnItems
  });
}
