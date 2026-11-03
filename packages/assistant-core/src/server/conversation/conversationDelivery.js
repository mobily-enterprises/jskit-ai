import { isDeepStrictEqual } from "node:util";
import { notSentDeliveryReceipt } from "./providers/scoped.js";
import { isCompletedEnvelopeTurn } from "./transcript.js";
import { conversationNativeIdentity } from "./runtimeStateUpgrade.js";
import { createConversationChangeover, conversationNativeMessages } from "./continuity.js";
import { deliveryFailure, failure, stateErrorFields } from "./conversationRefusals.js";
import { pendingSuccessor, retainedSegments, submittedMessage } from "./conversationRecords.js";

/**
 * Native delivery receipts: the changeover state a native owner sees, the changeover that
 * sends a message with the history its engine has not seen, and recovery of a message
 * whose delivery is unconfirmed.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationTranscript | null} dependencies.transcript
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("../types.js").ConversationLimits} dependencies.limits
 * @param {boolean} dependencies.persistCommentary
 * @param {boolean} dependencies.completedEnvelope
 * @param {number} dependencies.maximumFinalReply
 * @param {number} dependencies.maximumCompletedOutput
 */
function createConversationDelivery({ storage, transcript, events, reads, limits, persistCommentary, completedEnvelope, maximumFinalReply,
  maximumCompletedOutput }) {
  // The production changeover owner sees its existing state contract. Only this
  // storage adapter knows about the common runtime's segment registry and one
  // authored request record; provider binding writes remain independently fenced.
  function changeoverState(entry, request, transaction) {
    const readMetadata = () => transaction ? transaction.readMetadata()
      : storage.read(entry.id, current => current.readMetadata());
    const write = callback => transaction ? callback(transaction) : storage.write(entry.id, callback);
    return {
      async read() {
        const { runtime } = await readMetadata();
        const engines = Object.fromEntries(retainedSegments(runtime).filter(segment => segment.engine !== "api").map(segment => {
          const pending = segment.request;
          return [segment.engine, { seen: structuredClone(segment.seen),
            ...(typeof pending?.message === "string" || pending?.inspectionOnly ? { pending: structuredClone({ ...pending,
              ...(pending.inspectionOnly ? { attempted: true, displayMessage: pending.text, displayAttachments: pending.attachments } : {}) }) } : {}) }];
        }));
        const predecessor = pendingSuccessor(runtime);
        const preparing = runtime.replacement?.request?.operation === "replace" ? runtime.replacement : null;
        return { lastEngine: runtime.lastEngine, engines,
          ...(preparing ? { replacement: { engineId: preparing.engine, status: "preparing",
            operationId: preparing.request.operationId, handover: preparing.request.briefing || "",
            bindingNames: ["binding"], previous: { engineId: runtime.engine, conversationId: conversationNativeIdentity(runtime) },
            ...(preparing.preparedAt ? { preparedAt: preparing.preparedAt } : {}) } }
            : predecessor ? { replacement: { engineId: runtime.engine, status: "ready",
            operationId: predecessor.replacement.operationId, handover: predecessor.replacement.briefing || "",
            previous: { engineId: predecessor.engine, conversationId: conversationNativeIdentity(predecessor) },
            ...(predecessor.preparedAt ? { preparedAt: predecessor.preparedAt } : {}) } } : {}) };
      },
      write(value) {
        return write(async current => {
          const metadata = await current.readMetadata();
          const runtime = metadata.runtime;
          if (runtime.segmentId !== entry.segmentId || runtime.engine !== entry.engine) throw new Error("The native conversation changed before its delivery was saved.");
          const binding = value.engines[entry.engine];
          if (binding.seen !== undefined) runtime.seen = binding.seen;
          else if (!runtime.request?.inspectionOnly) throw new Error("Native delivery has no saved history cursor.");
          // A pre-preparation v2 reservation has no snapshot. Its confirmed
          // receipt settles only that request; it cannot acknowledge extra history.
          runtime.lastEngine = value.lastEngine;
          if (binding.pending) {
            const authored = runtime.request?.messageId === binding.pending.messageId ? runtime.request
              : request?.input.messageId === binding.pending.messageId ? { ...request.input, at: request.at } : null;
            if (!authored) throw new Error("A native prompt has no matching authored request.");
            // Inspection-only predecessors retain exactly their old authored
            // record. Their absent prompt must never be manufactured on read.
            runtime.request = authored.inspectionOnly ? authored : { ...authored, ...binding.pending };
          } else if (runtime.request && (typeof runtime.request.message === "string" || runtime.request.inspectionOnly ||
              runtime.request.messageId === request?.input.messageId)) {
            delete runtime.request;
          }
          const predecessor = pendingSuccessor(runtime);
          if (predecessor && value.replacement?.status === "accepted") {
            predecessor.acceptedAt = value.replacement.acceptedAt;
            predecessor.successorConversationId = value.replacement.successorConversationId;
            delete runtime.continuity;
            delete runtime.continuityAttachments;
          }
          await current.writeMetadata(metadata);
        });
      }
    };
  }

  function nativeChangeover(entry, context, request, sendMessage, signal) {
    let observation;
    const initialWindow = limits.maxInitialNativeHistoryMessages;
    const budget = entry.conversation?.maximumHistoryBytes;
    if (initialWindow !== undefined && (!Number.isSafeInteger(initialWindow) || initialWindow < 0)) {
      throw new TypeError("Initial native history requires a non-negative message limit.");
    }
    return createConversationChangeover({
      state: entry.conversation?.state || changeoverState(entry, request),
      captureContext: !entry.conversation, applicationMessages: !entry.conversation,
      maximumInitialMessages: initialWindow === undefined ? (budget ? Infinity : undefined)
        : Math.max(0, initialWindow - (request?.input.origin === "user" ? 1 : 0)),
      maximumInitialMessageCharacters: limits.maxInitialNativeHistoryMessageCharacters,
      ...(budget ? { maximumHistoryBytes: async options => {
        try {
          await events.access(context, entry.id, request.operation, entry);
          signal.throwIfAborted();
          // A host may free native context first; show that as compacting.
          const bytes = await budget({ ...options, context, signal,
            // readable-check: allow setter-seam - not a slot: the history budget resolver reports compacting through setPhase
            setPhase: phase => events.setPhase(entry, phase === "compacting" ? "compacting" : "preparing") });
          signal.throwIfAborted();
          return bytes;
        } catch (error) {
          // Sizing missed history precedes native dispatch, so this message
          // was definitely not sent. Hosts and clients report it as such.
          throw Object.assign(error, { delivery: "not-sent" });
        }
      } } : {}),
      presentation: entry.conversation?.presentation || { unconfirmedCode: "conversation_delivery_uncertain",
        unconfirmedMessage: "The previous submission has uncertain delivery. Retry this message to check its native receipt; it will not be resent automatically." },
      transcript: entry.conversation?.transcript || {
        hasMessage: messageId => transcript.conversationMessageIdExists(entry.id, messageId),
        async writeUserMessage({ messageId }) {
          if (observation) await recoverDelivery(entry, context, messageId, { observation, allowActive: true });
        }
      },
      agent: {
        sendMessage,
        async inspectMessageAdmission({ messageId, threadId }) {
          if (entry.conversation) {
            observation = await entry.provider.inspectAdmission({ messageId, threadId, context });
            await events.access(context, entry.id, request?.operation || "inspectDelivery", entry);
            return { admission: observation.accepted ? "accepted" : "unknown" };
          }
          const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
          if (!threadId || threadId !== conversationNativeIdentity(runtime) || runtime.request?.messageId !== messageId) return null;
          observation = await entry.provider.inspectAdmission({ ...runtime.request, context, configuration: runtime.configuration });
          await events.access(context, entry.id, request?.operation || "inspectDelivery", entry);
          return { admission: observation.accepted ? "accepted" : "unknown" };
        }
      }
    });
  }

  async function rememberNative(entry, transaction, turns) {
    const changeover = createConversationChangeover({ state: changeoverState(entry, null, transaction) });
    await changeover.remember({ engineId: entry.engine, messages: conversationNativeMessages(turns) });
  }

  async function recoverDelivery(entry, context, messageId, { observation: suppliedObservation, allowActive = false } = {}) {
    await events.access(context, entry.id, "inspectDelivery", entry);
    if (entry.active && !allowActive) throw failure("Wait for the current submission before checking delivery.", "conversation_busy", 409, { messageCode: "assistant.conversation.waitForSubmission" });
    if (entry.storageFailure) throw entry.storageFailure;
    if (entry.executionFailure) throw entry.executionFailure;
    const history = await reads.readTranscript(entry);
    const existing = history.find(turn => submittedMessage(turn)?.messageId === messageId);
    const receipt = existing && { status: "accepted", messageId, turnId: existing.turnId, duplicate: true };
    // Turns written before the first runtime segment carry no runtime metadata.
    const existingRuntime = existing?.metadata?.runtime;
    const goalMessageId = existingRuntime?.goalMessageId;
    const goalRequest = Boolean(submittedMessage(existing || {})?.goal || goalMessageId === messageId);
    if (existing && (existingRuntime?.segmentId !== entry.segmentId || existingRuntime.supersededBy ||
        existingRuntime.status === "complete" && !goalRequest)) return receipt;
    if (goalMessageId && goalMessageId !== messageId) {
      const owner = history.find(turn => submittedMessage(turn)?.messageId === goalMessageId);
      const ownerRuntime = owner?.metadata?.runtime;
      if (ownerRuntime?.goalMessageId !== goalMessageId || ownerRuntime.segmentId !== entry.segmentId) throw new Error("The goal command for this native continuation is missing.");
      const result = await inspectDelivery(entry, context, goalMessageId);
      return { ...receipt, recovered: result.recovered === true };
    }
    const metadata = { runtime: await reads.readState(entry) };
    if (metadata.runtime.replacement) throw failure("Finish the native replacement before recovering output.", "conversation_replacement_pending_before_recovery", 409, { messageCode: "assistant.conversation.replacementPendingBeforeRecovery" });
    const savedRequests = [...metadata.runtime.predecessors, metadata.runtime].filter(segment => segment.request?.messageId === messageId);
    if (!existing && savedRequests.length && savedRequests.every(segment =>
      ["codex", "claude", "opencode"].includes(segment.engine) && segment.request.attempted === false && !segment.request.inspectionOnly &&
      isDeepStrictEqual(segment.request, savedRequests[0].request))) {
      await events.access(context, entry.id, "inspectDelivery", entry);
      return notSentDeliveryReceipt(messageId);
    }
    const request = existing ? submittedMessage(existing) : metadata.runtime.request;
    if (!request || request.messageId !== messageId || !entry.provider.inspectAdmission) return receipt || { status: "unknown", messageId };
    const pending = metadata.runtime.request?.messageId === messageId ? metadata.runtime.request : null;
    if (pending?.threadId && pending.threadId !== conversationNativeIdentity(metadata.runtime)) return receipt || { status: "unknown", messageId };
    const observation = suppliedObservation || await entry.provider.inspectAdmission({ ...request, nativeTurnId: existing?.metadata?.runtime?.nativeTurnId,
      context, configuration: metadata.runtime.configuration });
    await events.access(context, entry.id, "inspectDelivery", entry);
    // The engine proved it never admitted this saved request. Record that it
    // was not sent, as a definite rejection would, so Retry may send it.
    if (!existing && observation.notAdmitted && pending && !pending.inspectionOnly && !entry.active) {
      await storage.write(entry.id, async transaction => {
        const current = await transaction.readMetadata();
        if (current.runtime.request?.messageId !== messageId) return;
        current.runtime.request.attempted = false;
        await transaction.writeMetadata(current);
      });
      return notSentDeliveryReceipt(messageId);
    }
    if (!observation.accepted) return { ...(receipt || { status: "unknown", messageId }),
      ...(observation.recoveryLimitation ? { recoveryLimitation: observation.recoveryLimitation } : {}) };
    if (entry.driver.canonicalTranscript) {
      const latest = await reads.readTranscript(entry);
      const saved = latest.find(turn => submittedMessage(turn)?.messageId === messageId);
      if (!saved) throw new Error("The native receipt did not persist its authored message.");
      const state = saved.metadata?.runtime;
      if (state?.segmentId !== entry.segmentId) throw new Error("The native receipt belongs to another conversation segment.");
      const unknownTool = saved.metadata.applicationTools?.some(call => !call.result || call.status === "unknown");
      const status = ["cancelled", "failed"].includes(state.status) ? state.status : unknownTool ? "interrupted"
        : observation.recoveryLimitation ? "interrupted" : ["completed", "idle"].includes(observation.status) ? "complete"
        : observation.status === "failed" ? "failed" : "interrupted";
      const error = unknownTool ? "Native output was recovered, but an application tool has no verified result. Inspect its target before requesting another execution."
        : observation.recoveryLimitation || (status === "complete" ? "" : state.error || "Delivery was confirmed. Completion could not be verified; this request was not replayed.");
      await storage.write(entry.id, async transaction => {
        const current = await transaction.readMetadata();
        if (current.runtime.segmentId !== entry.segmentId || current.runtime.replacement) {
          throw failure("Finish the native replacement before recovering output.", "conversation_replacement_pending_before_recovery", 409, { messageCode: "assistant.conversation.replacementPendingBeforeRecovery" });
        }
        const exact = await transaction.readTurn(saved.turnId);
        const { error: _previousError, ...runtime } = exact.metadata.runtime;
        await transaction.updateTurnMetadata(saved.turnId, { runtime: { ...runtime, status, ...(error ? { error } : {}) } });
      });
      if (Object.hasOwn(observation, "goal")) entry.goal = observation.goal;
      entry.error = error;
      const result = { ...(receipt || { status: "accepted", messageId, turnId: saved.turnId }),
        recovered: observation.recovered === true, ...(observation.recoveryLimitation ? { recoveryLimitation: observation.recoveryLimitation } : {}) };
      if (!existing) await events.emit(entry, { type: "accepted", ...result });
      if (result.recovered) await events.emit(entry, { type: "settled", turnId: saved.turnId, messageId, status, error, ...stateErrorFields(error) });
      return result;
    }
    const recovered = await storage.write(entry.id, async transaction => {
      const current = await transaction.readMetadata();
      if (current.runtime.segmentId !== entry.segmentId || current.runtime.replacement) throw failure("Finish the native replacement before recovering output.", "conversation_replacement_pending_before_recovery", 409, { messageCode: "assistant.conversation.replacementPendingBeforeRecovery" });
      const native = { ...observation, messageId };
      const results = [];
      const id = messageId;
      let turn = history.find(turn => submittedMessage(turn)?.messageId === id);
      if (turn?.metadata?.runtime?.supersededBy || turn && turn.metadata?.runtime?.segmentId !== entry.segmentId) {
        throw new Error("Native history refers to a turn outside the active conversation segment.");
      }
      if (turn?.metadata?.runtime?.status !== "complete") {
        if (!turn) {
          const input = request;
          const turnId = await transaction.nextTurnId();
          await transaction.appendMessage(turnId, { role: input.origin === "application" ? "system" : "user", origin: input.origin || "user",
            messageId: id, text: input.text, attachments: input.attachments, at: input.at,
            ...(input.data !== undefined ? { data: input.data } : {}), ...(input.goal ? { goal: input.goal } : {}),
            turnMetadata: { runtime: { engine: entry.engine, segmentId: entry.segmentId, origin: input.origin || "user",
              ...(input.completedEnvelope === true ? { completedEnvelope: true } : {}),
              ...(typeof input.nativeToolAttempt === "boolean" ? { nativeToolAttempt: input.nativeToolAttempt } : {}) } } });
          turn = await transaction.readTurn(turnId);
          history.push(turn);
        }
        const runtime = turn.metadata.runtime;
        if (runtime.nativeTurnId && native.nativeTurnId && runtime.nativeTurnId !== native.nativeTurnId) throw new Error("Native history changed the accepted turn's identity.");
        const replies = [];
        for (const message of native.messages || []) {
          if (!persistCommentary && message.role === "commentary") continue;
          if (message.role === "assistant") replies.push(message.text);
          else {
            const messageId = `${turn.turnId}:${message.id}`;
            if (!await transaction.hasMessage(messageId)) await transaction.appendMessage(turn.turnId,
              { messageId, ...(message.outputId ? { outputId: `${turn.turnId}:${message.outputId}` } : {}),
                role: message.role, text: message.text, at: submittedMessage(turn).at });
          }
        }
        const nativeReplies = (native.messages || []).filter(message => message.role === "assistant");
        const outputId = nativeReplies.length === 1 && nativeReplies[0].outputId;
        const replyText = replies.join("\n\n");
        const finalReplyLimit = completedEnvelope && isCompletedEnvelopeTurn(turn) && !submittedMessage(turn)?.goal
          ? maximumCompletedOutput : maximumFinalReply;
        const oversizedReply = replyText.length > finalReplyLimit;
        if (replies.length && !oversizedReply) await transaction.replaceAssistant(turn.turnId, { messageId: turn.assistant?.messageId || `${turn.turnId}:assistant`,
          ...(!turn.assistant?.outputId && outputId ? { outputId: `${turn.turnId}:${outputId}` } : {}),
          role: "assistant", text: replyText, at: submittedMessage(turn).at });
        const unknownTool = turn.metadata.applicationTools?.some(call => !call.result || call.status === "unknown");
        const retainedFailure = ["cancelled", "failed"].includes(runtime.status);
        const status = retainedFailure ? runtime.status : oversizedReply ? "failed" : unknownTool ? "interrupted" : native.status || "interrupted";
        const { error: previousError, ...saved } = runtime;
        const error = unknownTool ? "Native output was recovered, but an application tool has no verified result. Inspect its target before requesting another execution."
          : oversizedReply ? retainedFailure && (previousError || native.error) || "The assistant exceeded the configured final reply limit."
          : status === "complete" ? "" : previousError || native.error || "Delivery was confirmed from native history. Completion was not confirmed; this request was not replayed.";
        await transaction.updateTurnMetadata(turn.turnId, { runtime: { ...saved, status,
          ...(request.goal || goalRequest ? { goalMessageId: messageId } : {}),
          ...(native.nativeTurnId ? { nativeTurnId: native.nativeTurnId } : {}), ...(error ? { error } : {}) } });
        results.push({ turnId: turn.turnId, messageId: id, status, error });
      }
      await transaction.writeMetadata(current);
      return results;
    });
    if (Object.hasOwn(observation, "goal")) entry.goal = observation.goal;
    entry.error = recovered.find(turn => turn.error)?.error || "";
    const result = { ...(receipt || { status: "accepted", messageId, turnId: recovered[0].turnId }), recovered: recovered.length > 0 };
    if (!existing) await events.emit(entry, { type: "accepted", ...result });
    for (const turn of recovered) await events.emit(entry, { type: "settled", ...turn, ...stateErrorFields(turn.error) });
    return result;
  }

  async function inspectDelivery(entry, context, messageId) {
    if (entry.conversation?.commands) {
      await events.access(context, entry.id, "inspectDelivery", entry);
      const result = await entry.conversation.commands.inspectDelivery({ messageId }, context);
      await events.access(context, entry.id, "inspectDelivery", entry);
      return result;
    }
    if (entry.conversation) {
      await events.access(context, entry.id, "inspectDelivery", entry);
      const state = await reads.readState(entry);
      // A running owner completes its own receipt. Only an idle owner recovers
      // the saved changeover, preserving write-receipt-before-clear ordering.
      if (!entry.active && state.request?.messageId === messageId && state.request.attempted) {
        const sender = nativeChangeover(entry, context, null, () => {
          throw new Error("Receipt inspection cannot submit another native prompt.");
        });
        const delivered = await sender.send({ engineId: entry.engine,
          messages: await entry.conversation.transcript.history(), input: { messageId }, inspectOnly: true });
        if (delivered?.notSent) return notSentDeliveryReceipt(messageId);
        if (!delivered?.delivered) throw deliveryFailure(delivered);
      }
      const row = (await reads.readTranscript(entry)).find(turn => submittedMessage(turn)?.messageId === messageId);
      if (row) return { status: "accepted", messageId, turnId: row.turnId, duplicate: true };
      const threadId = state.request?.messageId === messageId ? state.request.threadId : conversationNativeIdentity(state);
      if (!threadId) return { status: "unknown", messageId };
      const observation = await entry.provider.inspectAdmission({ messageId, threadId, context });
      await events.access(context, entry.id, "inspectDelivery", entry);
      // Native-only acceptance is evidence of delivery, not permission to
      // manufacture an authored row or use a native turn ID as its receipt.
      if (observation.accepted) return { status: "accepted", messageId, duplicate: true };
      return observation.notAdmitted && !entry.active ? notSentDeliveryReceipt(messageId) : { status: "unknown", messageId };
    }
    const result = await recoverDelivery(entry, context, messageId);
    if (result.status !== "accepted" || entry.engine === "api") return result;
    if (entry.driver.canonicalTranscript && result.recoveryLimitation) {
      const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
      if (runtime.request?.goal || runtime.binding?.goalRequest?.messageId === messageId ||
          runtime.binding?.goalReceipt?.messageId === messageId) return result;
    }
    const messages = conversationNativeMessages((await reads.readTranscript(entry)).filter(turn => !turn.metadata?.runtime?.supersededBy));
    const sender = nativeChangeover(entry, context, null, () => {
      throw new Error("Receipt inspection cannot submit another native prompt.");
    });
    const pending = (await reads.readState(entry)).request;
    if (pending?.messageId === messageId) {
      const delivered = await sender.send({ engineId: entry.engine, messages, input: { messageId } });
      if (!delivered?.delivered) throw deliveryFailure(delivered);
    }
    await sender.remember({ engineId: entry.engine, messages });
    return result;
  }

  return Object.freeze({
    changeoverState,
    nativeChangeover,
    rememberNative,
    recoverDelivery,
    inspectDelivery
  });
}

/** @typedef {ReturnType<typeof createConversationDelivery>} ConversationDelivery */

export { createConversationDelivery };
