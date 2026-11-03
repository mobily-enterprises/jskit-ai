import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { normalizeConversationConfiguration } from "./configuration.js";
import { createReentrantConversationStorage } from "./storage.js";
import { createCodexConversationStore } from "./codexConversationStore.js";
import { conversationNativeBinding, hasUnfinishedConversationRewind } from "./runtimeStateUpgrade.js";
import { failure, stateErrorFields } from "./conversationRefusals.js";

/** @typedef {import("./provider.js").ConversationDriver} ConversationDriver */
/** @typedef {import("./conversationTurns.js").ActiveTurn} ActiveTurn */
/** @typedef {import("./conversationSending.js").ConversationRequest} ConversationRequest */

/**
 * The conversation a host supplies for one id, instead of runtime-owned storage: a logical
 * conversation with its own commands, a scoped native one, or a bound native one whose transcript,
 * state and native owners stay the host's. conversationHandles' assertHostConversation checks it.
 * @typedef {object} HostConversation
 * @property {string} sessionId
 * @property {string} namespace
 * @property {string} engine
 * @property {object} [commands] A logical conversation's own send, cancel, select and inspectDelivery.
 * @property {object} [native] Its native facilities: owners, preparation, and `scoped` for a scoped one.
 * @property {object} [transcript]
 * @property {object} [state] Its native delivery and replacement state.
 * @property {object} [selection] Writes its authorized assistant selection.
 * @property {object} [applicationTools] Its opted-in application tools: their storage and context mapper.
 */

/**
 * The application tools a bound conversation opted into: where their receipts are saved, and how
 * a call's context is mapped.
 * @typedef {object} BoundApplicationTools
 * @property {import("../types.js").ReentrantConversationStorage} storage
 * @property {(context: object, call: object) => object | Promise<object>} prepareContext
 */

/**
 * One open conversation, shared by every handle opened on it. Only this module creates, binds and
 * retires it; the modules that run its turns record their state on it.
 * @typedef {object} ConversationEntry
 * @property {string} id
 * @property {string} key Its key among the open conversations: the host's namespace, or the id.
 * @property {HostConversation | null} conversation The host's conversation, or null for one the runtime stores.
 * @property {import("../types.js").ConversationHost | undefined} host The host scope it was opened on.
 * @property {Promise<void>} initializing Settles once its state is checked and its provider is open.
 * @property {Promise<unknown>} pending The end of its operation queue (see conversationEvents' serial).
 * @property {Set<{ context: object, listener: (event: object) => unknown }>} listeners
 * @property {Set<string>} cancelledMessages The newest messages cancelled here, refused if sent again.
 * @property {string} engine
 * @property {ConversationDriver} driver
 * @property {any} provider The engine's provider, opened over the current binding.
 * @property {object} bindingOwner Identifies the binding that current provider publications belong to.
 * @property {string | null} segmentId The current runtime segment: a bound conversation's is its native thread.
 * @property {BoundApplicationTools | null} applicationTools
 * @property {ActiveTurn | null} active The turn it is running, if any.
 * @property {ConversationRequest} [lastAcceptedRequest] A bound conversation's latest admitted request.
 * @property {string} error The error a reader sees.
 * @property {string} [phase] The phase subscribers were last told.
 * @property {string} [nativePhase] The phase the native engine last reported.
 * @property {object | null} [goal] The native goal, as last read or reported.
 * @property {Error | null} [storageFailure] Progress that could not be saved; retrySave clears it.
 * @property {Error | null} [executionFailure] Native cleanup that could not be confirmed; stop clears it.
 * @property {string | null} [cleanupTurnId] The turn whose cleanup failed.
 * @property {(() => Promise<object>) | null} [saveProgress] Saves the progress a storage failure kept.
 * @property {boolean} [disposed]
 */

/**
 * A conversation's saved runtime state: the runtime's own record, or a bound conversation's
 * projection of its host's state.
 * @typedef {object} ConversationState
 * @property {string} engine
 * @property {object} configuration
 * @property {string | null} segmentId
 * @property {any} [binding]
 * @property {any} [request] The request whose delivery is unconfirmed.
 * @property {any} [replacement]
 * @property {any} [nativeTurn]
 * @property {unknown} [nativeResult]
 * @property {string} [lastEngine]
 * @property {any[]} [predecessors]
 * @property {any} [continuity]
 * @property {any[]} [continuityAttachments]
 * @property {Record<string, string>} [seen]
 */

/**
 * The open conversations: an entry's creation, its saved state and engine provider, the bindings it
 * changes to, and its retirement.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationTranscript | null} dependencies.transcript
 * @param {import("../types.js").ConversationStreams} dependencies.streams
 * @param {import("./provider.js").ConversationProviderFactory} dependencies.providers
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("../types.js").ServiceToolCatalog | null} dependencies.catalog
 * @param {string} dependencies.defaultEngine
 * @param {string | undefined} dependencies.defaultIntegrationId
 * @param {boolean} dependencies.persistCommentary
 * @param {boolean} dependencies.completedEnvelope
 */
function createConversationEntries({ storage, transcript, streams, providers, events, catalog, defaultEngine, defaultIntegrationId,
  persistCommentary, completedEnvelope }) {
  /** @type {Map<string, ConversationEntry>} */
  const entries = new Map();

  /** @param {string} key */
  const find = key => entries.get(key);

  const list = () => [...entries.values()];

  /**
   * The open entry of a conversation, created and initialized on its first open.
   * @param {{ id: string, conversation: HostConversation | null, host: import("../types.js").ConversationHost | undefined,
   *   configuration: object | undefined, engine: string | undefined }} request
   */
  function acquire({ id, conversation, host, configuration, engine }) {
    const key = conversation?.namespace || id;
    let entry = entries.get(key);
    if (!entry) {
      entry = { id, key, conversation, host, pending: Promise.resolve(), active: null, listeners: new Set(), error: "",
        cancelledMessages: new Set() };
      entries.set(key, entry);
      entry.initializing = initialize(entry, configuration, engine).catch(error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
    }
    return entry;
  }

  /**
   * Opens the engine's provider over one binding. Its publications count only while `owner` is the
   * entry's binding owner and, for a stored conversation, the segment is still current.
   * @param {ConversationEntry} entry
   * @param {ConversationDriver} driver
   * @param {object} binding
   * @param {string | null} segmentId
   * @param {object} [owner]
   */
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
        checkpoint: entry.conversation?.checkpoint || (input => isCurrent() ? entry.active?.nativeCheckpoint(input) : null)
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

  /**
   * Makes a new entry usable: its saved runtime state is checked or created, and its engine's
   * provider is opened over the current native binding.
   * @param {ConversationEntry} entry
   * @param {object | undefined} configuration
   * @param {string | undefined} requestedEngine
   */
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
      const state = await readState(entry);
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

  /** @param {HostConversation} conversation */
  function boundApplicationTools(conversation) {
    const facilities = conversation.applicationTools;
    if (facilities === undefined) return null;
    // readable-check: allow method-probe - input validation: a host's bound application tools must bring their context mapper
    if (!catalog || conversation.commands || conversation.native?.scoped || typeof facilities?.prepareContext !== "function") {
      throw new TypeError("Bound application tools require a catalogue, an admitted conversation and a server-owned context mapper.");
    }
    return { storage: createReentrantConversationStorage(facilities.storage), prepareContext: facilities.prepareContext };
  }

  /**
   * The saved state of a conversation. A bound native conversation keeps its original run,
   * identity and delivery files, so its state is a read projection, never a runtime-v3 record or a
   * backfill; reading it brings the entry's segment up to date with the host's native thread.
   * @param {ConversationEntry} entry
   * @param {object} [context]
   * @returns {Promise<ConversationState>}
   */
  async function readState(entry, context) {
    if (!entry.conversation) return (await storage.read(entry.id, transaction => transaction.readMetadata())).runtime;
    const value = entry.conversation.native && entry.driver.readState
      ? await entry.driver.readState({ conversation: entry.conversation, context })
      : await entry.conversation.read(context);
    entry.segmentId = value.threadId ? `${entry.engine}:${value.threadId}` : null;
    const saved = value.delivery?.engines[entry.engine]?.pending;
    // The saved receipt is the delivery proof, as in changeover recovery. A
    // restart after native admission leaves only a stale attempt marker, which
    // must not leave the conversation unconfirmed until another message is sent.
    const pending = (saved?.attempted && !saved.inspectionOnly &&
      await entry.conversation.transcript.hasMessage(saved.messageId)) ? null : saved;
    return { engine: entry.engine, configuration: value.configuration, segmentId: entry.segmentId,
      binding: { ...conversationNativeBinding(entry.engine, value.threadId),
        ...(entry.engine === "codex" ? { codexAppServerRun: value.run } : {}) },
      nativeTurn: value.turn, nativeResult: value.nativeResult,
      lastEngine: value.delivery?.lastEngine ?? entry.engine,
      replacement: ["preparing", "ready"].includes(value.delivery?.replacement?.status) ? value.delivery.replacement : null,
      request: pending && { ...pending, text: pending.displayMessage, attachments: pending.displayAttachments || [] } };
  }

  /**
   * A logical conversation's own read may report another engine; the entry follows it.
   * @param {ConversationEntry} entry
   * @param {string} engine
   */
  function followEngine(entry, engine) {
    if (engine === entry.engine) return;
    entry.engine = engine;
    entry.driver = providers.createDriver(entry.engine, entry.host);
  }

  /**
   * After a bound conversation's host replaced its native conversation, the entry binds the host's
   * new conversation and opens its provider.
   * @param {ConversationEntry} entry
   * @param {object} context
   */
  async function rebindHostConversation(entry, context) {
    const next = await entry.host.conversation({ id: entry.id, context });
    entry.conversation = next;
    entry.applicationTools = boundApplicationTools(next);
    entry.engine = next.engine;
    entry.driver = providers.createDriver(entry.engine, entry.host);
    const current = await readState(entry);
    entry.provider = await openProvider(entry, entry.driver, current.binding, current.segmentId);
  }

  /**
   * After a stored conversation's replacement, the entry uses its successor's binding.
   * @param {ConversationEntry} entry
   * @param {{ engine: string, driver: ConversationDriver, provider: any, bindingOwner: object, segmentId: string }} binding
   */
  function adoptBinding(entry, { engine, driver, provider, bindingOwner, segmentId }) {
    Object.assign(entry, { engine, driver, provider, bindingOwner, segmentId });
  }

  /**
   * The entry leaves memory and its handles close. Live streams are kept per conversation id; a
   * logical conversation streams through its own owner, so the stream under its id belongs to
   * another entry with the same id, such as its session's Main conversation.
   * @param {ConversationEntry} entry
   */
  function retire(entry) {
    entry.disposed = true;
    entry.listeners.clear();
    if (!entry.conversation?.commands) streams.clear(entry.id);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  return Object.freeze({
    find,
    list,
    acquire,
    openProvider,
    readState,
    followEngine,
    rebindHostConversation,
    adoptBinding,
    retire
  });
}

/** @typedef {ReturnType<typeof createConversationEntries>} ConversationEntries */

export { createConversationEntries };
