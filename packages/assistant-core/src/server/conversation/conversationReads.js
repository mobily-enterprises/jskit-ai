import { codexAppServerTurnStateFromAgentRun } from "./codexTurn.js";
import { conversationNativeBinding } from "./runtimeStateUpgrade.js";
import { failure, stateErrorFields } from "./conversationRefusals.js";
import { submittedMessage } from "./conversationRecords.js";

/**
 * What an open conversation reads: its capabilities, transcript, saved state and the
 * snapshot a reader sees.
 * @param {object} dependencies
 * @param {import("./storage.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("./transcript.js").ConversationTranscript | null} dependencies.transcript
 * @param {import("./streams.js").ConversationStreams} dependencies.streams
 * @param {import("./provider.js").ConversationProviderFactory} dependencies.providers
 * @param {import("../types.js").ConversationAttachments | undefined} dependencies.attachments
 * @param {boolean} dependencies.completedEnvelope
 */
function createConversationReads({ storage, transcript, streams, providers, attachments, completedEnvelope }) {
  function capabilities(entry) {
    const value = { ...entry.driver.capabilities, ...entry.provider?.capabilities,
      attachments: Boolean((attachments || entry.conversation?.prepareInput || entry.conversation?.commands) && entry.driver.capabilities.attachments) };
    if (entry.conversation?.commands) {
      delete value.goalCommands;
      Object.assign(value, { goals: false, configuration: false, wake: false, replacement: false });
    }
    return value;
  }

  // `afterTurnId` reads only the turns a stored summary doesn't cover.
  const readTranscript = (entry, afterTurnId = "") => entry.conversation
    ? entry.conversation.transcript.readConversationLog() : transcript.readConversationLog(entry.id, { afterTurnId });

  // The stored compaction summary, when it belongs to this history. A bound
  // conversation's host owns its transcript, so it has none.
  async function readSummary(entry, inHistory) {
    if (entry.conversation) return null;
    return storage.read(entry.id, async transaction => {
      const summary = await transaction.readSummary();
      const covered = summary && await transaction.readTurn(summary.throughTurnId);
      return covered && inHistory(covered) ? summary : null;
    });
  }

  // Identity lookups avoid reading the whole log when the transcript supports
  // them. A bound host may supply findSubmittedTurn(messageId) and readTurn(turnId).
  async function findSubmittedTurn(entry, messageId) {
    const find = entry.conversation ? entry.conversation.transcript.findSubmittedTurn : transcript.findSubmittedTurn &&
      (id => transcript.findSubmittedTurn(entry.id, id));
    if (typeof find === "function") return (await find(messageId)) || null;
    return (await readTranscript(entry)).find(turn => submittedMessage(turn)?.messageId === messageId) || null;
  }

  async function readBoundTurn(entry, turnId) {
    // readable-check: allow method-probe - optional operation: a host's conversation transcript may offer direct turn reads
    if (typeof entry.conversation.transcript.readTurn === "function") return (await entry.conversation.transcript.readTurn(turnId)) || null;
    return (await readTranscript(entry)).find(turn => turn.turnId === turnId) || null;
  }

  async function lastTranscriptTurn(entry) {
    // readable-check: allow method-probe - optional operation: a host's conversation transcript may offer paged history
    const page = entry.conversation && typeof entry.conversation.transcript.readConversationLogPage !== "function" ? null
      : entry.conversation ? await entry.conversation.transcript.readConversationLogPage({ limit: 1 })
        : await transcript.readConversationLogPage(entry.id, { limit: 1 });
    return page?.conversationLog.at(-1) || (await readTranscript(entry)).at(-1);
  }

  function readTranscriptPage(entry, query) {
    if (!entry.conversation) return transcript.readConversationLogPage(entry.id, { ...query, presentation: completedEnvelope });
    // readable-check: allow method-probe - optional operation: a host's conversation transcript may offer paged history
    if (typeof entry.conversation.transcript.readConversationLogPage !== "function") {
      throw failure("This conversation does not supply paged history.", "conversation_paged_history_unsupported", 400, { messageCode: "assistant.conversation.pagedHistoryUnsupported" });
    }
    return entry.conversation.transcript.readConversationLogPage(query);
  }

  // A bound native conversation keeps its original run, identity and delivery
  // files. This is a read projection, never a runtime-v3 record or a backfill.
  async function readState(entry, context) {
    if (!entry.conversation) return (await storage.read(entry.id, transaction => transaction.readMetadata())).runtime;
    const value = entry.conversation.native && entry.driver.readState
      ? await entry.driver.readState({ conversation: entry.conversation, context })
      : await entry.conversation.read(context);
    entry.segmentId = value.threadId ? `${entry.engine}:${value.threadId}` : null;
    const saved = value.delivery?.engines[entry.engine]?.pending;
    // The saved receipt is the delivery proof, as in changeover recovery. A
    // restart after native admission leaves only a stale attempt marker, which
    // must not leave the conversation unconfirmed until another message is sent.
    const pending = (saved?.attempted && !saved.inspectionOnly &&
      await entry.conversation.transcript.hasMessage(saved.messageId)) ? null : saved;
    return { engine: entry.engine, configuration: value.configuration, segmentId: entry.segmentId,
      binding: { ...conversationNativeBinding(entry.engine, value.threadId),
        ...(entry.engine === "codex" ? { codexAppServerRun: value.run } : {}) },
      nativeTurn: value.turn, nativeResult: value.nativeResult,
      lastEngine: value.delivery?.lastEngine ?? entry.engine,
      replacement: ["preparing", "ready"].includes(value.delivery?.replacement?.status) ? value.delivery.replacement : null,
      request: pending && { ...pending, text: pending.displayMessage, attachments: pending.displayAttachments || [] } };
  }

  async function read(entry, representation, context, query) {
    if (entry.conversation?.native?.scoped) return entry.provider.readNative({ input: query, context });
    if (representation === "native" && entry.conversation) {
      const value = entry.driver.readState
        ? await entry.driver.readState({ conversation: entry.conversation, context, representation })
        : await entry.conversation.read(context, representation);
      return value.nativeResult;
    }
    const logical = entry.conversation?.commands ? await entry.conversation.read(context, query) : null;
    if (logical && logical.engine !== entry.engine) {
      entry.engine = logical.engine;
      entry.driver = providers.createDriver(entry.engine, entry.host);
    }
    const metadata = { runtime: logical ? { configuration: logical.configuration,
      segmentId: logical.threadId ? `${logical.engine}:${logical.threadId}` : null } : await readState(entry, context) };
    if (representation === "native") return metadata.runtime.nativeResult;
    const page = logical ? logical.pagination ? { conversationLog: logical.conversationLog, pagination: logical.pagination } : null
      : query ? await readTranscriptPage(entry, query) : null;
    const conversationLog = logical ? logical.conversationLog : page ? page.conversationLog
      : completedEnvelope ? await transcript.readConversationLog(entry.id, { presentation: true }) : await readTranscript(entry);
    // Browsing an older page does not change the current turn's control/error state.
    const latest = !logical && (completedEnvelope || query?.beforeTurnId)
      ? entry.conversation ? (await readTranscriptPage(entry, { limit: 1 })).conversationLog
        : (await transcript.readConversationLogPage(entry.id, { limit: 1 })).conversationLog : conversationLog;
    const last = latest.at(-1)?.metadata?.runtime;
    const savedRequest = metadata.runtime.request;
    const nativeTurn = metadata.runtime.nativeTurn || (entry.driver.canonicalTranscript && metadata.runtime.binding?.codexAppServerRun
      ? codexAppServerTurnStateFromAgentRun(metadata.runtime.binding.codexAppServerRun) : null);
    const request = savedRequest && (entry.engine === "api" || savedRequest.attempted || savedRequest.inspectionOnly ||
      entry.active?.requests.has(savedRequest.messageId)) ? savedRequest : null;
    const streaming = entry.conversation ? await entry.conversation.readStream() : streams.read(entry.id);
    const error = logical ? logical.error || "" : entry.error || nativeTurn?.error || request?.error || last?.error || "";
    const pendingRequest = request && !(completedEnvelope && request.origin === "application" && request.completedEnvelope === true) ? Object.fromEntries([
      "messageId", "text", "origin", "data", "attachments", "at", "goal", "steering", "error"
    ].filter(name => Object.hasOwn(request, name)).map(name => [name, request[name]])) : null;
    if (pendingRequest?.error) Object.assign(pendingRequest, stateErrorFields(pendingRequest.error));
    return {
      id: entry.id, engine: entry.engine, capabilities: capabilities(entry), configuration: metadata.runtime.configuration,
      segmentId: metadata.runtime.segmentId,
      replacement: metadata.runtime.replacement ? { operationId: metadata.runtime.replacement.request?.operationId || metadata.runtime.replacement.operationId,
        reason: metadata.runtime.replacement.reason, segmentId: metadata.runtime.replacement.segmentId } : null,
      status: logical ? logical.status : entry.storageFailure || entry.executionFailure ? "unavailable" : entry.active || nativeTurn?.active ? "working" : metadata.runtime.replacement ? "replacement-pending"
        : metadata.runtime.request && (entry.engine === "api" || metadata.runtime.request.attempted || metadata.runtime.request.inspectionOnly) ? "unconfirmed" : "ready",
      phase: logical ? logical.phase || "" : entry.phase || (nativeTurn?.active && nativeTurn.status !== "observation_lost" ? ["compacting", "background"].includes(nativeTurn.phase) ? nativeTurn.phase : "working" : ""),
      error,
      ...stateErrorFields(error),
      goal: entry.goal || null,
      pendingRequest: logical ? logical.pendingRequest || null : pendingRequest,
      ...(logical?.presentation ? { presentation: logical.presentation } : {}),
      conversationLog: conversationLog.filter(turn => !turn.metadata?.runtime?.supersededBy),
      ...(page ? { pagination: page.pagination } : {}),
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
    readState,
    read
  });
}

/** @typedef {ReturnType<typeof createConversationReads>} ConversationReads */

export { createConversationReads };
