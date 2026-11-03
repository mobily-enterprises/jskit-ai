import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { normalizeConversationConfiguration } from "./configuration.js";
import { hasUnfinishedConversationRewind, createConversationRuntimeReplacement,
  releaseConversationRuntimeBinding, finishConversationRuntimeReplacement,
  conversationNativeIdentity } from "./runtimeStateUpgrade.js";
import { createConversationChangeover, conversationContinuity, conversationHistoryVersions } from "./continuity.js";
import { failure } from "./conversationRefusals.js";
import { pendingSuccessor, retainedSegments } from "./conversationReads.js";

/** @typedef {import("./conversationEntries.js").ConversationEntry} ConversationEntry */

/**
 * Replacing an open conversation's native conversation: a renewal, an engine or model change,
 * or a selection, with its continuity briefing and the predecessor it retains.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("./provider.js").ConversationProviderFactory} dependencies.providers
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationEntries.js").ConversationEntries} dependencies.entries
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationDelivery.js").ConversationDelivery} dependencies.delivery
 * @param {boolean} dependencies.completedEnvelope
 * @param {string | undefined} dependencies.defaultIntegrationId
 * @param {number} dependencies.maximumContinuity
 */
function createConversationReplacement({ storage, providers, events, entries, reads, delivery, completedEnvelope, defaultIntegrationId,
  maximumContinuity }) {
  /**
   * @param {ConversationEntry} entry
   * @param {object} context
   * @param {object} input
   * @param {boolean} selection Whether this selects an engine or model instead of replacing the native conversation.
   * @param {string} representation
   */
  async function replace(entry, context, input, selection, representation) {
    const operation = selection ? "select" : "replace";
    if (completedEnvelope && input?.engine === "api") throw failure("Completed envelopes require a native engine.", "conversation_completed_envelopes_need_native_engine", 400, { messageCode: "assistant.conversation.completedEnvelopesNeedNativeEngine" });
    await events.access(context, entry.id, operation, entry);
    if (entry.conversation?.commands) {
      if (!selection) throw failure("This conversation retains its original replacement policy.", "conversation_replacement_policy_retained", 400, { messageCode: "assistant.conversation.replacementPolicyRetained" });
      return entry.conversation.commands.select(input, context);
    }
    if (entry.conversation?.native?.scoped) throw failure("This scoped conversation retains its original selected profile.", "conversation_selected_profile_retained", 409, { messageCode: "assistant.conversation.selectedProfileRetained" });
    const keys = selection ? ["operationId", "expectedSegmentId", "engine", "configuration", "retireNative"]
      : ["operationId", "expectedSegmentId", "reason", "engine", "configuration", "briefing"];
    if (!input || !/^[\w-]{1,128}$/u.test(input.operationId || "") || typeof input.expectedSegmentId !== "string" ||
        !input.expectedSegmentId || (selection ? typeof input.engine !== "string" : !["engine-change", "model-change", "renewal"].includes(input.reason)) ||
        input.briefing !== undefined && typeof input.briefing !== "string" ||
        input.retireNative !== undefined && typeof input.retireNative !== "boolean" ||
        Object.keys(input).some(key => !keys.includes(key))) {
      throw failure("Replacement needs an operationId, exact predecessor segment, and an engine-change, model-change or renewal reason.", "conversation_replacement_request_invalid", 400, { messageCode: "assistant.conversation.replacementRequestInvalid" });
    }
    if (entry.active) throw failure("Stop the current turn before replacing its native conversation.", "conversation_busy", 409, { messageCode: "assistant.conversation.stopBeforeReplace" });
    if (entry.storageFailure) throw entry.storageFailure;
    if (entry.conversation) {
      const state = await entries.readState(entry);
      const saved = await entry.conversation.state.read();
      const retry = saved?.replacement?.operationId === input.operationId;
      let nativeResult;
      if (state.segmentId !== input.expectedSegmentId && !retry) throw failure("The native predecessor has changed. Read the conversation before replacing it.", "conversation_predecessor_changed", 409, { messageCode: "assistant.conversation.predecessorChanged" });
      if (selection) {
        if (!entry.conversation.selection?.write) throw failure("This host requires its authorized assistant selection operation.", "conversation_host_selection_required", 409, { messageCode: "assistant.conversation.hostSelectionRequired" });
        await entry.conversation.selection.write(input, context);
      } else {
        if (!input.briefing?.trim()) throw failure("Native replacement requires a continuity briefing.", "conversation_replacement_briefing_required", 400, { messageCode: "assistant.conversation.replacementBriefingRequired" });
        const replacement = createConversationChangeover({ state: entry.conversation.state,
          identity: entry.conversation.identity, presentation: entry.conversation.presentation,
          agent: { async closeSession() { await entry.provider.dispose({ changeover: true, forgetConversationBinding: true }); return { ok: true }; } } });
        nativeResult = await replacement.replace({ engineId: entry.engine, messages: await entry.conversation.transcript.history(),
          operationId: input.operationId, expectedId: input.expectedSegmentId.startsWith(`${entry.engine}:`)
            ? input.expectedSegmentId.slice(entry.engine.length + 1) : "", handover: input.briefing || "" });
        if (retry && saved.replacement.status === "accepted") {
          return representation === "native" ? nativeResult : { operationId: input.operationId, segmentId: entry.segmentId, duplicate: true };
        }
      }
      await entries.rebindHostConversation(entry, context);
      entry.goal = null;
      const receipt = { operationId: input.operationId, segmentId: entry.segmentId, ...(retry ? { duplicate: true } : {}) };
      await events.emit(entry, { type: "replaced", reason: input.reason || "model-change", engine: entry.engine, ...receipt });
      return representation === "native" ? nativeResult : receipt;
    }
    const request = { ...structuredClone(input), operation };
    // Receipt identity must survive JSON storage without picking up a later
    // runtime's connection default when the same operation is retried.
    if (request.engine === undefined) delete request.engine;
    if (request.briefing === undefined) delete request.briefing;
    if (request.configuration === undefined) delete request.configuration;
    else if (request.configuration) request.configuration = normalizeConversationConfiguration(request.configuration);
    let state = await entries.readState(entry);
    if (hasUnfinishedConversationRewind(state)) {
      throw failure("This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before replacing it; no history was changed.", "conversation_rewind_inspection_before_replace", 409, { messageCode: "assistant.conversation.rewindInspectionBeforeReplace" });
    }
    const completed = state.predecessors.find(item => item.replacement?.operationId === input.operationId);
    if (completed) {
      if (!isDeepStrictEqual(completed.replacement, request)) throw failure("This replacement operationId already belongs to another request.", "conversation_replacement_operation_conflict", 409, { messageCode: "assistant.conversation.replacementOperationConflict" });
      return { operationId: input.operationId, segmentId: completed.successorId, duplicate: true };
    }
    let pending = state.replacement;
    if (pending && !isDeepStrictEqual(pending.request, request)) throw failure("Retry the unfinished native replacement before starting another one.", "conversation_replacement_unfinished", 409, { messageCode: "assistant.conversation.replacementUnfinished" });
    if (state.segmentId !== input.expectedSegmentId) throw failure("The native predecessor has changed. Read the conversation before replacing it.", "conversation_predecessor_changed", 409, { messageCode: "assistant.conversation.predecessorChanged" });
    if (!selection && retainedSegments(state).some(segment => segment.request)) throw failure("Resolve pending delivery before replacing native history. Another engine may be selected while its receipt stays pending.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.pendingDeliveryBeforeReplace" });
    if (!selection && !pending && pendingSuccessor(state)) throw failure("Deliver the previous replacement's briefing before replacing native history again.", "conversation_briefing_before_replacement", 409, { messageCode: "assistant.conversation.briefingBeforeReplacement" });
    if (entry.executionFailure && !pending) throw entry.executionFailure;
    const engine = pending?.engine || input.engine || state.engine;
    const configuration = pending?.configuration || (input.configuration
      ? normalizeConversationConfiguration(input.configuration, { engine, defaultIntegrationId }) : state.configuration);
    const driver = providers.createDriver(engine, entry.host);
    driver.validateConfiguration(configuration);
    const predecessorId = conversationNativeIdentity(state);
    const nativeReplacement = !selection && state.engine !== "api" && predecessorId &&
      (state.engine !== "claude" || state.binding.sent);
    const retainNativeBinding = input.retireNative !== true && engine === state.engine &&
      (engine !== "opencode" || configuration.integrationId === state.configuration.integrationId);
    if (selection && engine !== "api" && retainNativeBinding && !pending) {
      // The production native owners apply compatible settings to the running
      // conversation themselves. Selecting a model is not process retirement.
      await storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        const current = metadata.runtime;
        current.predecessors.push({ segmentId: current.segmentId, engine: current.engine,
          configuration: current.configuration, binding: current.binding, seen: current.seen,
          request: current.request, successorId: current.segmentId, replacement: request });
        current.configuration = structuredClone(configuration);
        await transaction.writeMetadata(metadata);
      });
      const receipt = { operationId: input.operationId, segmentId: state.segmentId };
      await events.emit(entry, { type: "replaced", reason: "model-change", engine, ...receipt });
      return receipt;
    }
    if (!pending) {
      const history = (await reads.readTranscript(entry)).filter(turn => !turn.metadata?.runtime?.supersededBy);
      let destination = null;
      if (selection) {
        if (retainNativeBinding) destination = state;
        else if (input.retireNative !== true && engine !== state.engine && driver.createBinding) {
          destination = retainedSegments(state).findLast(segment => segment.engine === engine &&
            (engine !== "opencode" || segment.configuration.integrationId === configuration.integrationId));
        }
      }
      if (engine !== "api" && (input.briefing || "").length > maximumContinuity) throw new Error("The continuity briefing exceeds the configured history budget.");
      const continuity = destination ? { text: destination.continuity, attachments: destination.continuityAttachments || [] }
        : engine === "api" ? conversationContinuity({ history, briefing: input.briefing, maximumCharacters: maximumContinuity })
          : { text: undefined, attachments: [] };
      pending = createConversationRuntimeReplacement({ request, engine, configuration: structuredClone(configuration),
        reason: selection ? state.engine === engine ? "model-change" : "engine-change" : input.reason,
        segmentId: destination?.segmentId || randomUUID(), continuity,
        seen: destination ? destination.seen : engine === "api" ? conversationHistoryVersions(history) : {}, destination });
    }

    function saveReplacement() {
      return storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        if (metadata.runtime.segmentId !== input.expectedSegmentId || metadata.runtime.replacement &&
            !isDeepStrictEqual(metadata.runtime.replacement.request, request)) {
          throw failure("The saved replacement changed before it could be written.", "conversation_replacement_changed_before_write", 409, { messageCode: "assistant.conversation.replacementChangedBeforeWrite" });
        }
        metadata.runtime.replacement = pending;
        await transaction.writeMetadata(metadata);
      });
    }

    async function closeSession() {
      try { await entry.provider.dispose(); }
      catch (error) { entry.executionFailure = error; entry.error = error.message; throw error; }
      return { ok: true };
    }

    let provider;
    const bindingOwner = {};
    async function replacementTransaction(callback) {
      // These common storage/host facilities allocate an inert successor handle.
      // Native process/thread creation stays in ordinary Send, after this commit.
      await events.access(context, entry.id, operation, entry);
      if (pending.segmentId === state.segmentId) {
        pending.binding = (await entries.readState(entry)).binding || null;
      }
      if (!Object.hasOwn(pending, "binding")) {
        pending.binding = driver.createBinding ? await driver.createBinding() : null;
        await saveReplacement();
      }
      provider = await entries.openProvider(entry, driver, pending.binding, pending.segmentId, bindingOwner);
      try {
        await events.access(context, entry.id, operation, entry);
        await storage.write(entry.id, async transaction => {
          const metadata = await transaction.readMetadata();
          state = metadata.runtime;
          if (state.segmentId !== input.expectedSegmentId || !isDeepStrictEqual(state.replacement?.request, request)) {
            throw failure("The saved replacement changed before its binding was released.", "conversation_replacement_changed_before_release", 409, { messageCode: "assistant.conversation.replacementChangedBeforeRelease" });
          }
          await callback({
            async releaseBinding(replacement) {
              if (replacement && conversationNativeIdentity(state) !== replacement.previous.conversationId) {
                throw failure("The native predecessor identity changed before its binding was released.", "conversation_predecessor_changed_before_release", 409, { messageCode: "assistant.conversation.predecessorChangedBeforeRelease" });
              }
              releaseConversationRuntimeBinding(state, pending, request, engine);
            },
            async write(value) {
              finishConversationRuntimeReplacement(state, { engine, selection, retireNative: input.retireNative, pending, value });
              await transaction.writeMetadata(metadata);
            }
          });
        });
      } catch (error) { await provider.dispose(); throw error; }
    }

    if (nativeReplacement) {
      const replacement = createConversationChangeover({
        state: {
          read: delivery.changeoverState(entry).read,
          async write(value) {
            pending.preparedAt = value.replacement.preparedAt;
            await saveReplacement();
          },
          transaction: replacementTransaction
        },
        identity: {
          async inspect(expectedId) {
            const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
            if (runtime.segmentId !== input.expectedSegmentId || conversationNativeIdentity(runtime) !== expectedId) {
              throw failure("The native predecessor identity changed or is incomplete.", "conversation_predecessor_incomplete", 409, { messageCode: "assistant.conversation.predecessorIncomplete" });
            }
            return { bindingNames: ["binding"], previous: { engineId: runtime.engine, conversationId: expectedId } };
          }
        },
        agent: { closeSession }
      });
      await replacement.replace({ engineId: engine, messages: [], operationId: input.operationId,
        expectedId: predecessorId, handover: input.briefing || "" });
    } else {
      // API conversations, retained-engine selection and unstarted native handles
      // have no native predecessor replacement. Keep their common facilities.
      if (!state.replacement) await saveReplacement();
      await closeSession();
      await replacementTransaction(async transaction => {
        await transaction.releaseBinding();
        await transaction.write();
      });
    }
    entries.adoptBinding(entry, { engine, driver, provider, bindingOwner, segmentId: pending.segmentId });
    Object.assign(entry, { goal: null, executionFailure: null, error: pending.submission?.error || "" });
    const receipt = { operationId: input.operationId, segmentId: pending.segmentId };
    await events.emit(entry, { type: "replaced", reason: pending.reason, engine, ...receipt });
    return receipt;
  }

  return Object.freeze({
    replace
  });
}

/** @typedef {ReturnType<typeof createConversationReplacement>} ConversationReplacement */

export { createConversationReplacement };
