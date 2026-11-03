import { isDeepStrictEqual } from "node:util";
import { normalizeConversationConfiguration } from "./configuration.js";
import { failure } from "./conversationRefusals.js";
import { serial } from "./conversationEvents.js";

/**
 * Opening a conversation handle: the host's conversation is checked, its entry is created or
 * reused, and the handle's operations are bound to that entry and caller context.
 * @param {object} dependencies
 * @param {Map<string, any>} dependencies.entries The open conversations, by namespace or id.
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationHost | undefined} dependencies.defaultHost
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationOpening.js").ConversationOpening} dependencies.opening
 * @param {import("./conversationSending.js").ConversationSending} dependencies.sending
 * @param {import("./conversationGoals.js").ConversationGoals} dependencies.goals
 * @param {import("./conversationDelivery.js").ConversationDelivery} dependencies.delivery
 * @param {import("./conversationStopping.js").ConversationStopping} dependencies.stopping
 * @param {import("./conversationReplacement.js").ConversationReplacement} dependencies.replacement
 * @param {import("./completedResponses.js").CompletedResponses} dependencies.completedResponses
 * @param {boolean} dependencies.completedEnvelope
 * @param {boolean} dependencies.persistCommentary
 * @param {string | undefined} dependencies.defaultIntegrationId
 */
function createConversationHandles({ entries, storage, defaultHost, events, reads, opening, sending, goals, delivery, stopping, replacement,
  completedResponses, completedEnvelope, persistCommentary, defaultIntegrationId }) {
  async function open({ id, context, configuration, engine, host, representation = "canonical" } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A conversation id is required.");
    await events.access(context, id, "open");
    const selectedHost = host || defaultHost;
    const conversation = selectedHost?.conversation ? await selectedHost.conversation({ id, context }) : null;
    if (completedEnvelope && (conversation || representation !== "canonical")) {
      throw failure("Completed envelopes require runtime-owned canonical storage.", "conversation_completed_envelopes_need_storage", 400, { messageCode: "assistant.conversation.completedEnvelopesNeedStorage" });
    }
    if (conversation && !persistCommentary) {
      throw new TypeError("Transient commentary requires a runtime-owned transcript; supplied conversations retain their host's policy.");
    }
    const scoped = conversation?.native?.scoped;
    const commands = conversation?.commands;
    const invalidClaudeOwner = conversation?.engine === "claude" && (!conversation.native?.owner ||
      // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
      typeof conversation.native.owner !== "object" || typeof conversation.native.owner.acquire !== "function" ||
      // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
      typeof conversation.native.preparation?.cleanup !== "function");
    const invalidOpenCodeOwner = conversation?.engine === "opencode" && (!conversation.native?.owner ||
      // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
      typeof conversation.native.owner !== "object" || typeof conversation.native.preparation?.cleanup !== "function" ||
      (scoped ? ["turn", "existing"] : ["message", "inspection", "interruption"])
        // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
        .some(name => typeof conversation.native.preparation?.[name] !== "function") ||
      // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
      !scoped && typeof conversation.native.acquire !== "function");
    if (commands && (representation !== "canonical" || configuration !== undefined ||
        // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
        ["send", "cancel", "select", "inspectDelivery"].some(name => typeof commands[name] !== "function") ||
        // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
        typeof conversation.read !== "function" || typeof conversation.readStream !== "function")) {
      throw new TypeError("A logical conversation requires its complete original command, read and stream owners.");
    }
    if (scoped && (representation !== "native" || configuration !== undefined || !["codex", "claude", "opencode"].includes(conversation.engine) ||
        typeof scoped.conversationId !== "string" || !scoped.conversationId ||
        (conversation.engine === "claude" ? invalidClaudeOwner : conversation.engine === "opencode" ? invalidOpenCodeOwner
          // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
          : typeof conversation.native.preparation?.cleanup !== "function" ||
            ["startConversationTurn", "readConversation", "waitForConversationTurn", "stopConversation", "deleteConversation"]
              // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
              .some(name => typeof conversation.native.runOwner?.[name] !== "function")))) {
      throw new TypeError("An original scoped conversation requires its native representation, identity and existing operations.");
    }
    if (conversation && (conversation.sessionId !== id || typeof conversation.namespace !== "string" || !conversation.namespace ||
        !["codex", "claude", "opencode"].includes(conversation.engine) || !scoped && !commands && (
        (conversation.engine === "codex" ? !conversation.native?.runOwner || !conversation.native?.providerOwner
          : conversation.engine === "claude" ? invalidClaudeOwner
            : invalidOpenCodeOwner) ||
        // readable-check: allow method-probe - input validation: the conversation a host supplies is checked before the runtime binds it
        typeof conversation.prepareInput !== "function" || typeof conversation.read !== "function"))) {
      throw new TypeError("A bound native conversation requires its original identity, store, preparation and native owners.");
    }
    // readable-check: allow method-probe - input validation: a host's optional history budget must be a resolver
    if (conversation?.maximumHistoryBytes !== undefined && typeof conversation.maximumHistoryBytes !== "function") {
      throw new TypeError("A bound native history budget requires a server-owned resolver.");
    }
    if (!["canonical", "native"].includes(representation) || representation === "native" && !conversation) {
      throw new TypeError("Native result representation requires an original bound conversation.");
    }
    const key = conversation?.namespace || id;
    let entry = entries.get(key);
    if (!entry) {
      entry = { id, key, conversation, host: selectedHost, pending: Promise.resolve(), active: null, listeners: new Set(), error: "",
        cancelledMessages: new Set() };
      entries.set(key, entry);
      entry.initializing = opening.initialize(entry, configuration, engine).catch(error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
    }
    await entry.initializing;
    if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_handle_disposed", 409, { messageCode: "assistant.conversation.handleDisposed" });
    if (host && !isDeepStrictEqual(host, entry.host)) throw failure("This open conversation already belongs to another host scope. Dispose its handle before reopening it on the original host.", "conversation_host_scope_mismatch", 409, { messageCode: "assistant.conversation.hostScopeMismatch" });
    if (engine && engine !== entry.engine) throw failure("Use replace() to change this conversation's engine.", "conversation_use_replace_for_engine", 409, { messageCode: "assistant.conversation.useReplaceForEngine" });
    if (configuration) {
      const metadata = { runtime: await reads.readState(entry) };
      const supplied = entry.conversation ? configuration
        : normalizeConversationConfiguration(configuration, { engine: entry.engine, defaultIntegrationId });
      if (!isDeepStrictEqual(supplied, metadata.runtime.configuration)) {
        throw failure("Use configure() to change a saved conversation's settings.", "conversation_configuration_mismatch");
      }
    }
    return Object.freeze({
      id,
      get capabilities() { return reads.capabilities(entry); },
      replace: input => serial(entry, () => replacement.replace(entry, context, input, false, representation)),
      select: input => serial(entry, () => replacement.replace(entry, context, input, true, representation)),
      async read(query) {
        await events.access(context, id, "read", entry);
        const result = await reads.read(entry, representation, context, query);
        if (entry.conversation?.commands) await events.access(context, id, "read", entry);
        return result;
      },
      send: input => sending.send(entry, context, input, "user", undefined, representation),
      wake: (input, options) => sending.send(entry, context, input, "application", undefined, representation, options),
      ...(completedEnvelope ? { prepareCompletedResponse: (input, options) =>
        serial(entry, () => completedResponses.prepareCompletedResponse(entry, context, input, options)) } : {}),
      readGoal: () => serial(entry, () => goals.readGoal(entry, context, representation)),
      updateGoal: input => goals.updateGoal(entry, context, input, representation),
      inspectDelivery({ messageId, threadId } = {}) {
        if (typeof messageId !== "string" || !messageId) throw new TypeError("A message id is required.");
        return serial(entry, async () => {
          if (representation !== "native") return delivery.inspectDelivery(entry, context, messageId);
          await events.access(context, id, "inspectDelivery", entry);
          return entry.provider.inspectAdmission({ messageId, threadId, context, representation });
        });
      },
      async wait(input) {
        await events.access(context, id, "read", entry);
        if (entry.conversation?.commands) throw failure("This conversation uses its original read and subscription operations.", "conversation_original_read_only", 400, { messageCode: "assistant.conversation.originalReadOnly" });
        if (entry.conversation?.native?.scoped) return entry.provider.waitNative({ input, context });
        await entry.pending;
        await entry.active?.done;
        await events.access(context, id, "read", entry);
        return reads.read(entry);
      },
      // Cancel of one unsent or unconfirmed message always records it; an
      // application conversation supplies its own operation for that.
      async cancelDelivery({ messageId } = {}) {
        if (typeof messageId !== "string" || !messageId) throw new TypeError("A message id is required.");
        await events.access(context, id, "cancel", entry);
        if (entry.conversation?.commands) {
          // readable-check: allow method-probe - optional operation: cancelling one message is optional in a logical conversation's commands
          if (typeof entry.conversation.commands.cancelDelivery !== "function") {
            throw failure("This conversation cannot cancel one message.", "conversation_message_cancel_unsupported", 400,
              { messageCode: "assistant.conversation.messageCancelUnsupported" });
          }
          return entry.conversation.commands.cancelDelivery({ messageId }, context);
        }
        return stopping.cancelDelivery(entry, context, messageId, representation);
      },
      async cancel(input) {
        await events.access(context, id, "cancel", entry);
        if (entry.conversation?.commands) return entry.conversation.commands.cancel(input, context);
        await entry.pending;
        await events.access(context, id, "cancel", entry);
        return stopping.stop(entry, context, input, representation);
      },
      async retrySave() {
        await events.access(context, id, "retrySave", entry);
        return serial(entry, async () => {
          await events.access(context, id, "retrySave", entry);
          return stopping.retrySave(entry);
        });
      },
      async configure(patch) {
        await events.access(context, id, "configure", entry);
        if (entry.conversation?.commands) throw failure("Use the conversation's authorized selection operation.", "conversation_authorized_selection_required", 400, { messageCode: "assistant.conversation.authorizedSelectionRequired" });
        return serial(entry, async () => {
          await events.access(context, id, "configure", entry);
          if (entry.active) throw failure("Stop the current turn before changing its settings.", "conversation_busy", 409, { messageCode: "assistant.conversation.stopBeforeSettings" });
          if (entry.storageFailure) throw entry.storageFailure;
          if (entry.executionFailure) throw entry.executionFailure;
          if (entry.conversation) {
            if (!entry.conversation.selection?.write) throw failure("This host requires its authorized assistant selection operation.", "conversation_host_selection_required", 409, { messageCode: "assistant.conversation.hostSelectionRequired" });
            return entry.conversation.selection.write({ configuration: patch }, context);
          }
          return storage.write(id, async transaction => {
            const metadata = await transaction.readMetadata();
            if (metadata.runtime.replacement) throw failure("Finish the pending native replacement before changing settings.", "conversation_replacement_pending_before_settings", 409, { messageCode: "assistant.conversation.replacementPendingBeforeSettings" });
            if (metadata.runtime.request && (entry.engine === "api" || metadata.runtime.request.attempted || metadata.runtime.request.inspectionOnly)) {
              throw failure("Resolve uncertain delivery before changing settings.", "conversation_delivery_uncertain", 409, { messageCode: "assistant.conversation.deliveryUncertainBeforeSettings" });
            }
            const next = normalizeConversationConfiguration({ ...metadata.runtime.configuration, ...patch }, {
              engine: metadata.runtime.engine, defaultIntegrationId
            });
            entry.driver.validateConfiguration(next);
            metadata.runtime.configuration = next;
            await transaction.writeMetadata(metadata);
            return structuredClone(next);
          });
        });
      },
      async subscribe(listener) {
        await events.access(context, id, "subscribe", entry);
        if (entry.conversation?.native?.scoped) throw failure("This scoped conversation retains its original event delivery.", "conversation_event_delivery_retained", 409, { messageCode: "assistant.conversation.eventDeliveryRetained" });
        if (typeof listener !== "function") throw new TypeError("A conversation listener is required.");
        const subscription = { context, listener };
        entry.listeners.add(subscription);
        return () => entry.listeners.delete(subscription);
      },
      async dispose(options) {
        await events.access(context, id, "dispose", entry);
        return serial(entry, async () => {
          await events.access(context, id, "dispose", entry);
          const result = await stopping.disposeEntry(entry, context, options, representation);
          if (result?.ok === false || representation === "native") return result;
        });
      }
    });
  }

  return Object.freeze({
    open
  });
}

/** @typedef {ReturnType<typeof createConversationHandles>} ConversationHandles */

export { createConversationHandles };
