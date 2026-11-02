import { isDeepStrictEqual } from "node:util";
import { isCompletedEnvelopeTurn } from "./transcript.js";
import { conversationNativeIdentity } from "./runtimeStateUpgrade.js";
import { createConversationTools } from "./tools.js";
import { readAssistantResponseEnvelope } from "./boundedToolLoop.js";
import { conversationMessageIdentity, conversationMessageVersion } from "./continuity.js";
import { failure } from "./conversationRefusals.js";
import { saveTools, submittedMessage } from "./conversationRecords.js";
import { serial } from "./conversationEvents.js";

/**
 * A completed native response handed to the application worker: its verified text, and
 * either the plain reply it publishes or the one application operation it runs.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationTranscript | null} dependencies.transcript
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("../types.js").ServiceToolCatalog | null} dependencies.catalog
 * @param {() => boolean} dependencies.isClosed Whether the runtime has closed.
 * @param {boolean} dependencies.completedEnvelope
 * @param {number} dependencies.maximumToolCalls
 */
function createCompletedResponses({ storage, transcript, events, catalog, isClosed, completedEnvelope, maximumToolCalls }) {
  async function prepareCompletedResponse(entry, context, { messageId, turnId } = {}, { signal, toolSet } = {}) {
    if (!completedEnvelope || entry.conversation || !["codex", "claude", "opencode"].includes(entry.engine)) {
      throw failure("This conversation does not own completed envelopes.", "conversation_completed_envelopes_not_owned", 400, { messageCode: "assistant.conversation.completedEnvelopesNotOwned" });
    }
    if (typeof messageId !== "string" || !messageId || typeof turnId !== "string" || !turnId || !(signal instanceof AbortSignal)) {
      throw new TypeError("Completed responses require their exact receipt and the application worker signal.");
    }
    signal.throwIfAborted();
    await events.access(context, entry.id, "tool", entry);
    const owner = entry.bindingOwner;
    const segmentId = entry.segmentId;
    const engine = entry.engine;
    const toolCallId = `${messageId}:operation`;
    if (toolCallId.length > 256) throw new TypeError("The completed response call identity exceeds its limit.");
    let captured;

    async function exact(transaction, { retry = false } = {}) {
      if (isClosed() || entry.disposed || entry.bindingOwner !== owner || entry.segmentId !== segmentId || entry.engine !== engine) {
        throw failure("The completed response owner changed.", "conversation_response_owner_changed", 409, { messageCode: "assistant.conversation.responseOwnerChanged" });
      }
      if (entry.active) throw failure("Wait for the native response to finish.", "conversation_busy", 409, { messageCode: "assistant.conversation.waitForNativeResponse" });
      if (entry.executionFailure) throw entry.executionFailure;
      if (entry.storageFailure && !retry) throw entry.storageFailure;
      const { runtime } = await transaction.readMetadata();
      const turn = await transaction.readTurn(turnId);
      const authored = submittedMessage(turn || {});
      const saved = turn?.metadata?.runtime;
      if (runtime?.version !== 3 || runtime.engine !== engine || runtime.segmentId !== segmentId ||
          runtime.replacement || runtime.request || !conversationNativeIdentity(runtime) || authored?.messageId !== messageId ||
          authored.origin !== "application" || saved?.completedEnvelope !== true || saved.engine !== engine ||
          saved.segmentId !== segmentId || saved.status !== "complete" || saved.supersededBy ||
          typeof turn.assistant?.text !== "string" || !turn.assistant.text || !turn.assistant.messageId) {
        throw failure("The completed response has no current verified receipt.", "conversation_completed_response_no_receipt", 409, { messageCode: "assistant.conversation.completedResponseNoReceipt" });
      }
      const turnIds = await transaction.listTurnIds();
      for (const id of turnIds.slice(turnIds.indexOf(turnId) + 1)) {
        const later = await transaction.readTurn(id);
        if (later.metadata?.runtime?.segmentId === segmentId && later.metadata.runtime.completedEnvelope === true) {
          throw failure("A newer completed response owns this worker.", "conversation_newer_response_owns_worker", 409, { messageCode: "assistant.conversation.newerResponseOwnsWorker" });
        }
      }
      // These verified process references may refresh on cold inspection;
      // all native conversation, path and account custody remains exact.
      const { codexAppServerRun: run, executionId, processDirectory, ...binding } = runtime.binding;
      if (engine === "codex" && (!saved.nativeTurnId || run?.outerTurnId !== messageId ||
          run.providerThreadId !== binding.threadId || run.providerTurnId !== saved.nativeTurnId || run.active || run.state !== "completed")) {
        throw failure("The completed response has no exact native turn receipt.", "conversation_completed_response_no_turn_receipt", 409, { messageCode: "assistant.conversation.completedResponseNoTurnReceipt" });
      }
      if (engine === "claude" && typeof saved.nativeToolAttempt !== "boolean") {
        throw failure("The completed Claude response has no native tool-attempt evidence.", "conversation_completed_claude_no_tool_evidence", 409, { messageCode: "assistant.conversation.completedClaudeNoToolEvidence" });
      }
      const calls = turn.metadata.applicationTools || [];
      if (!Array.isArray(calls) || calls.length > 1 || calls.some(call => call.id !== toolCallId)) {
        throw failure("This response already belongs to a different application operation.", "conversation_response_other_operation", 409, { messageCode: "assistant.conversation.responseOtherOperation" });
      }
      const identity = { configuration: runtime.configuration, binding, assistant: turn.assistant,
        nativeTurnId: saved.nativeTurnId, ...(engine === "claude" ? { nativeToolAttempt: saved.nativeToolAttempt } : {}) };
      if (captured && !isDeepStrictEqual(captured, identity)) {
        throw failure("The completed response identity changed.", "conversation_response_identity_changed", 409, { messageCode: "assistant.conversation.responseIdentityChanged" });
      }
      return { runtime, turn, calls, identity };
    }

    async function inspect() {
      signal.throwIfAborted();
      await events.access(context, entry.id, "tool", entry);
      const saved = await storage.read(entry.id, transaction => exact(transaction));
      const observation = await entry.provider.inspectAdmission({ messageId,
        threadId: conversationNativeIdentity(saved.runtime), nativeTurnId: saved.turn.metadata.runtime.nativeTurnId,
        configuration: saved.runtime.configuration, receiptBinding: saved.runtime.binding, context, verifyAccount: true });
      signal.throwIfAborted();
      await events.access(context, entry.id, "tool", entry);
      if (!observation?.accepted || observation.recoveryLimitation || observation.conversationTurn &&
          observation.conversationTurn.turnId !== turnId || engine === "codex" && observation.nativeTurnId !== saved.turn.metadata.runtime.nativeTurnId) {
        throw failure("The native owner could not verify this response association.", "conversation_response_association_unverified", 409, { messageCode: "assistant.conversation.responseAssociationUnverified" });
      }
      // Canonical successful completion owns the exact final, including a
      // StructuredOutput carrier whose native history may contain only commentary.
      captured ||= structuredClone(saved.identity);
      return storage.read(entry.id, transaction => exact(transaction));
    }

    const response = await inspect();
    return { text: response.turn.assistant.text, toolCallId,
      ...(engine === "claude" ? { nativeToolAttempt: response.turn.metadata.runtime.nativeToolAttempt } : {}),
      publishReply(input) {
        return serial(entry, async () => {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "turnId") ||
              typeof input.turnId !== "string" || !input.turnId || input.turnId !== input.turnId.trim() || input.turnId.length > 128) {
            throw new TypeError("Reply publication requires only its exact existing plain turn id.");
          }
          await inspect();
          return storage.write(entry.id, async transaction => {
            const saved = await exact(transaction);
            signal.throwIfAborted();
            const decoded = readAssistantResponseEnvelope(saved.turn.assistant.text);
            if (decoded.kind !== "reply" || saved.turn.metadata.runtime.nativeToolAttempt === true || saved.calls.length) {
              throw failure("This completed response does not own a plain reply.", "conversation_completed_response_no_plain_reply", 409, { messageCode: "assistant.conversation.completedResponseNoPlainReply" });
            }
            const text = decoded.text.trim();
            const target = await transaction.readTurn(input.turnId);
            if (!text || input.turnId === turnId || !target || isCompletedEnvelopeTurn(target) ||
                target.metadata?.runtime?.engine || !(target.user || target.system) || saved.runtime.lastEngine !== engine ||
                !saved.runtime.seen || typeof saved.runtime.seen !== "object" || Array.isArray(saved.runtime.seen)) {
              throw failure("The completed reply has no current plain authored target.", "conversation_completed_reply_no_target", 409, { messageCode: "assistant.conversation.completedReplyNoTarget" });
            }
            const assistantId = conversationMessageIdentity(input.turnId, { role: "assistant" });
            const published = saved.turn.metadata.runtime.publishedReplyTurnId;
            if (published !== undefined) {
              if (published !== input.turnId || !target.assistant || target.assistant.text !== text ||
                  saved.runtime.seen[assistantId] !== conversationMessageVersion(target.assistant, { includeData: true })) {
                throw failure("The published reply target or text changed.", "conversation_published_reply_changed", 409, { messageCode: "assistant.conversation.publishedReplyChanged" });
              }
              signal.throwIfAborted();
              return target;
            }
            if (target.assistant || Object.hasOwn(saved.runtime.seen, assistantId)) {
              throw failure("This plain reply target already has unassociated content or consumption.", "conversation_reply_target_used", 409, { messageCode: "assistant.conversation.replyTargetUsed" });
            }
            // The runtime transcript uses this same reentrant wrapper: its
            // original upsert joins this draft rather than starting a second write.
            const plain = await transcript.upsertConversationAssistantMessage(entry.id, { turnId: input.turnId, text });
            saved.runtime.seen[assistantId] = conversationMessageVersion(plain.assistant, { includeData: true });
            await transaction.updateTurnMetadata(turnId, { runtime: { ...saved.turn.metadata.runtime, publishedReplyTurnId: input.turnId } });
            const metadata = await transaction.readMetadata();
            await transaction.writeMetadata({ ...metadata, runtime: saved.runtime });
            await exact(transaction);
            signal.throwIfAborted();
            return plain;
          });
        });
      },
      tools: { execute(input, options = {}) {
        return serial(entry, async () => {
          if (input?.id !== toolCallId) throw failure("The operation has a different completed response identity.", "conversation_operation_response_identity", 409, { messageCode: "assistant.conversation.operationResponseIdentity" });
          const saved = await inspect();
          if (saved.turn.metadata.runtime.publishedReplyTurnId !== undefined) {
            throw failure("This completed response already published its plain reply.", "conversation_plain_reply_published", 409, { messageCode: "assistant.conversation.plainReplyPublished" });
          }
          const workerSignal = options.signal && options.signal !== signal ? AbortSignal.any([signal, options.signal]) : signal;
          workerSignal.throwIfAborted();
          const request = { turnId, input: { messageId } };
          async function persist(calls, retry = false) {
            await storage.write(entry.id, async transaction => {
              const current = await exact(transaction, { retry });
              const previous = current.calls[0];
              const next = calls[0];
              if (calls.length !== 1 || next?.id !== toolCallId || previous &&
                  (previous.name !== next.name || previous.arguments !== next.arguments ||
                    previous.status !== "running" && next.status === "running")) {
                throw failure("The saved response operation changed.", "conversation_saved_operation_changed", 409, { messageCode: "assistant.conversation.savedOperationChanged" });
              }
              await saveTools(entry, transaction, request, calls);
            });
          }
          const tools = createConversationTools({ catalog, toolSet, context, signal: workerSignal, previousCalls: saved.calls,
            maximumCalls: maximumToolCalls, discoveryOnly: false,
            authorize: () => events.access(context, entry.id, "tool", entry),
            prepareContext: async () => {
              await storage.read(entry.id, transaction => exact(transaction));
              return context;
            },
            async save(calls) {
              try { await persist(calls); }
              catch (error) {
                if (calls[0]?.status !== "running") {
                  const snapshot = structuredClone(calls);
                  entry.error = "The application operation result could not be saved. Restore storage access and retry saving.";
                  entry.storageFailure = failure(entry.error, "conversation_storage_unavailable", 503);
                  entry.storageFailure.cause = error;
                  entry.saveProgress = async () => {
                    await persist(snapshot, true);
                    entry.storageFailure = null;
                    entry.saveProgress = null;
                    entry.error = "";
                    return { type: "tool", turnId, call: snapshot[0] };
                  };
                }
                throw error;
              }
            },
            emit: event => events.emit(entry, { ...event, turnId }) });
          return tools.execute(input, { signal: workerSignal });
        });
      } } };
  }

  return Object.freeze({
    prepareCompletedResponse
  });
}

/** @typedef {ReturnType<typeof createCompletedResponses>} CompletedResponses */

export { createCompletedResponses };
