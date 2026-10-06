import { createCodexAppServerReasoning } from "./codexReasoning.js";
import {
  normalizeCodexRunText,
  codexAppServerProcessedResultEvent,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerTurnAwaitsProviderIdentity,
  codexAppServerTurnCanReceiveProviderActivity,
  codexAppServerTurnKey,
  CODEX_APP_SERVER_AGENT_RUN_ID,
  codexAppServerRunInputSource
} from "./codexTurnState.js";
import crypto from "node:crypto";
import { isPlainObject } from "./normalize.js";
import {
  codexAppServerAssistantItemText,
  classifyCodexAppServerEvent,
  codexAppServerContentText,
  codexAppServerNotificationEvent,
  codexAppServerNotificationEventType,
  codexAppServerNotificationEventPayload,
  codexAppServerNotificationItem,
  codexAppServerNotificationItemId,
  codexAppServerNotificationTurnId,
  codexAppServerProviderThreadAssistantSegments
} from "./codexEvents.js";

// Original native output, reasoning persistence and exact-result identity.
// One instance belongs to each retained run owner; its state is shared by reference.
export function createCodexAppServerOutput({
  namespace,
  createRuntime,
  createStore,
  publish,
  acquireProvider,
  turnState,
  turnStateFromAgentRun,
  debugLog,
  debugError,
  liveProgressMaxLength,
  storeReadError,
  messageMetadata,
  snapshotRecoveryItemLimit
}) {
  const codexAppServerFinalizedTurns = new Set();
  const codexAppServerFinalAssistantResults = new Map();
  const {
    reasoningTurns: codexAppServerReasoningTurns,
    reasoningPersistQueues: codexAppServerReasoningPersistQueues,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    readReasoningText: readCodexAppServerReasoningText,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    cleanupReasoningTurn: cleanupCodexAppServerReasoningTurn,
    splitReasoningTurn: splitCodexAppServerReasoningTurn
  } = createCodexAppServerReasoning({
    createStore,
    publish,
    turnStateFromAgentRun,
    debugLog,
    readCodexAppServerAgentRunForSession
  });
  const codexAppServerLiveProgressItems = new Set();
  const codexAppServerLiveProgressFingerprints = new Set();
  const codexAppServerMirroredTerminalItems = new Set();

  function codexAppServerResultFinalizationKey(sessionId = "", threadId = "", turnId = "") {
    return [
      namespace(sessionId),
      codexAppServerTurnKey(threadId, turnId || "*")
    ].filter(Boolean).join(":");
  }

  function codexAppServerLiveProgressCandidate(notification = {}) {
    const method = normalizeCodexRunText(notification.method);
    const event = codexAppServerNotificationEvent(notification);
    if (isPlainObject(event)) {
      const eventType = codexAppServerNotificationEventType(notification, event);
      const payload = codexAppServerNotificationEventPayload(notification, event);
      const payloadType = normalizeCodexRunText(payload.type);
      const phase = normalizeCodexRunText(payload.phase || event.phase);
      if (eventType === "event_msg" && payloadType === "agent_message" && phase && phase !== "final_answer") {
        return {
          explicit: Boolean(phase),
          phase,
          source: "event",
          text: normalizeCodexRunText(
            codexAppServerContentText(payload.message) ||
            codexAppServerContentText(payload.text) ||
            codexAppServerContentText(payload.content)
          )
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

  function codexAppServerConversationMessageId(
    threadId = "",
    turnId = "",
    role = "",
    text = ""
  ) {
    const normalizedText = normalizeCodexRunText(text);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    if (!normalizedText || !normalizedThreadId) {
      return "";
    }
    const digest = crypto.createHash("sha256")
      .update([
        normalizedThreadId,
        normalizeCodexRunText(turnId) || "*",
        normalizeCodexRunText(role),
        normalizedText
      ].join("\u0000"))
      .digest("hex");
    return `codex-${digest}`;
  }

  async function readCodexAppServerAgentRunForSession(store, sessionId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    if (typeof store?.readAgentRun !== "function") {
      throw new Error(storeReadError);
    }
    return store.readAgentRun(
      normalizedSessionId,
      CODEX_APP_SERVER_AGENT_RUN_ID
    );
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
      if (normalizedRole === "user" && typeof store.readConversationLog === "function") {
        turnMetadata = await messageMetadata.terminal?.(store, normalizedSessionId) ?? null;
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

  function readCodexAppServerFinalAssistantResult(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return null;
    }
    return codexAppServerFinalAssistantResults.get(
      codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId)
    ) || null;
  }

  async function persistCodexAppServerAssistantReply(runtime, sessionId = "", record = {}, streamItemId = "", outputItemId = streamItemId || record.itemId) {
    if (record.conversationTurn && !streamItemId) {
      return record.conversationTurn;
    }
    const conversationText = normalizeCodexRunText(record.text);
    if (!conversationText) {
      return null;
    }
    const messageId = codexAppServerConversationMessageId(
      record.threadId, record.turnId, "assistant-item", record.itemId
    );
    let written = record.conversationTurn || await runtime.store.writeConversationAssistantMessage(sessionId, {
      messageId,
      outputId: codexAppServerConversationMessageId(
        record.threadId, record.turnId, "assistant-item", outputItemId
      ),
      nativeIdentity: { threadId: record.threadId, turnId: record.turnId },
      text: conversationText
    });
    if (!written) {
      // A replay or correction belongs to its original row, including after restart.
      written = (await runtime.store.readConversationLog(sessionId))
        .find((turn) => turn.assistant?.messageId === messageId);
      if (!written) {
        throw new Error("The saved Codex reply could not be found.");
      }
      if (written.assistant.text !== conversationText) {
        written = await runtime.store.upsertConversationAssistantMessage(sessionId, {
          text: conversationText,
          nativeIdentity: { threadId: record.threadId, turnId: record.turnId },
          turnId: written.turnId
        });
      }
    }
    if (streamItemId) {
      runtime.store.completeConversationStreamMessage(sessionId, codexAppServerConversationMessageId(
        record.threadId, record.turnId, "assistant-item", streamItemId
      ));
    }
    await publish(sessionId, {
      payload: {
        conversationStream: runtime.store.completeConversationStreamMessage(sessionId, messageId),
        conversationLogPatch: {
          turn: written,
          type: "upsert-turn"
        }
      },
      reason: "assistant-response-bundle"
    });
    record.conversationTurn = written;
    debugLog("appServerAssistantResponseBundle.persisted", {
      conversationTurnId: normalizeCodexRunText(written.turnId),
      sessionId: normalizeCodexRunText(sessionId),
      textLength: conversationText.length,
      threadId: normalizeCodexRunText(record.threadId),
      turnId: normalizeCodexRunText(record.turnId)
    });
    return written;
  }

  async function recordCodexAppServerFinalAssistantResult({
    itemId = "",
    notification = {},
    sessionId = "",
    source = "",
    streamItemId = "",
    outputItemId,
    text = "",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const assistantText = normalizeCodexRunText(text);
    const normalizedItemId = normalizeCodexRunText(itemId) || codexAppServerNotificationItemId(notification);
    if (!normalizedSessionId || !normalizedThreadId || !assistantText || !normalizedItemId) {
      return {
        recorded: false,
        reason: normalizedItemId ? "empty" : "missing_item_id"
      };
    }

    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const currentTurn = turnState(session);
    const currentTurnId = normalizeCodexRunText(currentTurn.turnId);
    const normalizedTurnId = normalizeCodexRunText(turnId) || codexAppServerNotificationTurnId(notification);
    if (!normalizedTurnId) {
      return { recorded: false, reason: "missing_turn_id" };
    }
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const existing = codexAppServerFinalAssistantResults.get(key) || null;
    if (
      !existing &&
      codexAppServerTurnAwaitsProviderIdentity(currentTurn, normalizedThreadId, normalizedTurnId)
    ) {
      return {
        recorded: false,
        reason: "turn_identity_pending",
        turnId: normalizedTurnId
      };
    }
    const completedOwnedTurn = Boolean(codexAppServerProcessedResultEvent(session, normalizedThreadId, normalizedTurnId));
    const stoppedRecovery = source === "provider-recovery" &&
      currentTurn.status === "observation_lost" &&
      currentTurn.threadId === normalizedThreadId &&
      currentTurnId === normalizedTurnId &&
      !currentTurn.active;
    if (
      !existing && !completedOwnedTurn && !stoppedRecovery &&
      !codexAppServerTurnCanReceiveProviderCompletion(currentTurn, normalizedThreadId, normalizedTurnId)
    ) {
      if (!codexAppServerFinalizedTurns.has(key)) {
        codexAppServerFinalizedTurns.add(key);
        debugLog("appServerAgentResult.stale", {
          currentState: currentTurn.state,
          currentStatus: currentTurn.status,
          currentThreadId: currentTurn.threadId,
          currentTurnId: currentTurn.turnId,
          sessionId: normalizedSessionId,
          source: normalizeCodexRunText(source),
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      return {
        recorded: false,
        reason: "stale_turn_state",
        turnId: normalizedTurnId
      };
    }

    if (source !== "provider-recovery") {
      // Live item IDs and saved-history IDs differ in native Codex threads.
      // Only saved history supplies durable replies; a live completion triggers
      // that read and retires its provisional stream in the same publication.
      const segments = await recoverCodexAppServerAssistantSegmentsFromProvider(
        normalizedSessionId, normalizedThreadId, normalizedTurnId
      );
      if (!segments.length) throw new Error("Codex's completed reply is missing from its saved turn.");
      // A history read can already include a later native reply. Keep each exact
      // native item identity separate from the original last-publication retirement.
      const sameNativeItem = segments.some(segment => segment.itemId === normalizedItemId);
      let result;
      for (const segment of segments) {
        result = await recordCodexAppServerFinalAssistantResult({
          ...segment,
          sessionId: normalizedSessionId,
          source: "provider-recovery",
          streamItemId: segment === segments.at(-1) ? normalizedItemId : "",
          outputItemId: sameNativeItem ? segment.itemId : undefined,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      return result;
    }
    if (existing?.itemId === normalizedItemId && existing.text === assistantText && existing.conversationTurn) {
      if (streamItemId) await persistCodexAppServerAssistantReply(runtime, normalizedSessionId, existing, streamItemId, outputItemId);
      return { ...existing, recorded: true, reason: "duplicate" };
    }
    const record = {
      itemId: normalizedItemId,
      source: normalizeCodexRunText(source),
      text: assistantText,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    };
    codexAppServerFinalAssistantResults.set(key, record);

    try {
      await persistCodexAppServerAssistantReply(runtime, normalizedSessionId, record, streamItemId, outputItemId);
      debugLog("appServerFinalAssistantResult.recorded", {
        itemId: record.itemId,
        sessionId: normalizedSessionId,
        source: record.source,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ...record,
        recorded: true,
        reason: existing ? "updated" : "recorded"
      };
    } catch (error) {
      if (existing) {
        codexAppServerFinalAssistantResults.set(key, existing);
      } else {
        codexAppServerFinalAssistantResults.delete(key);
      }
      throw error;
    }
  }

  function cleanupCodexAppServerUntrackedTurn(threadId = "", turnId = "") {
    cleanupCodexAppServerReasoningTurn(threadId, turnId);
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

  function codexAppServerStreamMessage(classification) {
    return {
      nativeIdentity: { threadId: classification.threadId, turnId: classification.turnId },
      turnId: `${classification.threadId}:${classification.turnId}`,
      outputId: codexAppServerConversationMessageId(
        classification.threadId, classification.turnId, "assistant-item", classification.itemId
      ),
      messageId: codexAppServerConversationMessageId(
        classification.threadId, classification.turnId, "assistant-item", classification.itemId
      ),
      role: classification.role,
      delta: classification.delta
    };
  }

  async function writeCodexAppServerStream(sessionId, classification) {
    if (!classification.itemId || !classification.turnId) return;
    const store = await createStore(sessionId);
    const conversationStream = await store.mutateSession(sessionId, async () => {
      const run = await readCodexAppServerAgentRunForSession(store, sessionId);
      const turn = turnStateFromAgentRun(run || {});
      if (!codexAppServerTurnCanReceiveProviderActivity(turn, classification.threadId, classification.turnId)) return null;
      return store.updateConversationStream(sessionId, codexAppServerStreamMessage(classification));
    });
    if (conversationStream) {
      await publish(sessionId, {
        payload: { conversationStream },
        reason: "assistant-stream"
      });
    }
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
    if (!codexAppServerTurnCanReceiveProviderActivity(
      turn,
      normalizedThreadId,
      codexAppServerNotificationTurnId(notification)
    )) {
      return null;
    }
    const key = codexAppServerLiveProgressKey(normalizedSessionId, normalizedThreadId, notification);
    if (!key) {
      return null;
    }
    const fingerprintKey = codexAppServerLiveProgressFingerprintKey(
      normalizedSessionId,
      normalizedThreadId,
      codexAppServerNotificationTurnId(notification) || turn.turnId,
      text
    );
    const streamMessageId = codexAppServerConversationMessageId(
      normalizedThreadId, codexAppServerNotificationTurnId(notification),
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
      written = await writer.call(store, normalizedSessionId, {
        ...(streamMessageId ? { outputId: streamMessageId } : {}),
        messageId: codexAppServerConversationMessageId(
          normalizedThreadId,
          codexAppServerNotificationTurnId(notification) || turn.turnId,
          role,
          text
        ),
        requireOpenTurn: false,
        nativeIdentity: { threadId: normalizedThreadId, turnId: codexAppServerNotificationTurnId(notification) || turn.turnId },
        text
      });
      if (!written) {
        codexAppServerLiveProgressItems.delete(key);
        codexAppServerLiveProgressFingerprints.delete(fingerprintKey);
      }
      const payload = {
        conversationStream: store.completeConversationStreamMessage(normalizedSessionId, streamMessageId)
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

  async function recoverCodexAppServerAssistantSegmentsFromProvider(sessionId = "", threadId = "", turnId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return [];
    }
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const provider = await acquireProvider({ sessionId: normalizedSessionId, runtime, session });
    if (!provider) {
      return [];
    }
    // Page from the newest turn instead of hydrating the entire conversation.
    // A goal may already have started its successor when completion arrives.
    let cursor;
    let assistantSegments = [];
    do {
      const page = await provider.listThreadTurns(normalizedThreadId, {
        limit: 1, itemsView: "full", sortDirection: "desc", ...(cursor ? { cursor } : {})
      });
      const turn = page.data.find((candidate) => candidate.id === normalizedTurnId);
      if (turn) {
        assistantSegments = codexAppServerProviderThreadAssistantSegments({ turns: [turn] }, normalizedTurnId);
        break;
      }
      cursor = page.nextCursor;
    } while (cursor);
    if (assistantSegments.length) {
      debugLog("appServerAgentResult.recovered", {
        assistantSegmentCount: assistantSegments.length,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    return assistantSegments;
  }

  async function submitCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
    recoverFromProvider = false
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    let finalResult = readCodexAppServerFinalAssistantResult(normalizedSessionId, threadId, turnId);
    let assistantText = normalizeCodexRunText(finalResult?.text);
    const reasoningText = readCodexAppServerReasoningText(threadId, turnId);
    try {
      if (normalizedSessionId && recoverFromProvider) {
        const recoveredSegments = await recoverCodexAppServerAssistantSegmentsFromProvider(
          normalizedSessionId,
          threadId,
          turnId
        );
        for (const recoveredSegment of recoveredSegments) {
          await recordCodexAppServerFinalAssistantResult({
            itemId: recoveredSegment.itemId,
            sessionId: normalizedSessionId,
            source: "provider-recovery",
            text: recoveredSegment.text,
            threadId,
            turnId
          });
        }
        if (recoveredSegments.length) {
          finalResult = readCodexAppServerFinalAssistantResult(normalizedSessionId, threadId, turnId);
          assistantText = normalizeCodexRunText(finalResult?.text);
        }
      }
      if (!normalizedSessionId || !assistantText && !reasoningText) {
        return {
          ok: false,
          processed: false,
          reason: "empty"
        };
      }
      const runtime = await createRuntime();
      if (reasoningText) {
        await flushCodexAppServerReasoningPersist(normalizedSessionId, threadId, turnId);
      }
      if (!assistantText) {
        return {
          ok: true,
          processed: false,
          reason: "missing_assistant_text"
        };
      }
      await persistCodexAppServerAssistantReply(runtime, normalizedSessionId, finalResult);
      return {
        ok: true,
        processed: true,
        reason: "assistant_response"
      };
    } catch (error) {
      debugLog("appServerAgentResult.error", {
        error: debugError(error),
        sessionId: normalizedSessionId,
        threadId: normalizeCodexRunText(threadId),
        turnId: normalizeCodexRunText(turnId)
      });
      return {
        error: normalizeCodexRunText(error?.error || error?.message || error) || "Codex app-server response could not be processed.",
        ok: false,
        processed: false,
        reason: "error"
      };
    } finally {
      cleanupCodexAppServerReasoningTurn(threadId, turnId);
    }
  }

  function codexAppServerSnapshotCursor(run = {}) {
    const cursor = run?.providerSnapshotCursor;
    if (!isPlainObject(cursor)) {
      return {
        itemId: "",
        turnId: ""
      };
    }
    return {
      itemId: normalizeCodexRunText(cursor.itemId),
      turnId: normalizeCodexRunText(cursor.turnId)
    };
  }

  async function recordCodexAppServerSnapshotCursor(store, sessionId = "", {
    itemId = "",
    turnId = ""
  } = {}) {
    const normalizedItemId = normalizeCodexRunText(itemId);
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedItemId || !normalizedSessionId || !normalizedTurnId) {
      return;
    }
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    const current = codexAppServerSnapshotCursor(run);
    if (current.itemId === normalizedItemId && current.turnId === normalizedTurnId) {
      return;
    }
    await store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "codex-app-server-thread-snapshot-observed",
        message: "",
        providerThreadId: turnStateFromAgentRun(run || {}).threadId,
        providerTurnId: normalizedTurnId
      },
      patch: {
        providerSnapshotCursor: {
          itemId: normalizedItemId,
          turnId: normalizedTurnId
        }
      }
    });
  }

  async function reconcileCodexAppServerObservedTurnItems(
    sessionId = "",
    threadId = "",
    observedTurn = null,
    provider = null
  ) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(observedTurn?.id);
    const items = (Array.isArray(observedTurn?.items) ? observedTurn.items : [])
      .filter((item) => isPlainObject(item) && normalizeCodexRunText(item.id));
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId || !items.length) {
      return;
    }
    try {
      const store = await createStore(normalizedSessionId);
      const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
      for (const segment of codexAppServerProviderThreadAssistantSegments({ turns: [observedTurn] }, normalizedTurnId)) {
        await recordCodexAppServerFinalAssistantResult({
          ...segment,
          sessionId: normalizedSessionId,
          source: "provider-recovery",
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
      }
      if (codexAppServerRunInputSource(run) !== "terminal") {
        return;
      }
      const cursor = codexAppServerSnapshotCursor(run);
      const cursorIndex = cursor.turnId === normalizedTurnId
        ? items.findIndex((item) => normalizeCodexRunText(item.id) === cursor.itemId)
        : -1;
      const unseenItems = cursorIndex >= 0
        ? items.slice(cursorIndex + 1)
        : items.slice(-snapshotRecoveryItemLimit);
      for (const item of unseenItems) {
        if (!codexAppServerAssistantItemText(item)) {
          continue;
        }
        const notification = {
          method: "item/completed",
          params: {
            item,
            threadId: normalizedThreadId,
            turnId: normalizedTurnId
          }
        };
        await writeCodexAppServerLiveProgress(
          normalizedSessionId,
          normalizedThreadId,
          notification
        );
        await mirrorCodexAppServerTerminalAssistantMessage(
          normalizedSessionId,
          normalizedThreadId,
          notification
        );
      }
      await recordCodexAppServerSnapshotCursor(store, normalizedSessionId, {
        itemId: normalizeCodexRunText(items.at(-1)?.id),
        turnId: normalizedTurnId
      });
    } catch (error) {
      await provider.failObservation(error);
      throw error;
    }
  }

  return {
    finalizedTurns: codexAppServerFinalizedTurns,
    finalAssistantResults: codexAppServerFinalAssistantResults,
    reasoningTurns: codexAppServerReasoningTurns,
    reasoningPersistQueues: codexAppServerReasoningPersistQueues,
    liveProgressItems: codexAppServerLiveProgressItems,
    liveProgressFingerprints: codexAppServerLiveProgressFingerprints,
    mirroredTerminalItems: codexAppServerMirroredTerminalItems,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    liveProgressCandidate: codexAppServerLiveProgressCandidate,
    conversationMessageId: codexAppServerConversationMessageId,
    readAgentRunForSession: readCodexAppServerAgentRunForSession,
    readFinalAssistantResult: readCodexAppServerFinalAssistantResult,
    persistAssistantReply: persistCodexAppServerAssistantReply,
    recordFinalAssistantResult: recordCodexAppServerFinalAssistantResult,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    splitReasoningTurn: splitCodexAppServerReasoningTurn,
    cleanupUntrackedTurn: cleanupCodexAppServerUntrackedTurn,
    streamMessage: codexAppServerStreamMessage,
    writeStream: writeCodexAppServerStream,
    writeLiveProgress: writeCodexAppServerLiveProgress,
    submitAssistantResult: submitCodexAppServerAssistantResult,
    writeMirroredTerminalMessage: writeMirroredCodexAppServerTerminalMessage,
    mirrorTerminalAssistantMessage: mirrorCodexAppServerTerminalAssistantMessage,
    reconcileObservedTurnItems: reconcileCodexAppServerObservedTurnItems
  };
}
