import { conversationAttachmentManifest } from "../../shared/conversation/attachments.js";
import { createConversationAttachmentReader } from "./attachments.js";
import { conversationHistoryVersions, conversationNativeMessages, conversationRequestText } from "./continuity.js";
import { deliveryFailure, failure } from "./conversationRefusals.js";

/**
 * How one running turn delivers its requests: the attribution every saved turn records,
 * progress writes, admission publication, attachment reading and native dispatch.
 * @param {object} dependencies
 * @param {any} dependencies.entry The open conversation the turn runs in.
 * @param {any} dependencies.active The running turn: its requests, controller and steering.
 * @param {import("./provider.js").ConversationDriver} dependencies.driver
 * @param {string} dependencies.engine
 * @param {string} dependencies.segmentId
 * @param {object} dependencies.bindingOwner The provider binding the turn started under.
 * @param {Map<string, () => Promise<void>>} dependencies.rejectionSaves The failed saves of a definite rejection, by message id.
 * @param {(request: any, seen: any, options?: { nativeDelivery?: boolean, conversationTurn?: any }) => Promise<void>} dependencies.admit Admits a request of this turn.
 * @param {import("./storage.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("./streams.js").ConversationStreams} dependencies.streams
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationDelivery.js").ConversationDelivery} dependencies.delivery
 * @param {import("../types.js").ConversationAttachments | undefined} dependencies.attachments
 * @param {boolean} dependencies.persistCommentary
 * @param {number} dependencies.maximumContinuity
 * @param {number} dependencies.maximumAttachmentBytes
 */
function createConversationTurnDelivery({ entry, active, driver, engine, segmentId, bindingOwner, rejectionSaves, admit, storage, streams, events,
  reads, delivery, attachments, persistCommentary, maximumContinuity, maximumAttachmentBytes }) {
  // Every saved turn and pending request records its attribution identically.
  const turnAttribution = (request, extra = {}) => ({ engine, segmentId, origin: request.input.origin,
    ...(request.completedEnvelope ? { completedEnvelope: true } : {}),
    ...(typeof request.nativeToolAttempt === "boolean" ? { nativeToolAttempt: request.nativeToolAttempt } : {}), ...extra });
  const authoredRequestRecord = request => ({ ...request.input, at: request.at,
    ...(request.completedEnvelope ? { completedEnvelope: true, excludedMessageIds: request.excludedMessageIds } : {}),
    ...(typeof request.nativeToolAttempt === "boolean" ? { nativeToolAttempt: request.nativeToolAttempt } : {}) });

  async function writeProgress(transaction, request, status, error = "", extra = {}) {
    if (request.tools) await transaction.updateTurnMetadata(request.turnId, { applicationTools: request.tools.records() });
    if (!driver.canonicalTranscript) {
      for (const message of request.progress.values()) {
        if (!persistCommentary && message.role === "commentary") continue;
        if (!await transaction.hasMessage(message.messageId)) await transaction.appendMessage(request.turnId, message);
      }
      if (request.answer?.text.trim()) await transaction.replaceAssistant(request.turnId, request.answer);
    }
    const saved = driver.canonicalTranscript ? await transaction.readTurn(request.turnId) : null;
    await transaction.updateTurnMetadata(request.turnId, { runtime: { ...saved?.metadata?.runtime, status, ...turnAttribution(request, {
      ...(request.nativeTurnId ? { nativeTurnId: request.nativeTurnId } : {}),
      ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
      ...(request.continuedBy ? { continuedBy: request.continuedBy } : {}) }), ...extra, ...(error ? { error } : {}) } });
    return conversationHistoryVersions([{ turnId: request.turnId,
      messages: [...request.progress.values()].filter(message => !(message.turnId === request.turnId && message.status === "complete"))
        .concat(request.answer?.text.trim() ? [request.answer] : []) }]);
  }

  async function publishAdmission(request, nativeResult) {
    request.deliveryTiming("accepted");
    const receipt = { status: "accepted", messageId: request.input.messageId, turnId: request.turnId, origin: request.input.origin };
    request.admission.resolve(entry.conversation ? { receipt, nativeResult } : receipt);
    request.admissionSettled = true;
    await events.emit(entry, { type: "accepted", ...receipt });
    if (driver.canonicalTranscript && !entry.conversation) {
      // Native items can complete before common admission finishes. Their
      // exact request already owns them; publish before tools join the
      // existing delivery commit, without blocking the native event queue.
      for (const [id, message] of request.progress) {
        if (message.turnId !== request.turnId || message.status !== "complete") continue;
        request.progress.delete(id);
        if (request.sealed || entry.disposed || entry.active !== active ||
            entry.bindingOwner !== bindingOwner || entry.segmentId !== segmentId) continue;
        await events.emit(entry, { type: "message", ...message, streaming: streams.read(entry.id) },
          () => !entry.disposed && !request.sealed && entry.active === active && entry.bindingOwner === bindingOwner && entry.segmentId === segmentId);
      }
    }
    request.admissionPublished = true;
    await events.setPhase(entry, "working", request.turnId);
    if ((entry.conversation || driver.canonicalTranscript) && entry.nativePhase && entry.nativePhase !== "working") await events.setPhase(entry, entry.nativePhase, request.turnId);
  }

  function attachmentReader(request) {
    return createConversationAttachmentReader({ attachments, context: request.context, conversationId: entry.id,
      signal: active.controller.signal, authorize: () => events.access(request.context, entry.id, request.operation, entry),
      types: driver.attachmentTypes, maximumBytes: maximumAttachmentBytes });
  }

  async function beforeDispatch(request) {
    await events.access(request.context, entry.id, request.operation, entry);
    active.controller.signal.throwIfAborted();
    if (request.input.goal && request.context?.signal?.aborted) {
      throw Object.assign(failure("The goal command was stopped before delivery.", "conversation_goal_stopped"), { delivery: "not-sent" });
    }
    if (active.finishing) throw Object.assign(failure("The native turn finished before this instruction was sent. Send it as a new message.", "conversation_steer_turn_finished", 409, { messageCode: "assistant.conversation.turnFinishedBeforeSend" }), { delivery: "not-sent" });
  }

  async function deliverNative(request, dispatch) {
    // A bound conversation supplies its own native history below.
    const history = entry.conversation ? [] : (await reads.readTranscript(entry)).filter(turn => !turn.metadata?.runtime?.supersededBy);
    let completion;
    let committed;
    let rendered;
    let threadId;
    let attachmentManifest;
    let nativeResult;
    const dispatchPrepared = async input => {
      rendered = input;
      rejectionSaves.delete(request.input.messageId);
      if (request.operation === "steer" && !request.steering) throw Object.assign(failure("There is no active native turn to steer. Send a new message.", "conversation_steer_turn_finished", 409, { messageCode: "assistant.conversation.noActiveTurnToSteer" }), { delivery: "not-sent" });
      if ((input.contextText || "").length > maximumContinuity) throw new Error("Conversation updates exceed the configured history budget. Renew the context with a continuity briefing before continuing.");
      if (request.input.goal && input.contextText) {
        throw failure("Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal.", "conversation_briefing_before_terminal", 409, { messageCode: "assistant.conversation.briefingBeforeTerminal" });
      }
      const readAttachments = attachmentReader(request);
      // The bound host has already resolved its original attachment records;
      // the production preparation owner keeps their manifest/native mapping.
      const boundInput = entry.conversation
        ? await entry.conversation.prepareInput(input, request.context, { deliveryTiming: request.deliveryTiming }) : null;
      const files = boundInput ? { attachments: boundInput.displayAttachments || [], localFiles: [], content: [] }
        : await readAttachments((input.attachmentIds || []).map(attachmentId => ({ attachmentId })));
      const contextFiles = boundInput ? { localFiles: [], content: [] } : await readAttachments(input.contextAttachments || []);
      request.deliveryTiming("input-prepared");
      const localFiles = [...contextFiles.localFiles, ...files.localFiles];
      if (request.input.goal && localFiles.length) {
        throw failure("Native goals require extracted text or supported image bytes for attachments.", "conversation_goal_attachment_content_unsupported", 400, { messageCode: "assistant.conversation.goalAttachmentContentUnsupported" });
      }
      attachmentManifest = conversationAttachmentManifest(localFiles);
      request.input.attachments = files.attachments;
      if (!entry.conversation) await storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        const pending = metadata.runtime.request;
        if (pending && pending.messageId !== request.input.messageId && (pending.attempted || pending.inspectionOnly)) throw new Error("The pending conversation instruction changed.");
        if (pending?.messageId === request.input.messageId && pending.attachmentManifest !== undefined &&
            pending.attachmentManifest !== attachmentManifest) {
          throw failure("Authorized attachment paths changed after this instruction was prepared. Restore the original files or send a new message.", "conversation_attachment_manifest_changed");
        }
        metadata.runtime.request = { ...(pending?.messageId === request.input.messageId ? pending
          : { ...authoredRequestRecord(request), attempted: false }), attachmentManifest };
        await transaction.writeMetadata(metadata);
      });
      const admitted = Promise.withResolvers();
      committed = Promise.withResolvers();
      committed.promise.catch(() => {});
      request.deliveryCommitted = committed.promise;
      request.deliveryTiming("provider-started");
      completion = Promise.resolve().then(() => dispatch({
        context: request.context,
        input: { ...request.input, authoredInput: { ...request.input, at: request.at },
          ...(request.input.goal ? { signal: request.context?.signal } : {}),
          ...(boundInput ? { nativeMessage: boundInput } : {}),
          text: input.message, contextText: input.contextText || "",
          content: [...contextFiles.content, ...files.content], localFiles, attachmentManifest },
        signal: active.controller.signal,
        deliveryTiming: request.deliveryTiming,
        onNativeReceipt: () => request.deliveryTiming("native-acknowledged"),
        onReceiptPersisted: () => request.deliveryTiming("receipt-persisted"),
        ...(engine === "opencode" ? { deliveryCommitted: committed.promise } : {}),
        async beforeDispatch(native) {
          request.deliveryTiming("runtime-ready");
          await beforeDispatch(request);
          threadId = native?.threadId;
          if (!threadId) throw new Error("Native admission requires the saved conversation identity.");
          await input.onPromptSending(entry.conversation ? native : { threadId, displayAttachments: files.attachments,
            turnMetadata: { runtime: turnAttribution(request) } });
          if (request.input.goal && request.context?.signal?.aborted) {
            throw Object.assign(failure("The goal command was stopped before delivery.", "conversation_goal_stopped"), { delivery: "not-sent" });
          }
          request.deliveryTiming("dispatch-started");
        },
        async accept(native) {
          if (entry.conversation) nativeResult = native.nativeResult;
          if (native?.nativeTurnId) active.nativeTurnId = native.nativeTurnId;
          request.nativeThreadId = threadId;
          await admit(request, undefined, { nativeDelivery: true, conversationTurn: native?.conversationTurn });
          admitted.resolve(entry.conversation ? nativeResult.value
            : { ok: true, delivered: true, messageId: request.input.messageId, threadId });
          // Drivers may stream or continue a goal as soon as accept returns.
          // The original delivery marker must be durable before that happens.
          await committed.promise;
        }
      })).then(result => {
        if (entry.conversation && !request.accepted && result) {
          nativeResult = result;
          admitted.resolve(result.value);
          return;
        }
        if (!request.accepted) throw new Error("The engine did not acknowledge the message.");
      }).catch(async error => {
        if (!request.accepted && (error.delivery === "not-sent" || !entry.conversation && error.delivery !== "uncertain")) {
          try { await input.onPromptRejected(); }
          catch (saveError) {
            rejectionSaves.set(request.input.messageId, input.onPromptRejected);
            error = saveError;
          }
        }
        admitted.reject(error);
        throw error;
      });
      completion.catch(() => {});
      return admitted.promise;
    };
    try {
      const input = {
        ...request.originalInput,
        messageId: request.input.messageId,
        message: request.originalInput ? request.originalInput.message ?? request.originalInput.text ?? "" : conversationRequestText(request.input),
        displayMessage: request.input.text,
        displayAttachments: request.originalInput?.displayAttachments || request.input.attachments,
        attachmentIds: request.input.attachments.map(file => file.attachmentId),
        async onPromptSending({ threadId, displayAttachments, turnMetadata }) {
          // readable-check: allow optional-call - optional operation: a native caller's input may carry its own prompt-sending callback
          if (entry.conversation) return request.originalInput?.onPromptSending?.({ threadId, displayAttachments, turnMetadata });
          await storage.write(entry.id, async transaction => {
            const metadata = await transaction.readMetadata();
            const pending = metadata.runtime.request;
            if (pending && pending.messageId !== request.input.messageId && (pending.attempted || pending.inspectionOnly)) throw new Error("The pending conversation instruction changed.");
            metadata.runtime.request = { ...authoredRequestRecord(request),
              message: rendered.message, displayMessage: rendered.displayMessage,
              displayAttachments, attachmentIds: rendered.attachmentIds,
              attachmentManifest,
              ...(rendered.contextText !== undefined ? { contextText: rendered.contextText, contextAttachments: rendered.contextAttachments } : {}),
              seen: pending?.seen || conversationHistoryVersions(history), attempted: true, threadId, turnMetadata,
              ...(request.operation === "steer" ? { steering: true } : {}) };
            await transaction.writeMetadata(metadata);
          });
        },
        async onPromptRejected() {
          // readable-check: allow optional-call - optional operation: a native caller's input may carry its own prompt-rejected callback
          if (entry.conversation) return request.originalInput?.onPromptRejected?.();
          await storage.write(entry.id, async transaction => {
            const metadata = await transaction.readMetadata();
            if (metadata.runtime.request?.messageId === request.input.messageId) {
              metadata.runtime.request.attempted = false;
              await transaction.writeMetadata(metadata);
            }
          });
        }
      };
      // Original goal commands call the same native sender directly. Chat
      // context rendering and its delivery cursor must not change /goal input.
      const delivered = entry.conversation && request.input.goal
        ? await dispatchPrepared(input)
        : await delivery.nativeChangeover(entry, request.context, request, dispatchPrepared, active.controller.signal).send({ engineId: engine,
          messages: entry.conversation ? await entry.conversation.transcript.history() : conversationNativeMessages(history),
          ...(entry.conversation ? { turnMetadata: { engineId: engine } } : {}),
          ...(request.completedEnvelope ? { completedEnvelope: true, excludedMessageIds: request.excludedMessageIds } : {}), input });
      if (!delivered?.delivered) {
        const error = deliveryFailure(delivered);
        if (entry.conversation) {
          request.admission.resolve({ nativeResult: nativeResult || { value: delivered }, error });
          request.admissionSettled = true;
        }
        throw error;
      }
      if (request.accepted) await publishAdmission(request, nativeResult);
      else {
        const saved = await reads.findSubmittedTurn(entry, request.input.messageId);
        if (!saved && entry.conversation) {
          // An original native-history duplicate need not have an authored
          // application row. Preserve its exact result without inventing a
          // canonical receipt or changing native success into a failure.
          request.admission.resolve({ nativeResult: nativeResult || { value: delivered },
            error: failure("The native receipt has no stored authored message.", "conversation_receipt_unavailable") });
          request.admissionSettled = request.finished = true;
          committed?.resolve();
          await completion;
          return;
        }
        if (!saved) throw new Error("The native receipt has no stored authored message.");
        request.accepted = request.finished = true;
        if (entry.conversation) entry.lastAcceptedRequest = request;
        request.turnId = saved.turnId;
        request.recovered = saved.metadata?.runtime;
        const receipt = { status: "accepted", messageId: request.input.messageId, turnId: saved.turnId,
          origin: request.input.origin, ...(delivered.duplicate ? { duplicate: true } : { recovered: true }) };
        request.admission.resolve(entry.conversation ? { receipt, nativeResult: { value: delivered } } : receipt);
        request.admissionSettled = true;
      }
      committed?.resolve();
      await completion;
    } catch (error) {
      committed?.reject(error);
      await completion?.catch(() => {});
      throw error;
    }
  }

  return Object.freeze({
    turnAttribution,
    writeProgress,
    publishAdmission,
    attachmentReader,
    beforeDispatch,
    deliverNative
  });
}

/** @typedef {ReturnType<typeof createConversationTurnDelivery>} ConversationTurnDelivery */

export { createConversationTurnDelivery };
