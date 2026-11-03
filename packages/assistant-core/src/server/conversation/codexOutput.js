import { createCodexAppServerReasoning } from "./codexReasoning.js";
import { createCodexAppServerLiveItems, codexAppServerLiveProgressCandidate } from "./codexLiveItems.js";
import {
  normalizeCodexRunText,
  codexAppServerProcessedResultEvent,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerTurnAwaitsProviderIdentity,
  codexAppServerTurnCanReceiveProviderActivity,
  codexAppServerTurnKey,
  CODEX_APP_SERVER_AGENT_RUN_ID,
  codexAppServerRunInputSource,
  codexAppServerConversationMessageId
} from "./codexTurnState.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  codexAppServerAssistantItemText,
  codexAppServerNotificationItemId,
  codexAppServerNotificationTurnId
} from "./codexEvents.js";
import { codexAppServerProviderThreadAssistantSegments } from "./codexThreadSnapshot.js";

/**
 * Native output, reasoning persistence and exact-result identity. One instance belongs to each retained run owner;
 * its state is shared by reference.
 * @param {object} dependencies
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexCreateStore} dependencies.createStore
 * @param {import("./codexTurn.js").CodexPublish} dependencies.publish
 * @param {(input: { sessionId: string, runtime: any, session: object }) => Promise<any>} dependencies.acquireProvider
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 * @param {import("./codexTurn.js").CodexAgentRunTurnStateReader} dependencies.turnStateFromAgentRun
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 * @param {number} dependencies.liveProgressMaxLength
 * @param {boolean} [dependencies.persistCommentary]
 * @param {string} dependencies.storeReadError
 * @param {import("./codexTurn.js").CodexMessageMetadataHooks} dependencies.messageMetadata
 * @param {number} dependencies.snapshotRecoveryItemLimit
 */
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
  persistCommentary = true,
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
  const {
    liveProgressItems: codexAppServerLiveProgressItems,
    liveProgressFingerprints: codexAppServerLiveProgressFingerprints,
    mirroredTerminalItems: codexAppServerMirroredTerminalItems,
    writeLiveProgress: writeCodexAppServerLiveProgress,
    writeMirroredTerminalMessage: writeMirroredCodexAppServerTerminalMessage,
    mirrorTerminalAssistantMessage: mirrorCodexAppServerTerminalAssistantMessage,
    forgetTurnItems: forgetCodexAppServerLiveTurnItems
  } = createCodexAppServerLiveItems({
    createStore,
    publish,
    turnStateFromAgentRun,
    debugLog,
    readCodexAppServerAgentRunForSession,
    messageMetadata,
    persistCommentary,
    liveProgressMaxLength
  });

  function codexAppServerResultFinalizationKey(sessionId = "", threadId = "", turnId = "") {
    return [
      namespace(sessionId),
      codexAppServerTurnKey(threadId, turnId || "*")
    ].filter(Boolean).join(":");
  }

  async function readCodexAppServerAgentRunForSession(store, sessionId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    // readable-check: allow method-probe - input validation: the application's session store must read agent runs before output reads one
    if (typeof store?.readAgentRun !== "function") {
      throw new Error(storeReadError);
    }
    return store.readAgentRun(
      normalizedSessionId,
      CODEX_APP_SERVER_AGENT_RUN_ID
    );
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
    forgetCodexAppServerLiveTurnItems(threadId, turnId);
  }

  function codexAppServerStreamMessage(classification) {
    const messageId = codexAppServerConversationMessageId(
      classification.threadId, classification.turnId, "assistant-item", classification.itemId
    );
    return {
      nativeIdentity: { threadId: classification.threadId, turnId: classification.turnId },
      turnId: `${classification.threadId}:${classification.turnId}`,
      outputId: messageId,
      messageId,
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

  function codexAppServerSnapshotCursor(run) {
    const cursor = run?.providerSnapshotCursor;
    if (!isRecord(cursor)) {
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
      .filter((item) => isRecord(item) && normalizeCodexRunText(item.id));
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

  return Object.freeze({
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
  });
}

/** @typedef {ReturnType<typeof createCodexAppServerOutput>} CodexAppServerOutput */
