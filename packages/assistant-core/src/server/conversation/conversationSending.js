import { isDeepStrictEqual } from "node:util";
import { createConversationDeliveryTiming, recordNoDeliveryTiming } from "./deliveryTiming.js";
import { codexAppServerTurnStateFromAgentRun } from "./codexTurn.js";
import { conversationAttachmentIds } from "./attachments.js";
import { failure } from "./conversationRefusals.js";
import { retainedSegments, submittedMessage } from "./conversationReads.js";
import { serial } from "./conversationEvents.js";

/** @typedef {import("./conversationEntries.js").ConversationEntry} ConversationEntry */

/**
 * One message an open conversation sends: its validated input, who sent it and how, and its
 * admission as the turn delivers it. admitSend creates it.
 * @typedef {object} ConversationRequest
 * @property {{ messageId: string, text: string, origin: string, attachments: object[], data?: object, goal?: object }} input
 * @property {any} [originalInput] A native caller's own input, kept for the native representation.
 * @property {string} operation The operation it is authorized as: send, steer, wake or goal.
 * @property {object} context
 * @property {string} at
 * @property {(stage: string) => void} deliveryTiming
 * @property {boolean} [completedEnvelope]
 * @property {string[]} [excludedMessageIds]
 * @property {boolean} [nativeToolAttempt]
 * @property {boolean} steering Whether it steers a running native turn.
 * @property {PromiseWithResolvers<any>} admission Resolves with its receipt once the turn admits it.
 * @property {Map<string, object>} progress Its completed commentary and thinking, by message id.
 * @property {ReturnType<typeof import("./tools.js").createConversationTools>} [tools]
 * @property {string} [turnId]
 * @property {string} [nativeTurnId]
 * @property {string} [nativeThreadId]
 * @property {string} [goalMessageId]
 * @property {string} [continuedBy] The message whose admission sealed it.
 * @property {object | null} [answer]
 * @property {boolean} [accepted]
 * @property {boolean} [admissionSettled]
 * @property {boolean} [admissionPublished]
 * @property {boolean} [sealed] Its output is final; late native snapshots no longer change it.
 * @property {boolean} [finished]
 * @property {Promise<void>} [deliveryCommitted]
 * @property {object} [recovered] The saved state of a turn a duplicate delivery recovered.
 */

/** Whether a saved request and a new message carry the same content. */
const sameRequest = (left, right) => left.text === right.text && (left.origin || "user") === right.origin &&
  isDeepStrictEqual(left.goal, right.goal) && isDeepStrictEqual(left.data, right.data) &&
  isDeepStrictEqual((left.attachments || []).map(file => file.attachmentId), right.attachments.map(file => file.attachmentId));

/**
 * Sending a message: its validation, its admission into the conversation queue, and the
 * turn it starts or the running turn it steers.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationEntries.js").ConversationEntries} dependencies.entries
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationTurns.js").ConversationTurns} dependencies.turns
 * @param {import("../types.js").ConversationDeliveryTimingObserver | undefined} dependencies.onDeliveryTiming
 * @param {readonly string[]} dependencies.deliveryHostStages
 * @param {boolean} dependencies.completedEnvelope
 * @param {number} dependencies.maximumInput
 */
function createConversationSending({ storage, events, entries, reads, turns, onDeliveryTiming, deliveryHostStages, completedEnvelope, maximumInput }) {
  /**
   * @param {ConversationEntry} entry
   * @param {object} context
   * @param {object} input
   * @param {string} [origin]
   * @param {object} [goal]
   * @param {string} [representation]
   * @param {object} [wakeOptions]
   * @param {boolean} [retryFinishedTurn] Whether a message that Claude's completion refused may be admitted once more.
   */
  async function send(entry, context, input, origin = "user", goal, representation, wakeOptions, retryFinishedTurn = true) {
    const deliveryTiming = createConversationDeliveryTiming({ engine: entry.engine,
      conversationId: entry.id, messageId: input?.messageId, report: onDeliveryTiming, hostStages: deliveryHostStages });
    deliveryTiming("received");
    const grant = new Set();
    try {
      await events.access(context, entry.id, goal ? "goal" : input?.steer === true ? "steer" : origin === "application" ? "wake" : "send", entry, grant);
      if (entry.conversation?.commands) {
        if (origin !== "user" || goal) throw failure("This conversation supports its original application Send operation.", "conversation_original_send_only", 400, { messageCode: "assistant.conversation.originalSendOnly" });
        return entry.conversation.commands.send(input, context);
      }
      if (entry.conversation?.native?.scoped) return entry.provider.sendNative({ input, context });
      const originalInput = representation === "native" ? input : undefined;
      const message = originalInput ? { ...input, text: input.displayMessage ?? input.message ?? input.text ?? "" } : input;
      const admission = await serial(entry, () => admitSend(entry, context, message, origin, goal, originalInput, wakeOptions, deliveryTiming, grant));
      const result = await (admission.receipt || admission.promise);
      if (!entry.conversation) return result;
      if (representation === "native") return result.nativeResult;
      if (result.error) throw result.error;
      return result.receipt;
    } catch (error) {
      // Completion can retire Claude's generation while this message's turn is prepared, before the message is
      // written: a Claude resumed after its process stopped during a background command reports that command
      // stopped, with a result. That exact pre-write rejection permits one re-admission of this same message, as
      // a goal's does, after the original cleanup and save finish.
      if (retryFinishedTurn && entry.conversation && origin === "user" && !goal && input?.steer !== true &&
          error.code === "conversation_steer_turn_finished" && error.delivery === "not-sent") {
        await entry.active?.done;
        return send(entry, context, input, origin, goal, representation, wakeOptions, false);
      }
      deliveryTiming("failed");
      throw error;
    }
  }

  /**
   * Called while holding the conversation queue, including Claude's stop-then-Send goal commands.
   * Every command keeps the ordinary receipt path.
   * @param {ConversationEntry} entry
   * @param {object} context
   * @param {object} input
   * @param {string} [origin]
   * @param {object} [goal]
   * @param {object} [originalInput]
   * @param {object} [wakeOptions]
   * @param {(stage: string) => void} [deliveryTiming]
   * @param {Set<string>} [grant]
   */
  async function admitSend(entry, context, input, origin = "user", goal, originalInput, wakeOptions, deliveryTiming = recordNoDeliveryTiming, grant) {
    deliveryTiming("preparation-started");
    const operation = goal ? "goal" : input?.steer === true ? "steer" : origin === "application" ? "wake" : "send";
    await events.access(context, entry.id, operation, entry, grant);
    if (entry.cancelledMessages.has(input?.messageId)) {
      throw Object.assign(failure("This message was cancelled. Send it again as a new message.", "conversation_message_cancelled", 409,
        { messageCode: "assistant.conversation.messageCancelled" }), { delivery: "not-sent" });
    }
    await entry.conversation?.admission(context, operation);
    deliveryTiming("authorized");
    if (goal) context?.signal?.throwIfAborted();
    let suppliedExclusions;
    if (wakeOptions !== undefined) {
      if (!completedEnvelope || entry.conversation || origin !== "application" || goal ||
          !wakeOptions || typeof wakeOptions !== "object" || Array.isArray(wakeOptions) ||
          Object.keys(wakeOptions).some(name => name !== "excludedMessageIds") ||
          !Array.isArray(wakeOptions.excludedMessageIds) ||
          wakeOptions.excludedMessageIds.some(id => typeof id !== "string" || !id.trim() || id.length > 128) ||
          new Set(wakeOptions.excludedMessageIds).size !== wakeOptions.excludedMessageIds.length) {
        throw failure("Native history exclusions require a server-owned completed application wake and exact message IDs.", "conversation_invalid_message", 400, { messageCode: "assistant.conversation.historyExclusionsInvalid" });
      }
      suppliedExclusions = [...wakeOptions.excludedMessageIds];
    }
    const attachmentIds = conversationAttachmentIds(input?.attachmentIds);
    if (!input || typeof input.messageId !== "string" || !input.messageId.trim() || input.messageId.length > 128 ||
        entry.engine !== "api" && !/^[\w-]{1,128}$/u.test(input.messageId) ||
        typeof input.text !== "string" || !input.text.trim() && !attachmentIds.length || input.text.length > maximumInput) {
      throw failure("Bounded text or attachment IDs and a stable messageId are required.", "conversation_invalid_message", 400, { messageCode: "assistant.conversation.messageContentRequired" });
    }
    if (!originalInput && input.attachments?.length) throw failure("Supply attachmentIds; only the application's resolver can supply file content.", "conversation_attachment_ids_only", 400, { messageCode: "assistant.conversation.attachmentIdsOnly" });
    if (attachmentIds.length && !reads.capabilities(entry).attachments) throw failure("File attachments are not configured for this conversation.", "conversation_attachments_not_configured", 400, { messageCode: "assistant.conversation.attachmentsNotConfigured" });
    if (input.steer !== undefined && typeof input.steer !== "boolean") throw failure("steer must be a boolean.", "conversation_invalid_message", 400, { messageCode: "assistant.conversation.steerNotBoolean" });
    if (input.steer && !entry.driver.capabilities.steering) throw failure("This connection does not support steering.", "conversation_steering_unsupported", 400, { messageCode: "assistant.conversation.steeringUnsupported" });
    let data;
    if (input.data !== undefined) {
      try {
        if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) throw new TypeError();
        const encoded = JSON.stringify(input.data);
        if (input.text.length + encoded.length > maximumInput) throw new TypeError();
        data = JSON.parse(encoded);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError();
      } catch {
        throw failure("Application data must be a JSON object within the conversation input limit.", "conversation_invalid_message", 400, { messageCode: "assistant.conversation.applicationDataInvalid" });
      }
    }
    const message = { messageId: input.messageId, text: input.text.trim(), origin,
      attachments: attachmentIds.map(attachmentId => ({ attachmentId })), ...(data !== undefined ? { data } : {}), ...(goal ? { goal } : {}) };
    if (entry.storageFailure) throw entry.storageFailure;
    if (entry.executionFailure) throw entry.executionFailure;
    if (goal && goal.expectedSegmentId !== entry.segmentId) throw failure("The conversation changed before this goal command was sent.", "conversation_goal_changed", 409, { messageCode: "assistant.conversation.goalConversationChanged" });
    const pending = entry.active?.requests.get(message.messageId);
    if (pending && entry.engine !== "api" && !pending.admissionSettled) {
      if (suppliedExclusions && !isDeepStrictEqual(pending.excludedMessageIds || [], suppliedExclusions)) throw failure("This messageId already belongs to different native history exclusions.", "conversation_message_id_exclusions_conflict", 409, { messageCode: "assistant.conversation.messageIdExclusionsConflict" });
      if (!entry.conversation && !sameRequest(pending.input, message)) throw failure("This messageId already belongs to different content.", "conversation_message_id_content_conflict", 409, { messageCode: "assistant.conversation.messageIdContentConflict" });
      return { promise: pending.admission.promise };
    }
    const existing = await reads.findSubmittedTurn(entry, message.messageId);
    deliveryTiming("history-read");
    const nativeState = entry.engine !== "api" && (await entries.readState(entry));
    deliveryTiming("state-read");
    const nativePending = nativeState?.request;
    if (existing) {
      const previous = submittedMessage(existing);
      if (!entry.conversation && !sameRequest(previous, message)) {
        throw failure("This messageId already belongs to different content.", "conversation_message_id_content_conflict", 409, { messageCode: "assistant.conversation.messageIdContentConflict" });
      }
      if (!entry.conversation && !nativePending) return { receipt: { status: "accepted", messageId: message.messageId, turnId: existing.turnId, origin, duplicate: true } };
    }
    if (pending && !entry.conversation) {
      if (!sameRequest(pending.input, message)) throw failure("This messageId already belongs to different content.", "conversation_message_id_content_conflict", 409, { messageCode: "assistant.conversation.messageIdContentConflict" });
      if (suppliedExclusions && !isDeepStrictEqual(pending.excludedMessageIds || [], suppliedExclusions)) throw failure("This messageId already belongs to different native history exclusions.", "conversation_message_id_exclusions_conflict", 409, { messageCode: "assistant.conversation.messageIdExclusionsConflict" });
      return { promise: pending.admission.promise };
    }
    const working = entry.active;
    if (entry.conversation && ["codex", "opencode", "claude"].includes(entry.engine) && ["send", "goal"].includes(operation) && working?.finishing) {
      // No native dispatch has occurred for this request. Finish the previous
      // waiter before reserving the same authored message or goal request.
      await working.done;
      return admitSend(entry, context, input, origin, goal, originalInput, wakeOptions, deliveryTiming, grant);
    }
    const nativeSteering = !working && (nativeState.nativeTurn?.active || entry.driver.canonicalTranscript && nativeState.binding?.codexAppServerRun &&
      codexAppServerTurnStateFromAgentRun(nativeState.binding.codexAppServerRun).active);
    if (completedEnvelope && entry.engine === "claude" &&
        (working?.request.completedEnvelope || nativePending?.completedEnvelope === true || origin === "application" && !goal) &&
        (working || input.steer || nativeSteering)) {
      throw failure("Completed Claude responses cannot share a native steering turn. Wait for the response or stop it.", "conversation_not_steerable", 409, { messageCode: "assistant.conversation.completedClaudeNotSteerable" });
    }
    if (working && !input.steer && !goal && !entry.conversation) throw failure("Wait for this answer or use steer to send another instruction.", "conversation_busy", 409, { messageCode: "assistant.conversation.waitForAnswer" });
    if (input.steer && (!working && !nativeSteering || working?.finishing) && !(nativePending?.attempted || nativePending?.inspectionOnly)) {
      const previousState = nativeState?.nativeTurn?.runState || nativeState?.nativeTurn?.state ||
        (await reads.lastTranscriptTurn(entry))?.metadata?.runtime?.status;
      const completed = working ? !working.controller.signal.aborted && !working.timedOut : ["complete", "completed"].includes(previousState);
      throw Object.assign(failure("There is no active native turn to steer. Send a new message.",
        completed ? "conversation_steer_turn_finished" : "conversation_not_steerable", 409, { messageCode: "assistant.conversation.noActiveTurnToSteer" }), { delivery: "not-sent" });
    }
    if (goal && working?.finishing) throw failure("Wait for the current turn to finish saving before starting the goal.", "conversation_busy", 409, { messageCode: "assistant.conversation.waitForTurnSaving" });
    if (working && (!working.request.admissionSettled || working.steering)) throw failure("Wait for the pending instruction to be admitted before steering again.", "conversation_busy", 409, { messageCode: "assistant.conversation.waitForInstructionAdmission" });
    const barrier = working ? Promise.withResolvers() : null;
    if (barrier) working.steering = barrier.promise;
    const release = () => {
      barrier?.resolve();
      if (working && working.steering === barrier?.promise) working.steering = null;
    };
    let configuration;
    let markedResponse = false;
    let nativeToolAttempt;
    let excludedMessageIds;
    let requestAt = new Date().toISOString();
    // The bound state was read above unless this is an API conversation.
    try { configuration = entry.conversation ? (nativeState || await entries.readState(entry)).configuration : await storage.write(entry.id, async transaction => {
      const metadata = await transaction.readMetadata();
      if (metadata.runtime.replacement) throw failure("Finish the pending native replacement before sending another message.", "conversation_replacement_pending_before_send", 409, { messageCode: "assistant.conversation.replacementPendingBeforeSend" });
      if (retainedSegments(metadata.runtime).some(segment => segment.segmentId !== entry.segmentId && segment.request?.messageId === message.messageId)) {
        throw failure("This message has uncertain delivery in a retained conversation. Select that engine and check its receipt before submitting it again.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.retainedDeliveryUncertain" });
      }
      if (metadata.runtime.request) {
        if (suppliedExclusions && metadata.runtime.request.messageId !== message.messageId) {
          throw failure("Check delivery of the previous instruction before preparing another completed response.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.previousInstructionUnchecked" });
        }
        if (entry.engine === "api") throw failure("The previous submission has uncertain delivery. It will not be resent automatically.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.previousSubmissionUncertain" });
        if (metadata.runtime.request.messageId === message.messageId) {
          if (!sameRequest(metadata.runtime.request, message)) throw failure("This messageId already belongs to different content.", "conversation_message_id_content_conflict", 409, { messageCode: "assistant.conversation.messageIdContentConflict" });
          if (suppliedExclusions && !isDeepStrictEqual(metadata.runtime.request.excludedMessageIds || [], suppliedExclusions)) {
            throw failure("This messageId already belongs to different native history exclusions.", "conversation_message_id_exclusions_conflict", 409, { messageCode: "assistant.conversation.messageIdExclusionsConflict" });
          }
          requestAt = metadata.runtime.request.at;
        }
      } else metadata.runtime.request = { ...message, at: requestAt,
        ...(completedEnvelope && origin === "application" && !goal ? { completedEnvelope: true, excludedMessageIds: suppliedExclusions || [],
          ...(entry.engine === "claude" ? { nativeToolAttempt: false } : {}) } : {}),
        ...(entry.engine !== "api" ? { attempted: false } : {}), ...(input.steer ? { steering: true } : {}) };
      markedResponse = origin === "application" && !goal && metadata.runtime.request?.messageId === message.messageId &&
        metadata.runtime.request.completedEnvelope === true;
      if (markedResponse) excludedMessageIds = structuredClone(metadata.runtime.request.excludedMessageIds || []);
      if (entry.engine === "claude" && markedResponse && typeof metadata.runtime.request.nativeToolAttempt === "boolean") nativeToolAttempt = metadata.runtime.request.nativeToolAttempt;
      await transaction.writeMetadata(metadata);
      return metadata.runtime.configuration;
    }); } catch (error) { release(); throw error; }
    deliveryTiming("request-saved");
    /** @type {ConversationRequest} */
    const request = { input: message, originalInput, operation, context, at: requestAt, deliveryTiming,
      ...(markedResponse ? { completedEnvelope: true, excludedMessageIds } : {}),
      ...(typeof nativeToolAttempt === "boolean" ? { nativeToolAttempt } : {}), steering: Boolean(working || input.steer && nativeSteering),
      admission: Promise.withResolvers(), progress: new Map() };
    request.admission.promise.catch(() => {});
    if (working) {
      working.requests.set(message.messageId, request);
      working.submit(request).catch(error => request.admission.reject(error)).finally(release);
      return { promise: request.admission.promise };
    }
    turns.start(entry, request, configuration);
    return { promise: request.admission.promise };
  }

  return Object.freeze({
    send,
    admitSend
  });
}

/** @typedef {ReturnType<typeof createConversationSending>} ConversationSending */

export { createConversationSending };
