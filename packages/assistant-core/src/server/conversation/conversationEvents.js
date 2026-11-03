import { isCompletedEnvelopeTurn } from "./transcript.js";
import { failure } from "./conversationRefusals.js";
import { submittedMessage } from "./conversationReads.js";

/** @typedef {import("./conversationEntries.js").ConversationEntry} ConversationEntry */

/**
 * Runs one conversation entry's operations in order: each waits for the one before it.
 * @param {ConversationEntry} entry
 * @param {() => unknown} callback
 */
function serial(entry, callback) {
  const operation = entry.pending.then(callback);
  entry.pending = operation.catch(() => {});
  return operation;
}

/**
 * Who may use an open conversation, and what its subscribers hear: authorization for each
 * operation, events, the phase, and the publications of a provider or host.
 * @param {object} dependencies
 * @param {import("../types.js").ConversationAuthorize} dependencies.authorize
 * @param {() => boolean} dependencies.isClosed Whether the runtime has closed.
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationStreams} dependencies.streams
 * @param {boolean} dependencies.completedEnvelope
 */
function createConversationEvents({ authorize, isClosed, storage, streams, completedEnvelope }) {
  /**
   * Send and its immediate admission share one authorization. Dispatch, receipt admission and
   * every other operation authorize again.
   * @param {object} context
   * @param {string} id
   * @param {string} operation
   * @param {ConversationEntry} [entry]
   * @param {Set<string>} [grant] The operations this call already authorized.
   */
  async function access(context, id, operation, entry, grant) {
    if (isClosed() || entry?.disposed) throw failure("This conversation handle is closed.", "conversation_handle_closed", 409, { messageCode: "assistant.conversation.handleClosed" });
    if (!grant?.has(operation)) {
      if (!await authorize({ context, conversationId: id, operation })) {
        throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
      }
      grant?.add(operation);
    }
    if (isClosed() || entry?.disposed) throw failure("This conversation handle is closed.", "conversation_handle_closed", 409, { messageCode: "assistant.conversation.handleClosed" });
  }

  /**
   * @param {ConversationEntry} entry
   * @param {object} event
   * @param {() => boolean} [isCurrent] Whether the event still belongs to the current turn.
   */
  async function emit(entry, event, isCurrent) {
    const { completedEnvelope: _untrustedMarker, ...payload } = event;
    if (payload.type === "message" && ["assistant", "commentary", "thinking"].includes(payload.role) && payload.text?.trim()) {
      // Bound live streams deliberately omit private native turn identities.
      // Their current admitted request owns them; historical rows retain IDs.
      let request;
      if (payload.turnId) {
        request = [...(entry.active?.requests.values() || [])].find(request =>
          !request.sealed && (request.turnId === payload.turnId || request.nativeTurnId === payload.turnId));
      } else if (entry.conversation) {
        const current = entry.active?.request;
        if (current?.accepted && !current.sealed) request = current;
      }
      request?.deliveryTiming("first-response");
    }
    if (completedEnvelope && !entry.conversation) {
      const request = payload.messageId && entry.active?.requests.get(payload.messageId) ||
        payload.turnId && [...(entry.active?.requests.values() || [])].find(request => request.turnId === payload.turnId);
      let marked = isCompletedEnvelopeTurn(payload.patch?.turn) ||
        request?.completedEnvelope === true && request.input.origin === "application";
      if (!marked && payload.turnId) {
        try { marked = await storage.read(entry.id, async transaction => isCompletedEnvelopeTurn(await transaction.readTurn(payload.turnId))); }
        catch { /* An unavailable receipt cannot establish presentation custody. */ }
      }
      if (!marked && payload.type === "message") marked =
        [...(payload.streaming?.messages || []), ...(payload.streaming?.completedMessages || [])]
          .some(message => message.messageId === payload.messageId && message.completedEnvelope === true && message.origin === "application");
      if (marked) payload.completedEnvelope = true;
    }
    await Promise.all([...entry.listeners].map(async subscription => {
      try { await access(subscription.context, entry.id, "subscribe", entry); }
      catch { entry.listeners.delete(subscription); return; }
      if (isCurrent && !isCurrent()) return;
      // Presentation failures cannot interrupt persistence or provider work.
      try { Promise.resolve(subscription.listener(structuredClone({ conversationId: entry.id, ...payload }))).catch(() => {}); }
      catch { /* A failed observer does not own the conversation. */ }
    }));
  }

  /**
   * @param {ConversationEntry} entry
   * @param {string} phase
   * @param {string} [turnId]
   */
  async function setPhase(entry, phase, turnId) {
    if (!["", "preparing", "working", "compacting", "retrying", "background"].includes(phase)) throw new Error("Invalid conversation phase from the engine adapter.");
    if ((entry.phase || "") === phase) return;
    entry.phase = phase;
    await emit(entry, { type: "phase", phase, turnId });
  }

  /**
   * A publication of the entry's provider or host.
   * @param {ConversationEntry} entry
   * @param {object} event
   */
  async function publish(entry, event) {
    if (entry.disposed) return;
    const publicationOwner = entry.bindingOwner;
    const publicationSegment = entry.segmentId;
    const publicationActive = entry.active;
    // A native-backed bound conversation also uses configuration as a browser
    // invalidation. It has no command facade, but owns the same subscriptions.
    if (entry.conversation && (event.type === "configuration" || entry.conversation.commands && event.type === "phase")) {
      return emit(entry, event);
    }
    const payload = event.payload || {};
    if (Object.hasOwn(payload, "goal")) {
      entry.goal = payload.goal;
      await emit(entry, { type: "goal", goal: entry.goal });
    } else if (event.goalChanged) {
      await emit(entry, { type: "goal" });
    }
    const turn = payload.conversationLogPatch?.turn;
    if (turn) {
      await emit(entry, { type: "transcript", patch: payload.conversationLogPatch,
        ...(payload.conversationStream ? { streaming: payload.conversationStream } : {}) });
      const authored = submittedMessage(turn);
      const request = authored && entry.active?.requests.get(authored.messageId);
      // The original receipt already owns this row. Common admission is
      // still resolved by the dispatch continuation outside its queue.
      if (request) request.turnId = turn.turnId;
      for (const message of turn.messages || []) {
        if (!["assistant", "commentary", "thinking"].includes(message.role)) continue;
        await emit(entry, { type: "message", turnId: turn.turnId, messageId: message.messageId,
          ...(message.outputId ? { outputId: message.outputId } : {}),
          ...(["user", "application"].includes(turn.metadata?.runtime?.origin) ? { origin: turn.metadata.runtime.origin } : {}),
          role: message.role, text: message.text, at: message.at, status: "complete", persisted: true,
          streaming: payload.conversationStream || streams.read(entry.id) });
      }
    }
    if (payload.conversationStream) {
      const snapshot = payload.conversationStream;
      for (const message of snapshot.completedMessages || []) {
        if (turn?.messages?.some(saved => saved.messageId === message.messageId ||
          (message.outputId && saved.outputId === message.outputId))) continue;
        const request = publicationActive && [...publicationActive.requests.values()].find(request => request.turnId === message.turnId);
        const isCurrent = () => !entry.disposed && !request?.sealed && entry.active === publicationActive &&
          entry.bindingOwner === publicationOwner && entry.segmentId === publicationSegment;
        if (!request || !isCurrent()) continue;
        if (!request.admissionPublished) {
          request.progress.set(message.messageId, message);
          continue;
        }
        await emit(entry, { type: "message", ...message, streaming: snapshot }, isCurrent);
      }
      for (const message of snapshot.messages) {
        await emit(entry, { type: "message", ...message, streaming: snapshot });
      }
      if (!snapshot.messages.length) await emit(entry, { type: "message-complete", streaming: snapshot });
    }
    const nativeTurn = payload.agentSession?.turn;
    if (nativeTurn) {
      entry.nativePhase = nativeTurn.active
        ? ["preparing", "compacting", "retrying", "background"].includes(nativeTurn.phase) ? nativeTurn.phase : "working"
        : "";
      const request = entry.active?.request;
      if (!entry.active || request.accepted) {
        if (request?.deliveryCommitted) {
          try { await request.deliveryCommitted; }
          catch { return; } // Admission owns this failure; native cleanup must still settle.
        }
        await setPhase(entry, entry.nativePhase, request?.turnId);
      }
    }
  }

  return Object.freeze({
    access,
    emit,
    // readable-check: allow setter-seam - not a slot: setPhase records and announces a conversation's current phase
    setPhase,
    publish
  });
}

/** @typedef {ReturnType<typeof createConversationEvents>} ConversationEvents */

export { createConversationEvents, serial };
