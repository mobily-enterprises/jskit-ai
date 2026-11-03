import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { normalizeConversationConfiguration } from "./configuration.js";
import { createReentrantConversationStorage } from "./storage.js";
import { createCodexConversationStore } from "./codexConversationStore.js";
import { hasUnfinishedConversationRewind } from "./runtimeStateUpgrade.js";
import { failure, stateErrorFields } from "./conversationRefusals.js";

/**
 * How an entry becomes usable: its saved runtime state is checked or created, and its
 * engine's provider is opened over the current native binding.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationTranscript | null} dependencies.transcript
 * @param {import("../types.js").ConversationStreams} dependencies.streams
 * @param {import("./provider.js").ConversationProviderFactory} dependencies.providers
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("../types.js").ServiceToolCatalog | null} dependencies.catalog
 * @param {string} dependencies.defaultEngine
 * @param {string | undefined} dependencies.defaultIntegrationId
 * @param {boolean} dependencies.persistCommentary
 * @param {boolean} dependencies.completedEnvelope
 */
function createConversationOpening({ storage, transcript, streams, providers, events, reads, catalog, defaultEngine, defaultIntegrationId,
  persistCommentary, completedEnvelope }) {
  async function openProvider(entry, driver, binding, segmentId, owner = (entry.bindingOwner = {})) {
    const isCurrent = () => entry.bindingOwner === owner && (entry.conversation || entry.segmentId === segmentId);
    let conversation;
    if (entry.conversation || driver.canonicalTranscript) {
      const store = entry.conversation ? null : createCodexConversationStore({ storage, scope: entry.id, segmentId, isCurrent, transcript, streams });
      conversation = {
        ...entry.conversation,
        sessionId: entry.id,
        persistCommentary,
        runtime: entry.conversation?.runtime || { store, getSession: store.getSession },
        publish: event => isCurrent() ? events.publish(entry, event) : undefined,
        // readable-check: allow optional-call - optional operation: only a native turn in progress keeps a checkpoint
        checkpoint: entry.conversation?.checkpoint || (input => isCurrent() ? entry.active?.nativeCheckpoint?.(input) : null)
      };
    }
    return providers.open(driver, {
      binding,
      conversation,
      async onFailure(error, { recovered = false } = {}) {
        if (!isCurrent()) return;
        if (recovered && entry.executionFailure !== error) return;
        entry.executionFailure = recovered ? null : error;
        entry.error = error.message;
        await events.emit(entry, { type: "error", error: error.message, ...stateErrorFields(error.message) });
      },
      async writeBinding(value) {
        if (entry.conversation) throw new Error("A bound native conversation writes identity through its original preparation owner.");
        if (entry.bindingOwner !== owner) throw new Error("A retired provider cannot change a native binding.");
        await storage.write(entry.id, async transaction => {
          const metadata = await transaction.readMetadata();
          if (entry.bindingOwner !== owner || metadata.runtime.segmentId !== segmentId) throw new Error("A retired native conversation cannot change the current binding.");
          if (metadata.runtime.engine === "codex") {
            const { codexAppServerRun: _staleRun, ...next } = value;
            if (Object.hasOwn(metadata.runtime.binding, "codexAppServerRun")) {
              next.codexAppServerRun = metadata.runtime.binding.codexAppServerRun;
            }
            metadata.runtime.binding = next;
          } else metadata.runtime.binding = value;
          await transaction.writeMetadata(metadata);
        });
      }
    });
  }

  async function initialize(entry, configuration, requestedEngine) {
    if (entry.conversation) {
      entry.applicationTools = boundApplicationTools(entry.conversation);
      entry.engine = entry.conversation.engine;
      if (requestedEngine && requestedEngine !== entry.engine) throw failure("The selected native engine changed.", "conversation_engine_changed", 409, { messageCode: "assistant.conversation.engineChanged" });
      entry.driver = providers.createDriver(entry.engine, entry.host);
      if (entry.conversation.commands) return;
      if (entry.conversation.native?.scoped) {
        entry.provider = await providers.open(entry.driver, { conversation: entry.conversation });
        if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_handle_disposed", 409, { messageCode: "assistant.conversation.handleDisposed" });
        return;
      }
      const state = await reads.readState(entry);
      if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_handle_disposed", 409, { messageCode: "assistant.conversation.handleDisposed" });
      entry.provider = await openProvider(entry, entry.driver, state.binding, state.segmentId);
      if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_handle_disposed", 409, { messageCode: "assistant.conversation.handleDisposed" });
      return;
    }
    const binding = await storage.write(entry.id, async transaction => {
      for (const method of ["readMetadata", "writeMetadata", "updateTurnMetadata", "listTurnIds", "readTurn", "nextTurnId", "hasMessage", "appendMessage", "replaceAssistant"]) {
        // readable-check: allow method-probe - input validation: an application's storage adapter is checked against the runtime storage contract
        if (typeof transaction[method] !== "function") throw new TypeError(`Conversation runtime storage requires transaction.${method}(). Run the runtime storage contract checks before using this adapter.`);
      }
      const metadata = await transaction.readMetadata();
      entry.engine = metadata.runtime?.engine || requestedEngine || defaultEngine;
      if (completedEnvelope && !["codex", "claude", "opencode"].includes(entry.engine)) {
        throw failure("Completed envelopes require a runtime-owned native conversation.", "conversation_completed_envelopes_need_native_owner", 400, { messageCode: "assistant.conversation.completedEnvelopesNeedNativeOwner" });
      }
      if (configuration) configuration = normalizeConversationConfiguration(configuration, { engine: entry.engine, defaultIntegrationId });
      const driver = entry.driver = providers.createDriver(entry.engine, entry.host);
      if (metadata.runtime) {
        if (metadata.runtime.version !== 3 || typeof metadata.runtime.lastEngine !== "string" || typeof metadata.runtime.segmentId !== "string" || !metadata.runtime.segmentId || !Array.isArray(metadata.runtime.predecessors)) {
          throw failure("This conversation needs its offline runtime-state upgrade before it can be opened. Its saved requests were not replayed or changed.", "conversation_storage_version");
        }
        if (hasUnfinishedConversationRewind(metadata.runtime)) {
          throw failure("This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before opening it; no history was changed.", "conversation_rewind_inspection_before_open", 409, { messageCode: "assistant.conversation.rewindInspectionBeforeOpen" });
        }
        if (requestedEngine && requestedEngine !== entry.engine) throw failure("Use replace() to change this conversation's engine.", "conversation_use_replace_for_engine", 409, { messageCode: "assistant.conversation.useReplaceForEngine" });
        driver.validateConfiguration(metadata.runtime.configuration);
        if (configuration && !isDeepStrictEqual(configuration, metadata.runtime.configuration)) {
          throw failure("Use configure() to change a saved conversation's settings.", "conversation_configuration_mismatch");
        }
        // Stored work is never permission to replay it after application restart.
        if (metadata.runtime.request && driver.admissionBeforeDispatch) {
          // API requests are dispatched only after the accepted user message and
          // receipt are committed together. A remaining reservation was not sent.
          delete metadata.runtime.request;
        } else if (metadata.runtime.request) {
          metadata.runtime.request.error = "The previous submission was interrupted. Check delivery before submitting it again.";
        }
        for (const id of await transaction.listTurnIds()) {
          const turn = await transaction.readTurn(id);
          if (turn.metadata?.runtime?.status === "running") {
            await transaction.updateTurnMetadata(id, { runtime: { ...turn.metadata.runtime,
              status: "interrupted", error: "The application restarted before this answer completed. The request was not replayed." } });
          }
        }
      } else {
        driver.validateConfiguration(configuration);
        metadata.runtime = { version: 3, segmentId: randomUUID(), engine: entry.engine, configuration: structuredClone(configuration), predecessors: [], seen: {},
          lastEngine: (await transaction.listTurnIds()).length ? "" : entry.engine };
        if (driver.createBinding) metadata.runtime.binding = await driver.createBinding();
      }
      await transaction.writeMetadata(metadata);
      entry.segmentId = metadata.runtime.segmentId;
      return metadata.runtime.binding;
    });
    entry.provider = await openProvider(entry, entry.driver, binding, entry.segmentId);
  }

  function boundApplicationTools(conversation) {
    const facilities = conversation.applicationTools;
    if (facilities === undefined) return null;
    // readable-check: allow method-probe - input validation: a host's bound application tools must bring their context mapper
    if (!catalog || conversation.commands || conversation.native?.scoped || typeof facilities?.prepareContext !== "function") {
      throw new TypeError("Bound application tools require a catalogue, an admitted conversation and a server-owned context mapper.");
    }
    return { storage: createReentrantConversationStorage(facilities.storage), prepareContext: facilities.prepareContext };
  }

  return Object.freeze({
    openProvider,
    initialize,
    boundApplicationTools
  });
}

/** @typedef {ReturnType<typeof createConversationOpening>} ConversationOpening */

export { createConversationOpening };
