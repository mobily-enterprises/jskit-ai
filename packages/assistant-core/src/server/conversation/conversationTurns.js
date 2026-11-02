import { conversationNativeIdentity } from "./runtimeStateUpgrade.js";
import { createConversationTools } from "./tools.js";
import { conversationAttachmentIds } from "./attachments.js";
import { conversationHistoryVersions, conversationRequestText } from "./continuity.js";
import { failure, stateErrorFields } from "./conversationRefusals.js";
import { saveTools, submittedMessage } from "./conversationRecords.js";
import { createConversationTurnDelivery } from "./conversationTurnDelivery.js";

// API history turns within this many newest messages send their files again.
const HISTORY_FILE_MESSAGES = 20;

/**
 * Running one admitted turn: its provider run or native delivery, steering, application
 * tools, native checkpoints, and the progress it saves when it settles.
 * @param {object} dependencies
 * @param {import("./storage.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("./streams.js").ConversationStreams} dependencies.streams
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationDelivery.js").ConversationDelivery} dependencies.delivery
 * @param {import("../types.js").ServiceToolCatalog | null} dependencies.catalog
 * @param {import("../types.js").ConversationAttachments | undefined} dependencies.attachments
 * @param {import("../types.js").ConversationApiHistory | undefined} dependencies.apiHistory
 * @param {() => boolean} dependencies.isClosed Whether the runtime has closed.
 * @param {boolean} dependencies.persistCommentary
 * @param {boolean} dependencies.completedEnvelope
 * @param {number} dependencies.maximumToolCalls
 * @param {number} dependencies.maximumFinalReply
 * @param {number} dependencies.maximumCompletedOutput
 * @param {number} dependencies.maximumContinuity
 * @param {number} dependencies.maximumAttachmentBytes
 */
function createConversationTurns({ storage, streams, events, reads, delivery, catalog, attachments, apiHistory, isClosed, persistCommentary,
  completedEnvelope, maximumToolCalls, maximumFinalReply, maximumCompletedOutput, maximumContinuity, maximumAttachmentBytes }) {
  async function perform(entry, active, configuration) {
    const { driver, engine, segmentId } = entry;
    const bindingOwner = entry.bindingOwner;
    const initial = active.request;
    let current = initial;
    let goalOwner = initial.input.goal ? initial : null;
    let problem;
    const messageOwners = new Map();
    const toolOwners = new Map();
    const rejectionSaves = new Map();
    let toolWork = Promise.resolve();
    let toolFailure;
    const applicationTools = entry.applicationTools;
    const toolStorage = applicationTools?.storage || storage;
    const turnDelivery = createConversationTurnDelivery({ entry, active, driver, engine, segmentId, bindingOwner, rejectionSaves, admit,
      storage, streams, events, reads, delivery, attachments, persistCommentary, maximumContinuity, maximumAttachmentBytes });

    function prepareTools(request) {
      if (request.completedEnvelope || !catalog || entry.conversation && !applicationTools) return;
      request.tools = createConversationTools({ catalog, context: request.context, signal: active.controller.signal,
        ...(applicationTools ? { prepareContext() {
          if (!request.accepted) throw new Error("The application tool does not belong to an admitted message.");
          return applicationTools.prepareContext(request.context, Object.freeze({ conversationId: entry.id,
            turnId: request.turnId, messageId: request.input.messageId, nativeTurnId: request.nativeTurnId,
            nativeThreadId: request.nativeThreadId, origin: request.input.origin,
            assertCurrent() {
              active.controller.signal.throwIfAborted();
              if (entry.active !== active || current !== request || !request.accepted || request.finished) {
                throw failure("This application tool's admitted message is no longer current.", "conversation_application_tool_message_stale", 409, { messageCode: "assistant.conversation.applicationToolMessageStale" });
              }
            },
            ...(entry.conversation ? { assertCompletionCurrent() {
              active.controller.signal.throwIfAborted();
              if (isClosed() || entry.disposed || entry.bindingOwner !== bindingOwner || entry.segmentId !== segmentId ||
                  !active.finishing || active.timedOut || problem || toolFailure || entry.executionFailure || entry.storageFailure ||
                  current !== request || !request.accepted || entry.lastAcceptedRequest !== request ||
                  entry.active && entry.active !== active) {
                throw failure("This native completion's admitted message is no longer current.", "conversation_native_completion_message_stale", 409, { messageCode: "assistant.conversation.nativeCompletionMessageStale" });
              }
            } } : {}) }));
        } } : {}),
        maximumCalls: maximumToolCalls, discoveryOnly: driver.toolDiscovery === true,
        authorize: () => events.access(request.context, entry.id, "tool", entry),
        save: calls => {
          if (!request.accepted) throw new Error("The engine requested an application tool before admitting the message.");
          return toolStorage.write(entry.id, transaction => saveTools(entry, transaction, request, calls));
        },
        emit: event => events.emit(entry, { ...event, turnId: request.turnId })
      });
    }


    async function admit(request, seen, { nativeDelivery = false, conversationTurn } = {}) {
      await events.access(request.context, entry.id, request.operation, entry);
      request.deliveryTiming("admission-authorized");
      if (!conversationTurn) active.controller.signal.throwIfAborted();
      if (request.input.goal) request.goalMessageId = request.input.messageId;
      else if (goalOwner) request.goalMessageId = goalOwner.input.messageId;
      const nativeTurnId = active.nativeTurnId;
      const previous = current;
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
          const versions = await turnDelivery.writeProgress(transaction, previous, "running", "", { continuedBy: request.input.messageId });
          if (engine === "api") Object.assign(metadata.runtime.seen, versions);
        }
        let id;
        if (conversationTurn) {
          const saved = await transaction.readTurn(conversationTurn.turnId);
          if (submittedMessage(saved || {})?.messageId !== request.input.messageId || saved.metadata?.runtime?.segmentId !== segmentId) {
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
            turnMetadata: { runtime: { status: "running", ...turnDelivery.turnAttribution(request, {
              ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
              ...(nativeTurnId ? { nativeTurnId } : {}) }) } } });
        }
        if (engine === "api") {
          metadata.runtime.seen = { ...(seen || metadata.runtime.seen), ...conversationHistoryVersions([await transaction.readTurn(id)]) };
          metadata.runtime.lastEngine = engine;
          delete metadata.runtime.request;
        }
        await transaction.writeMetadata(metadata);
        if (engine !== "api" && !nativeDelivery) await delivery.rememberNative(entry, transaction, [await transaction.readTurn(id)]);
        return id;
      });
      if (previous !== request) {
        previous.sealed = true;
        previous.continuedBy = request.input.messageId;
        if (!driver.canonicalTranscript) streams.clear(entry.id);
      }
      request.accepted = true;
      if (!entry.conversation) request.deliveryTiming("receipt-persisted");
      request.nativeTurnId = nativeTurnId;
      if (request.input.goal) goalOwner = request;
      current = active.request = request;
      if (entry.conversation) entry.lastAcceptedRequest = request;
      if (!nativeDelivery) await turnDelivery.publishAdmission(request);
    }

    async function onNativeTurn({ turnId, nativeOwner = false }) {
      if (active.nativeTurnId === turnId) return;
      if (!nativeOwner || !driver.canonicalTranscript) throw new Error("The native continuation has no original conversation owner.");
      await events.access(current.context, entry.id, current.operation, entry);
      active.controller.signal.throwIfAborted();
      // Original Codex successors retain the admitted request, actor and budget.
      active.nativeTurnId = turnId;
      if (!current.nativeTurnId && !entry.conversation) {
        current.nativeTurnId = turnId;
        await storage.write(entry.id, async transaction => {
          const turn = await transaction.readTurn(current.turnId);
          await transaction.updateTurnMetadata(current.turnId, { runtime: { ...turn.metadata.runtime, nativeTurnId: turnId } });
        });
      }
    }

    async function completeNativeTurn({ turnId, status = "completed", nativeOwner = false }) {
      if (!nativeOwner && active.nativeTurnId !== turnId) throw new Error("The completed native goal turn has a different identity.");
      // The original owner checkpoints from its notification queue. Steering's
      // exact receipt can still be behind that task, so only the outside run
      // continuation joins active.steering; this checkpoint saves admitted work.
      if (!nativeOwner) await active.steering;
      await toolWork;
      if (toolFailure) throw toolFailure;
      const completedStatus = nativeOwner && active.timedOut ? "failed"
        : nativeOwner && active.controller.signal.aborted ? "cancelled" : status === "completed" ? "complete" : status;
      const completedError = nativeOwner && active.timedOut ? "The conversation request exceeded its time limit."
        : nativeOwner && active.controller.signal.aborted ? "Work stopped." : "";
      await storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        const written = [];
        for (const request of active.requests.values()) {
          if (request.turnId && request.accepted && !request.finished &&
              (nativeOwner && driver.canonicalTranscript || request.nativeTurnId === turnId)) {
            const versions = await turnDelivery.writeProgress(transaction, request, completedStatus, completedError);
            if (engine === "api") Object.assign(metadata.runtime.seen, versions);
            else written.push(await transaction.readTurn(request.turnId));
          }
        }
        if (nativeOwner) for (const id of await transaction.listTurnIds()) {
          const turn = await transaction.readTurn(id);
          const saved = turn.metadata?.runtime;
          if (saved?.segmentId !== segmentId || saved.nativeTurnId !== turnId || written.some(row => row.turnId === id)) continue;
          if (["cancelled", "failed"].includes(saved.status)) continue;
          await transaction.updateTurnMetadata(id, { runtime: { ...saved, status: completedStatus } });
          written.push(await transaction.readTurn(id));
        }
        await transaction.writeMetadata(metadata);
        if (written.length) await delivery.rememberNative(entry, transaction, written);
      });
      for (const request of active.requests.values()) {
        if (request.accepted && (nativeOwner && driver.canonicalTranscript || request.nativeTurnId === turnId)) {
          request.finished = request.sealed = true;
        }
      }
      streams.clear(entry.id);
    }
    if (driver.canonicalTranscript && !entry.conversation) active.nativeCheckpoint = input => completeNativeTurn({ ...input, nativeOwner: true });

    async function onMessage(message) {
      const request = messageOwners.get(message.id) || current;
      if (!request.accepted) throw new Error("The engine produced output before admitting the message.");
      messageOwners.set(message.id, request);
      // An already visible native item keeps its original request identity. Late
      // snapshots cannot replay that answer after a newer instruction is admitted.
      if (request.sealed) return;
      await events.setPhase(entry, "working", request.turnId);
      if (request.sealed) return;
      const messageId = `${request.turnId}:${message.id}`;
      const finalReplyLimit = completedEnvelope && request.completedEnvelope && request.input.origin === "application" && !request.input.goal
        ? maximumCompletedOutput : maximumFinalReply;
      if (message.role === "assistant" && message.complete && message.text.length > finalReplyLimit) {
        if (request.answer?.messageId === messageId) request.answer = null;
        throw new Error("The assistant exceeded the configured final reply limit.");
      }
      const previous = request.answer?.messageId === messageId ? request.answer : request.progress.get(messageId);
      const outputOwner = message.outputId && messageOwners.get(message.outputId) || request;
      const outputId = previous?.outputId || (message.outputId ? `${outputOwner.turnId}:${message.outputId}` : "");
      const value = { messageId, ...(outputId ? { outputId } : {}),
        role: message.role, text: message.text, at: previous?.at || new Date().toISOString() };
      const authorship = request.completedEnvelope ? { authorship: { messageId: request.input.messageId,
        turnId: request.turnId, origin: request.input.origin, completedEnvelope: true } } : {};
      // Some native streams have temporary block identities. Only their final
      // history snapshots belong in the transcript, as in the original owner.
      if (message.transient) {
        streams.update(entry.id, { turnId: request.turnId, origin: request.input.origin, ...value, ...authorship });
      } else if (message.role === "assistant") {
        if (request.answer && request.answer.messageId !== messageId) {
          request.progress.set(request.answer.messageId, { ...request.answer, role: "commentary" });
          streams.complete(entry.id, request.answer.messageId);
        }
        request.progress.delete(messageId);
        request.answer = value;
        streams.update(entry.id, { turnId: request.turnId, origin: request.input.origin, ...value, ...authorship });
      } else {
        if (request.answer?.messageId === messageId) request.answer = null;
        if (message.complete) request.progress.set(messageId, value);
        if (message.complete) streams.complete(entry.id, messageId);
        else streams.update(entry.id, { turnId: request.turnId, origin: request.input.origin, ...value, ...authorship });
      }
      await events.emit(entry, { type: "message", turnId: request.turnId, messageId, origin: request.input.origin, role: message.role,
        ...(outputId ? { outputId } : {}),
        text: message.text, status: message.complete ? "complete" : "inProgress", streaming: streams.read(entry.id) });
    }


    active.submit = async request => {
      try {
        prepareTools(request);
        await turnDelivery.deliverNative(request, entry.provider.steer);
      } catch (error) {
        let reported = error;
        if (!request.admissionSettled) {
          try {
            if (!entry.conversation) await storage.write(entry.id, async transaction => {
              const metadata = await transaction.readMetadata();
              if (metadata.runtime.request?.messageId === request.input.messageId) {
                metadata.runtime.request.error = error.message;
                await transaction.writeMetadata(metadata);
              }
            });
          } catch (saveError) { reported = saveError; }
          request.admission.reject(reported);
          if (!request.accepted) active.requests.delete(request.input.messageId);
        }
        if (error.delivery === "uncertain") active.steerError = error.message;
      }
    };

    try {
      await events.setPhase(entry, "preparing");
      const metadata = { runtime: await reads.readState(entry) };
      const continuity = metadata.runtime.continuity;
      // Existing application transcripts precede the first runtime segment.
      // After replacement, their context is already carried by the briefing.
      const inSegment = turn => turn.metadata?.runtime?.segmentId === segmentId ||
        !turn.metadata?.runtime?.segmentId && !continuity;
      // Only the API engine sends the application transcript as history; after
      // a compaction, only the turns its summary doesn't cover.
      const summary = engine === "api" ? await reads.readSummary(entry, inSegment) : null;
      const recordedHistory = engine === "api" ? await reads.readTranscript(entry, summary?.throughTurnId) : [];
      const activeHistory = recordedHistory.filter(turn => !turn.metadata?.runtime?.supersededBy);
      const history = activeHistory.filter(inSegment);
      prepareTools(initial);
      const tools = initial.tools && { descriptors: initial.tools.descriptors, schemas: initial.tools.schemas, maximumArgumentBytes: initial.tools.maximumArgumentBytes,
        execute(input, options) {
          const request = toolOwners.get(input.id) || (options?.messageId ? active.requests.get(options.messageId) : current);
          if (!request?.accepted) throw new Error("The application tool does not belong to an admitted message.");
          toolOwners.set(input.id, request);
          // Calls already in flight retain their actor and turn. Keep application
          // mutations ordered across steering as well as within each request.
          const work = toolWork.then(() => request.tools.execute(input, options));
          toolWork = work.catch(error => {
            // Claude accepts a separate successor query; its predecessor's
            // effect cannot fail that query. Other engines retain the original
            // active-turn failure guard across steering.
            if (engine !== "claude" || current === request) toolFailure ||= error;
          });
          return work;
        }
      };
      const completedToolSet = engine === "claude" && initial.completedEnvelope && typeof initial.nativeToolAttempt === "boolean"
        ? catalog.resolveToolSet(initial.context) : null;
      const providerInput = { configuration, context: initial.context, tools,
        ...(completedToolSet ? {
          async onNativeToolUse({ messageId, threadId, name }) {
            await initial.deliveryCommitted;
            active.controller.signal.throwIfAborted();
            if (entry.disposed || entry.active !== active || current !== initial || !initial.accepted || initial.finished || initial.sealed ||
                entry.bindingOwner !== bindingOwner || entry.segmentId !== segmentId ||
                messageId !== initial.input.messageId || threadId !== initial.nativeThreadId) {
              throw failure("The native tool observation belongs to a retired response.", "conversation_tool_observation_retired", 409, { messageCode: "assistant.conversation.toolObservationRetired" });
            }
            if (!completedToolSet.byName.has(name)) return;
            await storage.write(entry.id, async transaction => {
              const metadata = await transaction.readMetadata();
              const turn = await transaction.readTurn(initial.turnId);
              const saved = turn?.metadata?.runtime;
              if (metadata.runtime.engine !== engine || metadata.runtime.segmentId !== segmentId ||
                  conversationNativeIdentity(metadata.runtime) !== threadId || submittedMessage(turn || {})?.messageId !== messageId ||
                  saved?.engine !== engine || saved.segmentId !== segmentId || saved.completedEnvelope !== true ||
                  typeof saved.nativeToolAttempt !== "boolean" || saved.status !== "running" || saved.supersededBy ||
                  entry.active !== active || current !== initial || initial.finished || initial.sealed || active.controller.signal.aborted) {
                throw failure("The native tool observation lost its exact admitted receipt.", "conversation_tool_observation_receipt_lost", 409, { messageCode: "assistant.conversation.toolObservationReceiptLost" });
              }
              await transaction.updateTurnMetadata(initial.turnId, { runtime: { ...saved, nativeToolAttempt: true } });
            });
            initial.nativeToolAttempt = true;
          }
        } : {}),
        ...(engine === "opencode" || entry.conversation && ["codex", "claude"].includes(engine) ? {
          async finishIfCurrent(isCurrent) {
            // A reserved Send may still be preparing when the native turn ends.
            // Join that same admission outside the native notification queue.
            for (;;) {
              const steering = active.steering;
              await steering;
              if (active.steering && active.steering !== steering) continue;
              if (!isCurrent()) return false;
              active.finishing = true;
              return true;
            }
          }
        } : {}),
        onMessage, onNativeTurn,
        onEvent: async event => {
          if (event.type === "message-complete") {
            const request = messageOwners.get(event.messageId);
            if (!request) return;
            const messageId = `${request.turnId}:${event.messageId}`;
            streams.complete(entry.id, messageId);
            return events.emit(entry, { ...event, turnId: request.turnId, messageId, streaming: streams.read(entry.id) });
          }
          if (event.type === "goal") {
            if (!driver.canonicalTranscript && event.goal?.status === "active" && !goalOwner) {
              await events.access(current.context, entry.id, "goal", entry);
              await storage.write(entry.id, async transaction => {
                const turn = await transaction.readTurn(current.turnId);
                await transaction.updateTurnMetadata(current.turnId, { runtime: { ...turn.metadata.runtime, goalMessageId: current.input.messageId } });
              });
              goalOwner = current;
              current.goalMessageId = current.input.messageId;
            }
            entry.goal = event.goal;
          }
          return event.type === "phase" ? events.setPhase(entry, event.phase, current.turnId) : events.emit(entry, { ...event, turnId: current.turnId });
        }
      };
      if (engine === "api") {
        const readAttachments = turnDelivery.attachmentReader(initial);
        const files = await readAttachments(initial.input.attachments);
        initial.input.attachments = files.attachments;
        const selectedHistory = apiHistory ? structuredClone(await apiHistory({ context: initial.context })) : undefined;
        let requestHistory;
        if (selectedHistory !== undefined) {
          if (!Array.isArray(selectedHistory)) throw new TypeError("API request history must be an array of authored user/assistant context rows.");
          requestHistory = [];
          for (const message of selectedHistory) {
            if (!["user", "assistant"].includes(message?.role) || typeof message.content !== "string") {
              throw new TypeError("API request history requires user/assistant roles and text content.");
            }
            const attachmentIds = conversationAttachmentIds(message.attachmentIds);
            if (message.role !== "user" && attachmentIds.length) throw new TypeError("Only authored user context may reference attachments.");
            const previousFiles = await readAttachments(attachmentIds.map(attachmentId => ({ attachmentId })));
            requestHistory.push({ role: message.role, content: previousFiles.content.length
              ? [{ type: "text", text: message.content }, ...previousFiles.content] : message.content });
          }
        } else {
          // Files go to the model again only within the newest messages; older
          // turns name theirs, so a long chat's files never outgrow one request.
          let newer = 0;
          for (const turn of history.toReversed()) {
            newer += turn.messages.filter(message => ["user", "system", "assistant"].includes(message.role)).length;
            const message = submittedMessage(turn);
            if (!message?.attachments?.length) continue;
            message.content = newer <= HISTORY_FILE_MESSAGES ? (await readAttachments(message.attachments)).content
              : [{ type: "text", text: `(Files attached to this message, no longer shown: ${message.attachments.map(file => file.fileName).join(", ")}.)` }];
          }
        }
        // The versions saved before a summary still stand for the turns it covers.
        const seen = summary ? { ...metadata.runtime.seen, ...conversationHistoryVersions(activeHistory) }
          : conversationHistoryVersions(activeHistory);
        const priorFiles = await readAttachments(metadata.runtime.continuityAttachments || []);
        const input = { ...initial.input, text: conversationRequestText(initial.input), contextText: "",
          content: [...priorFiles.content, ...files.content] };
        await storage.write(entry.id, async transaction => {
          const metadata = await transaction.readMetadata();
          metadata.runtime.request.seen = seen;
          metadata.runtime.request.attachments = files.attachments;
          await transaction.writeMetadata(metadata);
        });
        const completion = await entry.provider.run({ ...providerInput, input, signal: active.controller.signal, continuity, history, requestHistory,
          beforeDispatch: () => turnDelivery.beforeDispatch(initial), accept: () => admit(initial, seen),
          ...(entry.conversation ? {} : { summary: summary?.text || "",
            saveSummary: saved => storage.write(entry.id, transaction => transaction.writeSummary(saved)) }) });
        if (completion?.metadata && Object.keys(completion.metadata).length) {
          await storage.write(entry.id, transaction => transaction.updateTurnMetadata(initial.turnId, { completion: completion.metadata }));
        }
      } else {
        await turnDelivery.deliverNative(initial, input => entry.provider.run({ ...providerInput, ...input }));
      }
      active.controller.signal.throwIfAborted();
    } catch (error) { problem = error; }
    active.finishing = true;
    await active.steering;
    await toolWork;
    problem ||= toolFailure;
    clearTimeout(active.timer);
    if (problem?.cleanupFailed) {
      entry.executionFailure = problem;
      entry.cleanupTurnId = current.turnId;
    }
    const status = entry.executionFailure ? "interrupted" : active.timedOut ? "failed" : active.controller.signal.aborted ? "cancelled"
      : problem?.status === "interrupted" ? "interrupted" : problem ? "failed" : initial.recovered?.status || "complete";
    const error = entry.executionFailure?.message || (active.timedOut ? "The conversation request exceeded its time limit."
      : status === "cancelled" ? "Work stopped." : problem?.message || active.steerError || initial.recovered?.error || "");
    entry.saveProgress = async () => {
      if (entry.conversation) {
        if (applicationTools) await toolStorage.write(entry.id, async transaction => {
          for (const request of active.requests.values()) {
            if (request.accepted && request.tools?.records().length) await saveTools(entry, transaction, request, request.tools.records());
          }
        });
        // Only opted-in application receipts are saved above. Native output,
        // checkpoints and status remain with the original run owner and sender.
        entry.error = error;
        entry.storageFailure = null;
        entry.saveProgress = null;
        return { type: "settled", turnId: current.turnId, status, error, ...stateErrorFields(error) };
      }
      // Preserve the common storage-retry facility by retrying the original
      // failed rejection save, never by deleting or rebuilding its frozen draft.
      for (const [messageId, save] of rejectionSaves) {
        const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
        if (runtime.request?.messageId === messageId) await save();
        rejectionSaves.delete(messageId);
      }
      await storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        const written = [];
        for (const request of active.requests.values()) {
          if (request.accepted && !request.finished) {
            const versions = await turnDelivery.writeProgress(transaction, request, status, error);
            if (engine === "api") Object.assign(metadata.runtime.seen, versions);
            else written.push(await transaction.readTurn(request.turnId));
          }
        }
        if (!initial.accepted && metadata.runtime.request?.messageId === initial.input.messageId) {
          if (engine !== "api" || problem?.delivery === "uncertain") metadata.runtime.request.error = error;
          else delete metadata.runtime.request;
        }
        await transaction.writeMetadata(metadata);
        if (written.length) await delivery.rememberNative(entry, transaction, written);
      });
      streams.clear(entry.id);
      entry.error = error;
      entry.storageFailure = null;
      entry.saveProgress = null;
      return { type: "settled", turnId: current.turnId, status, error: entry.error, ...stateErrorFields(entry.error) };
    };
    try { await entry.saveProgress(); }
    catch (saveError) {
      entry.error = "Conversation progress could not be saved. Restore access to its storage before continuing.";
      entry.storageFailure = failure(entry.error, "conversation_storage_unavailable", 503);
      entry.storageFailure.cause = saveError;
      problem ||= saveError;
    }
    if (!initial.admissionSettled) initial.admission.reject(problem || new Error("The engine did not acknowledge the message."));
    entry.active = null;
    await events.setPhase(entry, "", current.turnId);
    await events.emit(entry, { type: "settled", turnId: current.turnId, status: entry.storageFailure || entry.executionFailure ? "failed" : status,
      error: entry.error, ...stateErrorFields(entry.error) });
  }

  return Object.freeze({
    perform
  });
}

/** @typedef {ReturnType<typeof createConversationTurns>} ConversationTurns */

export { createConversationTurns };
