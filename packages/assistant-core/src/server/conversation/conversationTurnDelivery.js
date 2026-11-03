import { conversationAttachmentManifest } from "../../shared/conversation/attachments.js";
import { createConversationAttachmentReader } from "./attachments.js";
import { conversationHistoryVersions, conversationNativeMessages, conversationRequestText, notifyNoPromptRejected,
  notifyNoPromptSending } from "./continuity.js";
import { deliveryFailure, failure } from "./conversationRefusals.js";
import { submittedMessage } from "./conversationReads.js";

/** @typedef {import("./conversationEntries.js").ConversationEntry} ConversationEntry */
/** @typedef {import("./conversationTurns.js").ActiveTurn} ActiveTurn */
/** @typedef {import("./conversationSending.js").ConversationRequest} ConversationRequest */

/**
 * How a running turn admits and delivers its requests: their admission and its publication, the
 * attribution and progress every saved turn records, attachment reading and native dispatch.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationStreams} dependencies.streams
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationDelivery.js").ConversationDelivery} dependencies.delivery
 * @param {import("../types.js").ConversationAttachments} dependencies.attachments
 * @param {boolean} dependencies.persistCommentary
 * @param {number} dependencies.maximumContinuity
 * @param {number} dependencies.maximumAttachmentBytes
 */
function createConversationTurnDelivery({ storage, streams, events, reads, delivery, attachments, persistCommentary, maximumContinuity,
  maximumAttachmentBytes }) {
  /**
   * Every saved turn and pending request records its attribution identically.
   * @param {ActiveTurn} active
   * @param {ConversationRequest} request
   * @param {object} [extra]
   */
  const turnAttribution = (active, request, extra = {}) => ({ engine: active.engine, segmentId: active.segmentId, origin: request.input.origin,
    ...(request.completedEnvelope ? { completedEnvelope: true } : {}),
    ...(typeof request.nativeToolAttempt === "boolean" ? { nativeToolAttempt: request.nativeToolAttempt } : {}), ...extra });
  /** @param {ConversationRequest} request */
  const authoredRequestRecord = request => ({ ...request.input, at: request.at,
    ...(request.completedEnvelope ? { completedEnvelope: true, excludedMessageIds: request.excludedMessageIds } : {}),
    ...(typeof request.nativeToolAttempt === "boolean" ? { nativeToolAttempt: request.nativeToolAttempt } : {}) });

  /**
   * Saves a request's progress on its turn, and returns the history versions it wrote.
   * @param {ActiveTurn} active
   * @param {object} transaction
   * @param {ConversationRequest} request
   * @param {string} status
   * @param {string} [error]
   * @param {object} [extra]
   */
  async function writeProgress(active, transaction, request, status, error = "", extra = {}) {
    if (request.tools) await transaction.updateTurnMetadata(request.turnId, { applicationTools: request.tools.records() });
    if (!active.driver.canonicalTranscript) {
      for (const message of request.progress.values()) {
        if (!persistCommentary && message.role === "commentary") continue;
        if (!await transaction.hasMessage(message.messageId)) await transaction.appendMessage(request.turnId, message);
      }
      if (request.answer?.text.trim()) await transaction.replaceAssistant(request.turnId, request.answer);
    }
    const saved = active.driver.canonicalTranscript ? await transaction.readTurn(request.turnId) : null;
    await transaction.updateTurnMetadata(request.turnId, { runtime: { ...saved?.metadata?.runtime, status, ...turnAttribution(active, request, {
      ...(request.nativeTurnId ? { nativeTurnId: request.nativeTurnId } : {}),
      ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
      ...(request.continuedBy ? { continuedBy: request.continuedBy } : {}) }), ...extra, ...(error ? { error } : {}) } });
    return conversationHistoryVersions([{ turnId: request.turnId,
      messages: [...request.progress.values()].filter(message => !(message.turnId === request.turnId && message.status === "complete"))
        .concat(request.answer?.text.trim() ? [request.answer] : []) }]);
  }

  /**
   * Admits a request into the running turn: its receipt is saved on its turn (or located in a bound
   * conversation's transcript), and the request becomes the one the turn answers.
   * @param {ConversationEntry} entry
   * @param {ActiveTurn} active
   * @param {ConversationRequest} request
   * @param {Record<string, string> | undefined} seen The history versions an API request sends.
   * @param {{ nativeDelivery?: boolean, conversationTurn?: { turnId: string } | null }} [options]
   */
  async function admit(entry, active, request, seen, { nativeDelivery = false, conversationTurn = null } = {}) {
    await events.access(request.context, entry.id, request.operation, entry);
    request.deliveryTiming("admission-authorized");
    if (!conversationTurn) active.controller.signal.throwIfAborted();
    if (request.input.goal) request.goalMessageId = request.input.messageId;
    else if (active.goalOwner) request.goalMessageId = active.goalOwner.input.messageId;
    const nativeTurnId = active.nativeTurnId;
    const previous = active.request;
    if (entry.conversation) {
      const saved = conversationTurn?.turnId ? await reads.readBoundTurn(entry, conversationTurn.turnId) : null;
      request.deliveryTiming("turn-located");
      if (submittedMessage(saved || {})?.messageId !== request.input.messageId) {
        throw new Error("The native receipt does not belong to this authored request.");
      }
      request.turnId = saved.turnId;
    } else request.turnId = await storage.write(entry.id, async transaction => {
      const metadata = await transaction.readMetadata();
      if (metadata.runtime.request?.messageId !== request.input.messageId) throw new Error("The pending conversation message changed before admission.");
      if (previous !== request && !previous.finished) {
        const versions = await writeProgress(active, transaction, previous, "running", "", { continuedBy: request.input.messageId });
        if (active.engine === "api") Object.assign(metadata.runtime.seen, versions);
      }
      let id;
      if (conversationTurn) {
        const saved = await transaction.readTurn(conversationTurn.turnId);
        if (submittedMessage(saved || {})?.messageId !== request.input.messageId || saved.metadata?.runtime?.segmentId !== active.segmentId) {
          throw new Error("The native receipt does not belong to this authored request.");
        }
        if (request.completedEnvelope && saved.metadata.runtime.completedEnvelope !== true) {
          throw new Error("The native receipt lost its completed-response marker.");
        }
        id = saved.turnId;
        await transaction.updateTurnMetadata(id, { runtime: { ...saved.metadata.runtime,
          ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
          ...(nativeTurnId ? { nativeTurnId } : {}) } });
      } else {
        id = await transaction.nextTurnId();
        await transaction.appendMessage(id, { role: request.input.origin === "application" ? "system" : "user", ...request.input, at: new Date().toISOString(),
          turnMetadata: { runtime: { status: "running", ...turnAttribution(active, request, {
            ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
            ...(nativeTurnId ? { nativeTurnId } : {}) }) } } });
      }
      if (active.engine === "api") {
        metadata.runtime.seen = { ...(seen || metadata.runtime.seen), ...conversationHistoryVersions([await transaction.readTurn(id)]) };
        metadata.runtime.lastEngine = active.engine;
        delete metadata.runtime.request;
      }
      await transaction.writeMetadata(metadata);
      if (active.engine !== "api" && !nativeDelivery) await delivery.rememberNative(entry, transaction, [await transaction.readTurn(id)]);
      return id;
    });
    if (previous !== request) {
      previous.sealed = true;
      previous.continuedBy = request.input.messageId;
      if (!active.driver.canonicalTranscript) streams.clear(entry.id);
    }
    request.accepted = true;
    if (!entry.conversation) request.deliveryTiming("receipt-persisted");
    request.nativeTurnId = nativeTurnId;
    if (request.input.goal) active.goalOwner = request;
    active.request = request;
    if (entry.conversation) entry.lastAcceptedRequest = request;
    if (!nativeDelivery) await publishAdmission(entry, active, request);
  }

  /**
   * Resolves a request's admission and tells subscribers, with the native items it already owns.
   * @param {ConversationEntry} entry
   * @param {ActiveTurn} active
   * @param {ConversationRequest} request
   * @param {unknown} [nativeResult]
   */
  async function publishAdmission(entry, active, request, nativeResult) {
    request.deliveryTiming("accepted");
    const receipt = { status: "accepted", messageId: request.input.messageId, turnId: request.turnId, origin: request.input.origin };
    request.admission.resolve(entry.conversation ? { receipt, nativeResult } : receipt);
    request.admissionSettled = true;
    await events.emit(entry, { type: "accepted", ...receipt });
    if (active.driver.canonicalTranscript && !entry.conversation) {
      // Native items can complete before common admission finishes. Their
      // exact request already owns them; publish before tools join the
      // existing delivery commit, without blocking the native event queue.
      for (const [id, message] of request.progress) {
        if (message.turnId !== request.turnId || message.status !== "complete") continue;
        request.progress.delete(id);
        if (request.sealed || entry.disposed || entry.active !== active ||
            entry.bindingOwner !== active.bindingOwner || entry.segmentId !== active.segmentId) continue;
        await events.emit(entry, { type: "message", ...message, streaming: streams.read(entry.id) },
          () => !entry.disposed && !request.sealed && entry.active === active && entry.bindingOwner === active.bindingOwner &&
            entry.segmentId === active.segmentId);
      }
    }
    request.admissionPublished = true;
    await events.setPhase(entry, "working", request.turnId);
    if ((entry.conversation || active.driver.canonicalTranscript) && entry.nativePhase && entry.nativePhase !== "working") await events.setPhase(entry, entry.nativePhase, request.turnId);
  }

  /**
   * @param {ConversationEntry} entry
   * @param {ActiveTurn} active
   * @param {ConversationRequest} request
   */
  function attachmentReader(entry, active, request) {
    return createConversationAttachmentReader({ attachments, context: request.context, conversationId: entry.id,
      signal: active.controller.signal, authorize: () => events.access(request.context, entry.id, request.operation, entry),
      types: active.driver.attachmentTypes, maximumBytes: maximumAttachmentBytes });
  }

  /**
   * The last checks before a request is dispatched to its engine.
   * @param {ConversationEntry} entry
   * @param {ActiveTurn} active
   * @param {ConversationRequest} request
   */
  async function beforeDispatch(entry, active, request) {
    await events.access(request.context, entry.id, request.operation, entry);
    active.controller.signal.throwIfAborted();
    if (request.input.goal && request.context?.signal?.aborted) {
      throw Object.assign(failure("The goal command was stopped before delivery.", "conversation_goal_stopped"), { delivery: "not-sent" });
    }
    if (active.finishing) throw Object.assign(failure("The native turn finished before this instruction was sent. Send it as a new message.", "conversation_steer_turn_finished", 409, { messageCode: "assistant.conversation.turnFinishedBeforeSend" }), { delivery: "not-sent" });
  }

  /**
   * Delivers a request to its native engine through the changeover that catches the engine up,
   * then admits it when the engine acknowledges it.
   * @param {ConversationEntry} entry
   * @param {ActiveTurn} active
   * @param {ConversationRequest} request
   * @param {(input: object) => Promise<unknown>} dispatch Runs the engine with the prepared input.
   */
  async function deliverNative(entry, active, request, dispatch) {
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
      active.rejectionSaves.delete(request.input.messageId);
      if (request.operation === "steer" && !request.steering) throw Object.assign(failure("There is no active native turn to steer. Send a new message.", "conversation_steer_turn_finished", 409, { messageCode: "assistant.conversation.noActiveTurnToSteer" }), { delivery: "not-sent" });
      if ((input.contextText || "").length > maximumContinuity) throw new Error("Conversation updates exceed the configured history budget. Renew the context with a continuity briefing before continuing.");
      if (request.input.goal && input.contextText) {
        throw failure("Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal.", "conversation_briefing_before_terminal", 409, { messageCode: "assistant.conversation.briefingBeforeTerminal" });
      }
      const readAttachments = attachmentReader(entry, active, request);
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
        ...(active.engine === "opencode" ? { deliveryCommitted: committed.promise } : {}),
        async beforeDispatch(native) {
          request.deliveryTiming("runtime-ready");
          await beforeDispatch(entry, active, request);
          threadId = native?.threadId;
          if (!threadId) throw new Error("Native admission requires the saved conversation identity.");
          await input.onPromptSending(entry.conversation ? native : { threadId, displayAttachments: files.attachments,
            turnMetadata: { runtime: turnAttribution(active, request) } });
          if (request.input.goal && request.context?.signal?.aborted) {
            throw Object.assign(failure("The goal command was stopped before delivery.", "conversation_goal_stopped"), { delivery: "not-sent" });
          }
          request.deliveryTiming("dispatch-started");
        },
        async accept(native) {
          if (entry.conversation) nativeResult = native.nativeResult;
          if (native?.nativeTurnId) active.nativeTurnId = native.nativeTurnId;
          request.nativeThreadId = threadId;
          await admit(entry, active, request, undefined, { nativeDelivery: true, conversationTurn: native?.conversationTurn });
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
            active.rejectionSaves.set(request.input.messageId, input.onPromptRejected);
            error = saveError;
          }
        }
        admitted.reject(error);
        throw error;
      });
      completion.catch(() => {});
      return admitted.promise;
    };
    // A native caller's own input may carry its prompt callbacks.
    const { onPromptSending: originalPromptSending = notifyNoPromptSending,
      onPromptRejected: originalPromptRejected = notifyNoPromptRejected } = request.originalInput || {};
    try {
      const input = {
        ...request.originalInput,
        messageId: request.input.messageId,
        message: request.originalInput ? request.originalInput.message ?? request.originalInput.text ?? "" : conversationRequestText(request.input),
        displayMessage: request.input.text,
        displayAttachments: request.originalInput?.displayAttachments || request.input.attachments,
        attachmentIds: request.input.attachments.map(file => file.attachmentId),
        async onPromptSending({ threadId, displayAttachments, turnMetadata }) {
          if (entry.conversation) return originalPromptSending({ threadId, displayAttachments, turnMetadata });
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
          if (entry.conversation) return originalPromptRejected();
          await storage.write(entry.id, async transaction => {
            const metadata = await transaction.readMetadata();
            if (metadata.runtime.request?.messageId === request.input.messageId) {
              metadata.runtime.request.attempted = false;
              await transaction.writeMetadata(metadata);
            }
          });
        }
      };
      // A native goal command calls the native sender directly. Chat
      // context rendering and its delivery cursor must not change /goal input.
      const delivered = entry.conversation && request.input.goal
        ? await dispatchPrepared(input)
        : await delivery.nativeChangeover(entry, request.context, request, dispatchPrepared, active.controller.signal).send({ engineId: active.engine,
          messages: entry.conversation ? await entry.conversation.transcript.history() : conversationNativeMessages(history),
          ...(entry.conversation ? { turnMetadata: { engineId: active.engine } } : {}),
          ...(request.completedEnvelope ? { completedEnvelope: true, excludedMessageIds: request.excludedMessageIds } : {}), input });
      if (!delivered?.delivered) {
        const error = deliveryFailure(delivered);
        if (entry.conversation) {
          request.admission.resolve({ nativeResult: nativeResult || { value: delivered }, error });
          request.admissionSettled = true;
        }
        throw error;
      }
      if (request.accepted) await publishAdmission(entry, active, request, nativeResult);
      else {
        const saved = await reads.findSubmittedTurn(entry, request.input.messageId);
        if (!saved && entry.conversation) {
          // A duplicate found in native history need not have an authored
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
    writeProgress,
    admit,
    attachmentReader,
    beforeDispatch,
    deliverNative
  });
}

/** @typedef {ReturnType<typeof createConversationTurnDelivery>} ConversationTurnDelivery */

export { createConversationTurnDelivery };
