import { codexAppServerTurnStateFromAgentRun } from "./codexTurn.js";
import { failure, stateErrorFields } from "./conversationRefusals.js";
import { hasMessages, isCompletedEnvelopeTurn } from "./transcript.js";

/** @typedef {import("./conversationEntries.js").ConversationEntry} ConversationEntry */
/** @typedef {import("./conversationEntries.js").ConversationState} ConversationState */

/** The authored message of a saved turn: a user's message, or the application's. */
const submittedMessage = turn => turn.user || turn.system;

/** Every runtime segment a saved state retains: its predecessors and itself, once each. */
const retainedSegments = state => [...new Map([...state.predecessors, state].map(segment => [segment.segmentId, segment])).values()];

// readable-check: allow method-probe - optional operation: a host's conversation transcript may offer paged history
const offersPages = entry => typeof entry.conversation.transcript.readConversationLogPage === "function";

/** The predecessor whose replacement still waits for its successor's first accepted message. */
const pendingSuccessor = state => state.engine !== "api" && state.predecessors.findLast(segment => segment.successorId === state.segmentId &&
  segment.segmentId !== state.segmentId && segment.replacement?.operation === "replace" && !segment.acceptedAt);

/**
 * What an open conversation reads: its capabilities, its transcript, and the snapshot a reader
 * sees. Nothing here changes the conversation.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationTranscript | null} dependencies.transcript
 * @param {import("../types.js").ConversationStreams} dependencies.streams
 * @param {boolean} dependencies.attachmentsOffered Whether the application resolves message attachments.
 * @param {boolean} dependencies.completedEnvelope
 */
function createConversationReads({ storage, transcript, streams, attachmentsOffered, completedEnvelope }) {
  /** @param {ConversationEntry} entry */
  function capabilities(entry) {
    const value = { ...entry.driver.capabilities, ...entry.provider?.capabilities,
      attachments: Boolean((attachmentsOffered || entry.conversation?.prepareInput || entry.conversation?.commands) && entry.driver.capabilities.attachments) };
    if (entry.conversation?.commands) {
      delete value.goalCommands;
      Object.assign(value, { goals: false, configuration: false, wake: false, replacement: false });
    }
    return value;
  }

  /**
   * The saved turns; `afterTurnId` reads only the turns a stored summary doesn't cover.
   * @param {ConversationEntry} entry
   * @param {string} [afterTurnId]
   */
  const readTranscript = (entry, afterTurnId = "") => entry.conversation
    ? entry.conversation.transcript.readConversationLog() : transcript.readConversationLog(entry.id, { afterTurnId });

  /**
   * The stored compaction summary, when it belongs to this history. A bound conversation's host
   * owns its transcript, so it has none.
   * @param {ConversationEntry} entry
   * @param {(turn: object) => boolean} inHistory
   */
  async function readSummary(entry, inHistory) {
    if (entry.conversation) return null;
    return storage.read(entry.id, async transaction => {
      const summary = await transaction.readSummary();
      const covered = summary && await transaction.readTurn(summary.throughTurnId);
      return covered && inHistory(covered) ? summary : null;
    });
  }

  /**
   * Identity lookups avoid reading the whole log when the transcript supports them. A bound host
   * may supply findSubmittedTurn(messageId) and readTurn(turnId).
   * @param {ConversationEntry} entry
   * @param {string} messageId
   */
  async function findSubmittedTurn(entry, messageId) {
    const find = entry.conversation ? entry.conversation.transcript.findSubmittedTurn : transcript.findSubmittedTurn &&
      (id => transcript.findSubmittedTurn(entry.id, id));
    if (typeof find === "function") return (await find(messageId)) || null;
    return (await readTranscript(entry)).find(turn => submittedMessage(turn)?.messageId === messageId) || null;
  }

  /**
   * @param {ConversationEntry} entry
   * @param {string} turnId
   */
  async function readBoundTurn(entry, turnId) {
    // readable-check: allow method-probe - optional operation: a host's conversation transcript may offer direct turn reads
    if (typeof entry.conversation.transcript.readTurn === "function") return (await entry.conversation.transcript.readTurn(turnId)) || null;
    return (await readTranscript(entry)).find(turn => turn.turnId === turnId) || null;
  }

  /**
   * One saved turn by its id, or null, without reading the rest of the transcript.
   * @param {ConversationEntry} entry
   * @param {string} turnId
   */
  async function readTurn(entry, turnId) {
    if (entry.conversation) return readBoundTurn(entry, turnId);
    const turn = await storage.read(entry.id, transaction => transaction.readTurn(turnId));
    return hasMessages(turn) ? turn : null;
  }

  /** @param {ConversationEntry} entry */
  async function lastTranscriptTurn(entry) {
    const page = entry.conversation && !offersPages(entry) ? null
      : entry.conversation ? await entry.conversation.transcript.readConversationLogPage({ limit: 1 })
        : await transcript.readConversationLogPage(entry.id, { limit: 1 });
    return page?.conversationLog.at(-1) || (await readTranscript(entry)).at(-1);
  }

  /**
   * @param {ConversationEntry} entry
   * @param {object} query
   */
  function readTranscriptPage(entry, query) {
    if (!entry.conversation) return transcript.readConversationLogPage(entry.id, { ...query, presentation: completedEnvelope });
    if (!offersPages(entry)) {
      throw failure("This conversation does not supply paged history.", "conversation_paged_history_unsupported", 400, { messageCode: "assistant.conversation.pagedHistoryUnsupported" });
    }
    return entry.conversation.transcript.readConversationLogPage(query);
  }

  /**
   * A bound conversation's own result, in its native representation.
   * @param {ConversationEntry} entry
   * @param {object} context
   */
  async function readNativeResult(entry, context) {
    const value = entry.driver.readState
      ? await entry.driver.readState({ conversation: entry.conversation, context, representation: "native" })
      : await entry.conversation.read(context, "native");
    return value.nativeResult;
  }

  /**
   * What a reader sees of a logical conversation, from the result of its own read.
   * @param {ConversationEntry} entry
   * @param {object} logical
   */
  async function logicalSnapshot(entry, logical) {
    const streaming = await entry.conversation.readStream();
    const error = logical.error || "";
    return {
      id: entry.id, engine: entry.engine, capabilities: capabilities(entry), configuration: logical.configuration,
      segmentId: logical.threadId ? `${logical.engine}:${logical.threadId}` : null,
      replacement: null,
      status: logical.status,
      phase: logical.phase || "",
      error,
      ...stateErrorFields(error),
      goal: entry.goal || null,
      pendingRequest: logical.pendingRequest || null,
      ...(logical.presentation ? { presentation: logical.presentation } : {}),
      conversationLog: logical.conversationLog.filter(turn => !turn.metadata?.runtime?.supersededBy),
      ...(logical.pagination ? { pagination: logical.pagination } : {}),
      streaming
    };
  }

  /**
   * What a reader sees of a conversation from its saved state: a page of its transcript, one turn
   * of it (`query.turnId`), or all of it, with the current turn's status, phase, error and live stream.
   * @param {ConversationEntry} entry
   * @param {ConversationState} state
   * @param {object} [query]
   */
  async function snapshot(entry, state, query) {
    const oneTurn = query?.turnId !== undefined;
    const page = oneTurn ? { conversationLog: [await readTurn(entry, query.turnId)]
      .filter(turn => turn && !(completedEnvelope && isCompletedEnvelopeTurn(turn))) }
      : query ? await readTranscriptPage(entry, query) : null;
    const conversationLog = page ? page.conversationLog
      : completedEnvelope ? await transcript.readConversationLog(entry.id, { presentation: true }) : await readTranscript(entry);
    // Browsing an older page, or reading one turn, does not change the current turn's control/error state.
    const latest = oneTurn ? [await lastTranscriptTurn(entry)].filter(Boolean)
      : completedEnvelope || query?.beforeTurnId
        ? entry.conversation ? (await readTranscriptPage(entry, { limit: 1 })).conversationLog
          : (await transcript.readConversationLogPage(entry.id, { limit: 1 })).conversationLog : conversationLog;
    const last = latest.at(-1)?.metadata?.runtime;
    const savedRequest = state.request;
    const nativeTurn = state.nativeTurn || (entry.driver.canonicalTranscript && state.binding?.codexAppServerRun
      ? codexAppServerTurnStateFromAgentRun(state.binding.codexAppServerRun) : null);
    const request = savedRequest && (entry.engine === "api" || savedRequest.attempted || savedRequest.inspectionOnly ||
      entry.active?.requests.has(savedRequest.messageId)) ? savedRequest : null;
    const streaming = entry.conversation ? await entry.conversation.readStream() : streams.read(entry.id);
    const error = entry.error || nativeTurn?.error || request?.error || last?.error || "";
    const pendingRequest = request && !(completedEnvelope && request.origin === "application" && request.completedEnvelope === true) ? Object.fromEntries([
      "messageId", "text", "origin", "data", "attachments", "at", "goal", "steering", "error"
    ].filter(name => Object.hasOwn(request, name)).map(name => [name, request[name]])) : null;
    if (pendingRequest?.error) Object.assign(pendingRequest, stateErrorFields(pendingRequest.error));
    return {
      id: entry.id, engine: entry.engine, capabilities: capabilities(entry), configuration: state.configuration,
      segmentId: state.segmentId,
      replacement: state.replacement ? { operationId: state.replacement.request?.operationId || state.replacement.operationId,
        reason: state.replacement.reason, segmentId: state.replacement.segmentId } : null,
      status: entry.storageFailure || entry.executionFailure ? "unavailable" : entry.active || nativeTurn?.active ? "working" : state.replacement ? "replacement-pending"
        : state.request && (entry.engine === "api" || state.request.attempted || state.request.inspectionOnly) ? "unconfirmed" : "ready",
      phase: entry.phase || (nativeTurn?.active && nativeTurn.status !== "observation_lost" ? ["compacting", "background"].includes(nativeTurn.phase) ? nativeTurn.phase : "working" : ""),
      error,
      ...stateErrorFields(error),
      goal: entry.goal || null,
      pendingRequest,
      conversationLog: conversationLog.filter(turn => !turn.metadata?.runtime?.supersededBy),
      ...(page?.pagination ? { pagination: page.pagination } : {}),
      streaming: completedEnvelope && !entry.conversation ? { ...streaming,
        messages: streaming.messages.filter(message => !(message.origin === "application" && message.completedEnvelope === true)) } : streaming
    };
  }

  return Object.freeze({
    capabilities,
    readTranscript,
    readSummary,
    findSubmittedTurn,
    readBoundTurn,
    lastTranscriptTurn,
    readTurn,
    readNativeResult,
    logicalSnapshot,
    snapshot
  });
}

/** @typedef {ReturnType<typeof createConversationReads>} ConversationReads */

export { createConversationReads, pendingSuccessor, retainedSegments, submittedMessage };
