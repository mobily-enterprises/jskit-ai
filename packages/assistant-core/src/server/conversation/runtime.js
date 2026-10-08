import { createConversationProviderFactory } from "./provider.js";
import { normalizeConversationConfiguration } from "./configuration.js";
import { runScopedConversationTurn, readPersistentConversation, startPersistentConversationTurn,
  inspectPersistentConversationAdmission, preparePersistentConversationChangeover,
  inspectPersistentConversationDelivery, stopPersistentConversation, deletePersistentConversation } from "./providers/scoped.js";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { createConversationTranscript } from "./transcript.js";
import { createConversationStreams } from "./streams.js";
import { createReentrantConversationStorage } from "./storage.js";
import { createCodexConversationStore } from "./agentRun.js";
import { codexAppServerTurnStateFromAgentRun } from "./codexTurn.js";
import { hasUnfinishedConversationRewind } from "./runtimeStateUpgrade.js";
import { createServiceToolCatalog } from "../lib/serviceToolCatalog.js";
import { createConversationTools } from "./tools.js";
import { conversationAttachmentIds, createConversationAttachmentReader } from "./attachments.js";
import { conversationAttachmentManifest } from "../../shared/conversation/attachments.js";
import { createConversationChangeover, conversationContinuity, conversationHistoryVersions,
  conversationNativeMessages, conversationRequestText } from "./continuity.js";

function failure(message, code, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

const submittedMessage = turn => turn.user || turn.system;
const retainedSegments = state => [...new Map([...state.predecessors, state].map(segment => [segment.segmentId, segment])).values()];
const nativeIdentity = segment => segment.engine === "codex" ? segment.binding?.threadId
  : segment.engine === "claude" ? segment.binding?.conversationId : segment.binding?.sessionId;
const pendingSuccessor = state => state.engine !== "api" && state.predecessors.findLast(segment => segment.successorId === state.segmentId &&
  segment.segmentId !== state.segmentId && segment.replacement?.operation === "replace" && !segment.acceptedAt);
const sameRequest = (left, right) => left.text === right.text && (left.origin || "user") === right.origin &&
  isDeepStrictEqual(left.goal, right.goal) && isDeepStrictEqual(left.data, right.data) &&
  isDeepStrictEqual((left.attachments || []).map(file => file.attachmentId), right.attachments.map(file => file.attachmentId));

/** One application conversation API. Storage and authorization remain host facilities. */
export function createConversationRuntime({ engine: defaultEngine = "api", defaultIntegrationId, storage, authorize, connections, apiClientFactory, apiHistory,
  actions, toolPolicy, toolCatalog, attachments, fetch, host: defaultHost, limits = {} } = {}) {
  if (typeof authorize !== "function") throw new TypeError("Conversation access requires an authorize function.");
  if (apiHistory !== undefined && typeof apiHistory !== "function") throw new TypeError("API request history requires a server-owned selector.");
  if (toolCatalog && (actions || toolPolicy)) throw new TypeError("Supply the existing tool catalog or actions and toolPolicy, not both.");
  storage = (storage || !defaultHost?.conversation) ? createReentrantConversationStorage(storage) : null;
  const transcript = storage ? createConversationTranscript({ storage, applicationTurns: true }) : null;
  const streams = createConversationStreams();
  const entries = new Map();
  let closed = false;
  const providers = createConversationProviderFactory({ connections, apiClientFactory, fetch, limits, actions, toolCatalog });
  const { createDriver } = providers;
  const catalog = toolCatalog || (actions ? createServiceToolCatalog(actions, { ...limits, isActionAvailable: toolPolicy }) : null);
  const maximumToolCalls = limits.maxToolCalls ?? 32;
  if (!Number.isSafeInteger(maximumToolCalls) || maximumToolCalls < 1) throw new TypeError("Invalid application tool-call limit.");
  const maximumInput = limits.maxInputCharacters ?? 32_000;
  if (!Number.isSafeInteger(maximumInput) || maximumInput < 1) throw new TypeError("Invalid conversation input limit.");
  const maximumFinalReply = limits.maxFinalReplyCharacters ?? Infinity;
  if (limits.maxFinalReplyCharacters !== undefined && (!Number.isSafeInteger(maximumFinalReply) || maximumFinalReply < 1)) {
    throw new TypeError("Invalid conversation final reply limit.");
  }
  const maximumContinuity = limits.maxContinuityCharacters ?? 128_000;
  if (!Number.isSafeInteger(maximumContinuity) || maximumContinuity < 1) throw new TypeError("Invalid conversation continuity limit.");
  const maximumAttachmentBytes = limits.maxAttachmentBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumAttachmentBytes) || maximumAttachmentBytes < 1) throw new TypeError("Invalid conversation attachment byte limit.");
  if (attachments !== undefined && typeof attachments?.resolve !== "function") throw new TypeError("Conversation attachments require an authorized resolve function.");
  const capabilities = entry => {
    const value = { ...entry.driver.capabilities, ...entry.provider?.capabilities,
      attachments: Boolean((attachments || entry.conversation?.prepareInput || entry.conversation?.commands) && entry.driver.capabilities.attachments) };
    if (entry.conversation?.commands) {
      delete value.goalCommands;
      Object.assign(value, { goals: false, configuration: false, wake: false, replacement: false });
    }
    return value;
  };
  if (limits.timeoutMs !== undefined && (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1)) {
    throw new TypeError("Invalid conversation request time limit.");
  }

  async function access(context, id, operation, entry) {
    if (closed || entry?.disposed) throw failure("This conversation handle is closed.", "conversation_closed");
    if (!await authorize({ context, conversationId: id, operation })) {
      throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
    }
    if (closed || entry?.disposed) throw failure("This conversation handle is closed.", "conversation_closed");
  }

  function serial(entry, callback) {
    const operation = entry.pending.then(callback);
    entry.pending = operation.catch(() => {});
    return operation;
  }

  async function emit(entry, event) {
    await Promise.all([...entry.listeners].map(async subscription => {
      try { await access(subscription.context, entry.id, "subscribe", entry); }
      catch { entry.listeners.delete(subscription); return; }
      // Presentation failures cannot interrupt persistence or provider work.
      try { Promise.resolve(subscription.listener(structuredClone({ conversationId: entry.id, ...event }))).catch(() => {}); }
      catch { /* A failed observer does not own the conversation. */ }
    }));
  }

  async function setPhase(entry, phase, turnId) {
    if (!["", "preparing", "working", "compacting", "retrying"].includes(phase)) throw new Error("Invalid conversation phase from the engine adapter.");
    if ((entry.phase || "") === phase) return;
    entry.phase = phase;
    await emit(entry, { type: "phase", phase, turnId });
  }

  const readTranscript = entry => entry.conversation
    ? entry.conversation.transcript.readConversationLog() : transcript.readConversationLog(entry.id);

  function readTranscriptPage(entry, query) {
    if (!entry.conversation) return transcript.readConversationLogPage(entry.id, query);
    if (typeof entry.conversation.transcript.readConversationLogPage !== "function") {
      throw failure("This conversation does not supply paged history.", "conversation_unsupported", 400);
    }
    return entry.conversation.transcript.readConversationLogPage(query);
  }

  // A bound native conversation keeps its original run, identity and delivery
  // files. This is a read projection, never a runtime-v3 record or a backfill.
  async function readState(entry, context) {
    if (!entry.conversation) return (await storage.read(entry.id, transaction => transaction.readMetadata())).runtime;
    const value = entry.conversation.native && entry.driver.readState
      ? await entry.driver.readState({ conversation: entry.conversation, context })
      : await entry.conversation.read(context);
    entry.segmentId = value.threadId ? `${entry.engine}:${value.threadId}` : null;
    const pending = value.delivery?.engines[entry.engine]?.pending;
    return { engine: entry.engine, configuration: value.configuration, segmentId: entry.segmentId,
      binding: entry.engine === "codex" ? { threadId: value.threadId, codexAppServerRun: value.run }
        : entry.engine === "claude" ? { conversationId: value.threadId } : { sessionId: value.threadId },
      nativeTurn: value.turn, nativeResult: value.nativeResult,
      lastEngine: value.delivery?.lastEngine ?? entry.engine,
      replacement: ["preparing", "ready"].includes(value.delivery?.replacement?.status) ? value.delivery.replacement : null,
      request: pending && { ...pending, text: pending.displayMessage, attachments: pending.displayAttachments || [] } };
  }

  async function read(entry, representation, context, query) {
    if (entry.conversation?.native?.scoped) return entry.provider.readNative({ input: query, context });
    if (representation === "native" && entry.conversation) {
      const value = entry.driver.readState
        ? await entry.driver.readState({ conversation: entry.conversation, context, representation })
        : await entry.conversation.read(context, representation);
      return value.nativeResult;
    }
    const logical = entry.conversation?.commands ? await entry.conversation.read(context, query) : null;
    if (logical && logical.engine !== entry.engine) {
      entry.engine = logical.engine;
      entry.driver = createDriver(entry.engine, entry.host);
    }
    const metadata = { runtime: logical ? { configuration: logical.configuration,
      segmentId: logical.threadId ? `${logical.engine}:${logical.threadId}` : null } : await readState(entry, context) };
    if (representation === "native") return metadata.runtime.nativeResult;
    const page = logical ? logical.pagination ? { conversationLog: logical.conversationLog, pagination: logical.pagination } : null
      : query ? await readTranscriptPage(entry, query) : null;
    const conversationLog = logical ? logical.conversationLog : page ? page.conversationLog : await readTranscript(entry);
    // Browsing an older page does not change the current turn's control/error state.
    const latest = !logical && query?.beforeTurnId ? (await readTranscriptPage(entry, { limit: 1 })).conversationLog : conversationLog;
    const last = latest.at(-1)?.metadata?.runtime;
    const savedRequest = metadata.runtime.request;
    const nativeTurn = metadata.runtime.nativeTurn || (entry.driver.canonicalTranscript && metadata.runtime.binding?.codexAppServerRun
      ? codexAppServerTurnStateFromAgentRun(metadata.runtime.binding.codexAppServerRun) : null);
    const request = savedRequest && (entry.engine === "api" || savedRequest.attempted || savedRequest.inspectionOnly ||
      entry.active?.requests.has(savedRequest.messageId)) ? savedRequest : null;
    const pendingRequest = request ? Object.fromEntries([
      "messageId", "text", "origin", "data", "attachments", "at", "goal", "steering", "error"
    ].filter(name => Object.hasOwn(request, name)).map(name => [name, request[name]])) : null;
    return {
      id: entry.id, engine: entry.engine, capabilities: capabilities(entry), configuration: metadata.runtime.configuration,
      segmentId: metadata.runtime.segmentId,
      replacement: metadata.runtime.replacement ? { operationId: metadata.runtime.replacement.request?.operationId || metadata.runtime.replacement.operationId,
        reason: metadata.runtime.replacement.reason, segmentId: metadata.runtime.replacement.segmentId } : null,
      status: logical ? logical.status : entry.storageFailure || entry.executionFailure ? "unavailable" : entry.active || nativeTurn?.active ? "working" : metadata.runtime.replacement ? "replacement-pending"
        : metadata.runtime.request && (entry.engine === "api" || metadata.runtime.request.attempted || metadata.runtime.request.inspectionOnly) ? "unconfirmed" : "ready",
      phase: logical ? logical.phase || "" : entry.phase || (nativeTurn?.active && nativeTurn.status !== "observation_lost" ? nativeTurn.phase === "compacting" ? "compacting" : "working" : ""),
      error: logical ? logical.error || "" : entry.error || nativeTurn?.error || metadata.runtime.request?.error || last?.error || "",
      goal: entry.goal || null,
      pendingRequest: logical ? logical.pendingRequest || null : pendingRequest,
      ...(logical?.presentation ? { presentation: logical.presentation } : {}),
      conversationLog: conversationLog.filter(turn => !turn.metadata?.runtime?.supersededBy),
      ...(page ? { pagination: page.pagination } : {}),
      streaming: entry.conversation ? await entry.conversation.readStream() : streams.read(entry.id)
    };
  }

  async function publish(entry, event) {
    if (entry.disposed) return;
    if (entry.conversation?.commands && ["phase", "configuration"].includes(event.type)) {
      return emit(entry, event);
    }
    const payload = event.payload || {};
    if (Object.hasOwn(payload, "goal")) {
      entry.goal = payload.goal;
      await emit(entry, { type: "goal", goal: entry.goal });
    } else if (event.goalChanged) {
      await emit(entry, { type: "goal" });
    }
    const turn = payload.conversationLogPatch?.turn;
    if (turn) {
      await emit(entry, { type: "transcript", patch: payload.conversationLogPatch,
        ...(payload.conversationStream ? { streaming: payload.conversationStream } : {}) });
      const authored = submittedMessage(turn);
      const request = authored && entry.active?.requests.get(authored.messageId);
      // The original receipt already owns this row. Common admission is
      // still resolved by the dispatch continuation outside its queue.
      if (request) request.turnId = turn.turnId;
      for (const message of turn.messages || []) {
        if (!["assistant", "commentary", "thinking"].includes(message.role)) continue;
        await emit(entry, { type: "message", turnId: turn.turnId, messageId: message.messageId,
          ...(message.outputId ? { outputId: message.outputId } : {}),
          ...(["user", "application"].includes(turn.metadata?.runtime?.origin) ? { origin: turn.metadata.runtime.origin } : {}),
          role: message.role, text: message.text, status: "complete", streaming: payload.conversationStream || streams.read(entry.id) });
      }
    }
    if (payload.conversationStream) {
      const snapshot = payload.conversationStream;
      for (const message of snapshot.messages) {
        await emit(entry, { type: "message", ...message, streaming: snapshot });
      }
      if (!snapshot.messages.length) await emit(entry, { type: "message-complete", streaming: snapshot });
    }
    const nativeTurn = payload.agentSession?.turn;
    if (nativeTurn) {
      entry.nativePhase = nativeTurn.active
        ? ["preparing", "compacting", "retrying"].includes(nativeTurn.phase) ? nativeTurn.phase : "working"
        : "";
      const request = entry.active?.request;
      if (!entry.active || request.accepted) {
        if (request?.deliveryCommitted) {
          try { await request.deliveryCommitted; }
          catch { return; } // Admission owns this failure; native cleanup must still settle.
        }
        await setPhase(entry, entry.nativePhase, request?.turnId);
      }
    }
  }

  async function openProvider(entry, driver, binding, segmentId, owner = (entry.bindingOwner = {})) {
    const isCurrent = () => entry.bindingOwner === owner && (entry.conversation || entry.segmentId === segmentId);
    let conversation;
    if (entry.conversation || driver.canonicalTranscript) {
      const store = entry.conversation ? null : createCodexConversationStore({ storage, scope: entry.id, segmentId, isCurrent, transcript, streams });
      conversation = {
        ...entry.conversation,
        sessionId: entry.id,
        runtime: entry.conversation?.runtime || { store, getSession: store.getSession },
        publish: event => isCurrent() ? publish(entry, event) : undefined,
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
        await emit(entry, { type: "error", error: error.message });
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
            bindingNames: ["binding"], previous: { engineId: runtime.engine, conversationId: nativeIdentity(runtime) },
            ...(preparing.preparedAt ? { preparedAt: preparing.preparedAt } : {}) } }
            : predecessor ? { replacement: { engineId: runtime.engine, status: "ready",
            operationId: predecessor.replacement.operationId, handover: predecessor.replacement.briefing || "",
            previous: { engineId: predecessor.engine, conversationId: nativeIdentity(predecessor) },
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

  function nativeChangeover(entry, context, request, sendMessage) {
    let observation;
    return createConversationChangeover({
      state: entry.conversation?.state || changeoverState(entry, request),
      captureContext: !entry.conversation, applicationMessages: !entry.conversation,
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
            await access(context, entry.id, request?.operation || "inspectDelivery", entry);
            return { admission: observation.accepted ? "accepted" : "unknown" };
          }
          const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
          if (!threadId || threadId !== nativeIdentity(runtime) || runtime.request?.messageId !== messageId) return null;
          observation = await entry.provider.inspectAdmission({ ...runtime.request, context, configuration: runtime.configuration });
          await access(context, entry.id, request?.operation || "inspectDelivery", entry);
          return { admission: observation.accepted ? "accepted" : "unknown" };
        }
      }
    });
  }

  async function rememberNative(entry, transaction, turns) {
    const changeover = createConversationChangeover({ state: changeoverState(entry, null, transaction) });
    await changeover.remember({ engineId: entry.engine, messages: conversationNativeMessages(turns) });
  }

  async function initialize(entry, configuration, requestedEngine) {
    if (entry.conversation) {
      entry.applicationTools = boundApplicationTools(entry.conversation);
      entry.engine = entry.conversation.engine;
      if (requestedEngine && requestedEngine !== entry.engine) throw failure("The selected native engine changed.", "conversation_engine_mismatch");
      entry.driver = createDriver(entry.engine, entry.host);
      if (entry.conversation.commands) return;
      if (entry.conversation.native?.scoped) {
        entry.provider = await providers.open(entry.driver, { conversation: entry.conversation });
        if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_closed");
        return;
      }
      const state = await readState(entry);
      if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_closed");
      entry.provider = await openProvider(entry, entry.driver, state.binding, state.segmentId);
      if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_closed");
      return;
    }
    const binding = await storage.write(entry.id, async transaction => {
      for (const method of ["readMetadata", "writeMetadata", "updateTurnMetadata", "listTurnIds", "readTurn", "nextTurnId", "hasMessage", "appendMessage", "replaceAssistant"]) {
        if (typeof transaction[method] !== "function") throw new TypeError(`Conversation runtime storage requires transaction.${method}(). Run the runtime storage contract checks before using this adapter.`);
      }
      const metadata = await transaction.readMetadata();
      entry.engine = metadata.runtime?.engine || requestedEngine || defaultEngine;
      if (configuration) configuration = normalizeConversationConfiguration(configuration, { engine: entry.engine, defaultIntegrationId });
      const driver = entry.driver = createDriver(entry.engine, entry.host);
      if (metadata.runtime) {
        if (metadata.runtime.version !== 3 || typeof metadata.runtime.lastEngine !== "string" || typeof metadata.runtime.segmentId !== "string" || !metadata.runtime.segmentId || !Array.isArray(metadata.runtime.predecessors)) {
          throw failure("This conversation needs its offline runtime-state upgrade before it can be opened. Its saved requests were not replayed or changed.", "conversation_storage_version");
        }
        if (hasUnfinishedConversationRewind(metadata.runtime)) {
          throw failure("This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before opening it; no history was changed.", "conversation_rewind_inspection_required");
        }
        if (requestedEngine && requestedEngine !== entry.engine) throw failure("Use replace() to change this conversation's engine.", "conversation_engine_mismatch");
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
    if (!catalog || conversation.commands || conversation.native?.scoped || typeof facilities?.prepareContext !== "function") {
      throw new TypeError("Bound application tools require a catalogue, an admitted conversation and a server-owned context mapper.");
    }
    return { storage: createReentrantConversationStorage(facilities.storage), prepareContext: facilities.prepareContext };
  }

  async function perform(entry, active, configuration) {
    const { driver, engine, segmentId } = entry;
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

    async function saveTools(transaction, request, calls) {
      if (entry.conversation) {
        const saved = await transaction.readTurn(request.turnId);
        if (submittedMessage(saved || {})?.messageId !== request.input.messageId) {
          throw new Error("The application tool receipt does not belong to this authored request.");
        }
      }
      await transaction.updateTurnMetadata(request.turnId, { applicationTools: calls });
    }

    function prepareTools(request) {
      if (!catalog || entry.conversation && !applicationTools) return;
      request.tools = createConversationTools({ catalog, context: request.context, signal: active.controller.signal,
        ...(applicationTools ? { prepareContext() {
          if (!request.accepted) throw new Error("The application tool does not belong to an admitted message.");
          return applicationTools.prepareContext(request.context, Object.freeze({ conversationId: entry.id,
            turnId: request.turnId, messageId: request.input.messageId, nativeTurnId: request.nativeTurnId,
            nativeThreadId: request.nativeThreadId, origin: request.input.origin,
            assertCurrent() {
              active.controller.signal.throwIfAborted();
              if (entry.active !== active || current !== request || !request.accepted || request.finished) {
                throw failure("This application tool's admitted message is no longer current.", "conversation_tool_request_retired");
              }
            } }));
        } } : {}),
        maximumCalls: maximumToolCalls, discoveryOnly: driver.toolDiscovery === true,
        authorize: () => access(request.context, entry.id, "tool", entry),
        save: calls => {
          if (!request.accepted) throw new Error("The engine requested an application tool before admitting the message.");
          return toolStorage.write(entry.id, transaction => saveTools(transaction, request, calls));
        },
        emit: event => emit(entry, { ...event, turnId: request.turnId })
      });
    }

    async function writeProgress(transaction, request, status, error = "", extra = {}) {
      if (request.tools) await transaction.updateTurnMetadata(request.turnId, { applicationTools: request.tools.records() });
      if (!driver.canonicalTranscript) {
        for (const message of request.progress.values()) {
          if (!await transaction.hasMessage(message.messageId)) await transaction.appendMessage(request.turnId, message);
        }
        if (request.answer?.text.trim()) await transaction.replaceAssistant(request.turnId, request.answer);
      }
      const saved = driver.canonicalTranscript ? await transaction.readTurn(request.turnId) : null;
      await transaction.updateTurnMetadata(request.turnId, { runtime: { ...saved?.metadata?.runtime, status, engine, segmentId, origin: request.input.origin,
        ...(request.nativeTurnId ? { nativeTurnId: request.nativeTurnId } : {}),
        ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
        ...(request.continuedBy ? { continuedBy: request.continuedBy } : {}), ...extra, ...(error ? { error } : {}) } });
      return conversationHistoryVersions([{ turnId: request.turnId,
        messages: [...request.progress.values(), ...(request.answer?.text.trim() ? [request.answer] : [])] }]);
    }

    async function publishAdmission(request, nativeResult) {
      const receipt = { status: "accepted", messageId: request.input.messageId, turnId: request.turnId, origin: request.input.origin };
      request.admission.resolve(entry.conversation ? { receipt, nativeResult } : receipt);
      request.admissionSettled = true;
      await emit(entry, { type: "accepted", ...receipt });
      await setPhase(entry, "working", request.turnId);
      if ((entry.conversation || driver.canonicalTranscript) && entry.nativePhase && entry.nativePhase !== "working") await setPhase(entry, entry.nativePhase, request.turnId);
    }

    async function admit(request, seen, { nativeDelivery = false, conversationTurn } = {}) {
      await access(request.context, entry.id, request.operation, entry);
      if (!conversationTurn) active.controller.signal.throwIfAborted();
      if (request.input.goal) request.goalMessageId = request.input.messageId;
      else if (goalOwner) request.goalMessageId = goalOwner.input.messageId;
      const nativeTurnId = active.nativeTurnId;
      const previous = current;
      if (entry.conversation) {
        const saved = (await readTranscript(entry)).find(turn => turn.turnId === conversationTurn?.turnId);
        if (submittedMessage(saved || {})?.messageId !== request.input.messageId) {
          throw new Error("The native receipt does not belong to this authored request.");
        }
        request.turnId = saved.turnId;
      } else request.turnId = await storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        if (metadata.runtime.request?.messageId !== request.input.messageId) throw new Error("The pending conversation message changed before admission.");
        if (previous !== request && !previous.finished) {
          const versions = await writeProgress(transaction, previous, "running", "", { continuedBy: request.input.messageId });
          if (engine === "api") Object.assign(metadata.runtime.seen, versions);
        }
        let id;
        if (conversationTurn) {
          const saved = await transaction.readTurn(conversationTurn.turnId);
          if (submittedMessage(saved || {})?.messageId !== request.input.messageId || saved.metadata?.runtime?.segmentId !== segmentId) {
            throw new Error("The native receipt does not belong to this authored request.");
          }
          id = saved.turnId;
          await transaction.updateTurnMetadata(id, { runtime: { ...saved.metadata.runtime,
            ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
            ...(nativeTurnId ? { nativeTurnId } : {}) } });
        } else {
          id = await transaction.nextTurnId();
          await transaction.appendMessage(id, { role: request.input.origin === "application" ? "system" : "user", ...request.input, at: new Date().toISOString(),
            turnMetadata: { runtime: { status: "running", engine, segmentId, origin: request.input.origin,
              ...(request.goalMessageId ? { goalMessageId: request.goalMessageId } : {}),
              ...(nativeTurnId ? { nativeTurnId } : {}) } } });
        }
        if (engine === "api") {
          metadata.runtime.seen = { ...(seen || metadata.runtime.seen), ...conversationHistoryVersions([await transaction.readTurn(id)]) };
          metadata.runtime.lastEngine = engine;
          delete metadata.runtime.request;
        }
        await transaction.writeMetadata(metadata);
        if (engine !== "api" && !nativeDelivery) await rememberNative(entry, transaction, [await transaction.readTurn(id)]);
        return id;
      });
      if (previous !== request) {
        previous.sealed = true;
        previous.continuedBy = request.input.messageId;
        if (!driver.canonicalTranscript) streams.clear(entry.id);
      }
      request.accepted = true;
      request.nativeTurnId = nativeTurnId;
      if (request.input.goal) goalOwner = request;
      current = active.request = request;
      if (!nativeDelivery) await publishAdmission(request);
    }

    async function onNativeTurn({ turnId, nativeOwner = false }) {
      if (active.nativeTurnId === turnId) return;
      if (!nativeOwner || !driver.canonicalTranscript) throw new Error("The native continuation has no original conversation owner.");
      await access(current.context, entry.id, current.operation, entry);
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
            const versions = await writeProgress(transaction, request, completedStatus, completedError);
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
        if (written.length) await rememberNative(entry, transaction, written);
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
      await setPhase(entry, "working", request.turnId);
      if (request.sealed) return;
      const messageId = `${request.turnId}:${message.id}`;
      if (message.role === "assistant" && message.complete && message.text.length > maximumFinalReply) {
        if (request.answer?.messageId === messageId) request.answer = null;
        throw new Error("The assistant exceeded the configured final reply limit.");
      }
      const previous = request.answer?.messageId === messageId ? request.answer : request.progress.get(messageId);
      const outputOwner = message.outputId && messageOwners.get(message.outputId) || request;
      const outputId = previous?.outputId || (message.outputId ? `${outputOwner.turnId}:${message.outputId}` : "");
      const value = { messageId, ...(outputId ? { outputId } : {}),
        role: message.role, text: message.text, at: previous?.at || new Date().toISOString() };
      // Some native streams have temporary block identities. Only their final
      // history snapshots belong in the transcript, as in the original owner.
      if (message.transient) {
        streams.update(entry.id, { turnId: request.turnId, origin: request.input.origin, ...value });
      } else if (message.role === "assistant") {
        if (request.answer && request.answer.messageId !== messageId) {
          request.progress.set(request.answer.messageId, { ...request.answer, role: "commentary" });
          streams.complete(entry.id, request.answer.messageId);
        }
        request.progress.delete(messageId);
        request.answer = value;
        streams.update(entry.id, { turnId: request.turnId, origin: request.input.origin, ...value });
      } else {
        if (request.answer?.messageId === messageId) request.answer = null;
        if (message.complete) request.progress.set(messageId, value);
        if (message.complete) streams.complete(entry.id, messageId);
        else streams.update(entry.id, { turnId: request.turnId, origin: request.input.origin, ...value });
      }
      await emit(entry, { type: "message", turnId: request.turnId, messageId, origin: request.input.origin, role: message.role,
        ...(outputId ? { outputId } : {}),
        text: message.text, status: message.complete ? "complete" : "inProgress", streaming: streams.read(entry.id) });
    }

    function attachmentReader(request) {
      return createConversationAttachmentReader({ attachments, context: request.context, conversationId: entry.id,
        signal: active.controller.signal, authorize: () => access(request.context, entry.id, request.operation, entry),
        types: driver.attachmentTypes, maximumBytes: maximumAttachmentBytes });
    }

    async function beforeDispatch(request) {
      await access(request.context, entry.id, request.operation, entry);
      active.controller.signal.throwIfAborted();
      if (active.finishing) throw failure("The native turn finished before this instruction was sent. Send it as a new message.", "conversation_not_steerable");
    }

    async function deliverNative(request, dispatch) {
      const history = (await readTranscript(entry)).filter(turn => !turn.metadata?.runtime?.supersededBy);
      let completion;
      let committed;
      let rendered;
      let threadId;
      let attachmentManifest;
      let nativeResult;
      const dispatchPrepared = async input => {
        rendered = input;
        rejectionSaves.delete(request.input.messageId);
        if (request.operation === "steer" && !request.steering) throw failure("There is no active native turn to steer. Send a new message.", "conversation_not_steerable");
        if ((input.contextText || "").length > maximumContinuity) throw new Error("Conversation updates exceed the configured history budget. Renew the context with a continuity briefing before continuing.");
        if (request.input.goal && input.contextText) {
          throw failure("Send a chat message to deliver the saved continuity briefing before starting a native terminal or goal.", "conversation_replacement_briefing_pending");
        }
        const readAttachments = attachmentReader(request);
        // The bound host has already resolved its original attachment records;
        // the production preparation owner keeps their manifest/native mapping.
        const boundInput = entry.conversation ? await entry.conversation.prepareInput(input, request.context) : null;
        const files = boundInput ? { attachments: boundInput.displayAttachments || [], localFiles: [], content: [] }
          : await readAttachments((input.attachmentIds || []).map(attachmentId => ({ attachmentId })));
        const contextFiles = boundInput ? { localFiles: [], content: [] } : await readAttachments(input.contextAttachments || []);
        const localFiles = [...contextFiles.localFiles, ...files.localFiles];
        if (request.input.goal && localFiles.length) {
          throw failure("Native goals require extracted text or supported image bytes for attachments.", "conversation_unsupported", 400);
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
            : { ...request.input, at: request.at, attempted: false }), attachmentManifest };
          await transaction.writeMetadata(metadata);
        });
        const admitted = Promise.withResolvers();
        committed = Promise.withResolvers();
        committed.promise.catch(() => {});
        request.deliveryCommitted = committed.promise;
        completion = Promise.resolve().then(() => dispatch({
          context: request.context,
          input: { ...request.input, authoredInput: { ...request.input, at: request.at },
            ...(boundInput ? { nativeMessage: boundInput } : {}),
            text: input.message, contextText: input.contextText || "",
            content: [...contextFiles.content, ...files.content], localFiles, attachmentManifest },
          signal: active.controller.signal,
          ...(engine === "opencode" ? { deliveryCommitted: committed.promise } : {}),
          async beforeDispatch(native) {
            await beforeDispatch(request);
            threadId = native?.threadId;
            if (!threadId) throw new Error("Native admission requires the saved conversation identity.");
            await input.onPromptSending(entry.conversation ? native : { threadId, displayAttachments: files.attachments,
              turnMetadata: { runtime: { engine, segmentId, origin: request.input.origin } } });
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
          if (!entry.conversation && !request.accepted && error.delivery !== "uncertain") {
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
            if (entry.conversation) return request.originalInput?.onPromptSending?.({ threadId, displayAttachments, turnMetadata });
            await storage.write(entry.id, async transaction => {
              const metadata = await transaction.readMetadata();
              const pending = metadata.runtime.request;
              if (pending && pending.messageId !== request.input.messageId && (pending.attempted || pending.inspectionOnly)) throw new Error("The pending conversation instruction changed.");
              metadata.runtime.request = { ...request.input, at: request.at,
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
            if (entry.conversation) return request.originalInput?.onPromptRejected?.();
            if (!entry.conversation) await storage.write(entry.id, async transaction => {
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
          : await nativeChangeover(entry, request.context, request, dispatchPrepared).send({ engineId: engine,
            messages: entry.conversation ? await entry.conversation.transcript.history() : conversationNativeMessages(history),
            ...(entry.conversation ? { turnMetadata: { engineId: engine } } : {}), input });
        if (!delivered?.delivered) {
          const error = failure(delivered?.error || "Native delivery could not be confirmed.", delivered?.code || "conversation_delivery_uncertain");
          if (entry.conversation) {
            request.admission.resolve({ nativeResult: nativeResult || { value: delivered }, error });
            request.admissionSettled = true;
          }
          throw error;
        }
        if (request.accepted) await publishAdmission(request, nativeResult);
        else {
          const saved = (await readTranscript(entry)).find(turn => submittedMessage(turn)?.messageId === request.input.messageId);
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

    active.submit = async request => {
      try {
        prepareTools(request);
        await deliverNative(request, entry.provider.steer);
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
      await setPhase(entry, "preparing");
      const recordedHistory = await readTranscript(entry);
      const activeHistory = recordedHistory.filter(turn => !turn.metadata?.runtime?.supersededBy);
      const metadata = { runtime: await readState(entry) };
      const continuity = metadata.runtime.continuity;
      // Existing application transcripts precede the first runtime segment.
      // After replacement, their context is already carried by the briefing.
      const history = activeHistory.filter(turn => turn.metadata?.runtime?.segmentId === segmentId ||
        !turn.metadata?.runtime?.segmentId && !continuity);
      prepareTools(initial);
      const tools = initial.tools && { descriptors: initial.tools.descriptors, schemas: initial.tools.schemas, maximumArgumentBytes: initial.tools.maximumArgumentBytes,
        execute(input, options) {
          const request = toolOwners.get(input.id) || (options?.messageId ? active.requests.get(options.messageId) : current);
          if (!request?.accepted) throw new Error("The application tool does not belong to an admitted message.");
          toolOwners.set(input.id, request);
          // Calls already in flight retain their actor and turn. Keep application
          // mutations ordered across steering as well as within each request.
          const work = toolWork.then(() => request.tools.execute(input, options));
          toolWork = work.catch(error => { toolFailure ||= error; });
          return work;
        }
      };
      const providerInput = { configuration, context: initial.context, tools,
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
            return emit(entry, { ...event, turnId: request.turnId, messageId, streaming: streams.read(entry.id) });
          }
          if (event.type === "goal") {
            if (!driver.canonicalTranscript && event.goal?.status === "active" && !goalOwner) {
              await access(current.context, entry.id, "goal", entry);
              await storage.write(entry.id, async transaction => {
                const turn = await transaction.readTurn(current.turnId);
                await transaction.updateTurnMetadata(current.turnId, { runtime: { ...turn.metadata.runtime, goalMessageId: current.input.messageId } });
              });
              goalOwner = current;
              current.goalMessageId = current.input.messageId;
            }
            entry.goal = event.goal;
          }
          return event.type === "phase" ? setPhase(entry, event.phase, current.turnId) : emit(entry, { ...event, turnId: current.turnId });
        }
      };
      if (engine === "api") {
        const readAttachments = attachmentReader(initial);
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
          for (const turn of history) {
            const message = submittedMessage(turn);
            if (message?.attachments?.length) message.content = (await readAttachments(message.attachments)).content;
          }
        }
        const seen = conversationHistoryVersions(activeHistory);
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
          beforeDispatch: () => beforeDispatch(initial), accept: () => admit(initial, seen) });
        if (completion?.metadata && Object.keys(completion.metadata).length) {
          await storage.write(entry.id, transaction => transaction.updateTurnMetadata(initial.turnId, { completion: completion.metadata }));
        }
      } else {
        await deliverNative(initial, input => entry.provider.run({ ...providerInput, ...input }));
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
            if (request.accepted && request.tools?.records().length) await saveTools(transaction, request, request.tools.records());
          }
        });
        // Only opted-in application receipts are saved above. Native output,
        // checkpoints and status remain with the original run owner and sender.
        entry.error = error;
        entry.storageFailure = null;
        entry.saveProgress = null;
        return { type: "settled", turnId: current.turnId, status, error };
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
            const versions = await writeProgress(transaction, request, status, error);
            if (engine === "api") Object.assign(metadata.runtime.seen, versions);
            else written.push(await transaction.readTurn(request.turnId));
          }
        }
        if (!initial.accepted && metadata.runtime.request?.messageId === initial.input.messageId) {
          if (engine !== "api" || problem?.delivery === "uncertain") metadata.runtime.request.error = error;
          else delete metadata.runtime.request;
        }
        await transaction.writeMetadata(metadata);
        if (written.length) await rememberNative(entry, transaction, written);
      });
      streams.clear(entry.id);
      entry.error = error;
      entry.storageFailure = null;
      entry.saveProgress = null;
      return { type: "settled", turnId: current.turnId, status, error: entry.error };
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
    await setPhase(entry, "", current.turnId);
    await emit(entry, { type: "settled", turnId: current.turnId, status: entry.storageFailure || entry.executionFailure ? "failed" : status, error: entry.error });
  }

  async function send(entry, context, input, origin = "user", goal, representation) {
    await access(context, entry.id, goal ? "goal" : input?.steer === true ? "steer" : origin === "application" ? "wake" : "send", entry);
    if (entry.conversation?.commands) {
      if (origin !== "user" || goal) throw failure("This conversation supports its original application Send operation.", "conversation_unsupported", 400);
      return entry.conversation.commands.send(input, context);
    }
    if (entry.conversation?.native?.scoped) return entry.provider.sendNative({ input, context });
    const originalInput = representation === "native" ? input : undefined;
    const message = originalInput ? { ...input, text: input.displayMessage ?? input.message ?? input.text ?? "" } : input;
    const admission = await serial(entry, () => admitSend(entry, context, message, origin, goal, originalInput));
    const result = await (admission.receipt || admission.promise);
    if (!entry.conversation) return result;
    if (representation === "native") return result.nativeResult;
    if (result.error) throw result.error;
    return result.receipt;
  }

  // Called while holding the conversation queue, including Claude's existing
  // stop-then-Send goal commands. All commands retain the ordinary receipt path.
  async function admitSend(entry, context, input, origin = "user", goal, originalInput) {
    const operation = goal ? "goal" : input?.steer === true ? "steer" : origin === "application" ? "wake" : "send";
    await access(context, entry.id, operation, entry);
    await entry.conversation?.admission(context, operation);
    const attachmentIds = conversationAttachmentIds(input?.attachmentIds);
    if (!input || typeof input.messageId !== "string" || !input.messageId.trim() || input.messageId.length > 128 ||
        entry.engine !== "api" && !/^[\w-]{1,128}$/u.test(input.messageId) ||
        typeof input.text !== "string" || !input.text.trim() && !attachmentIds.length || input.text.length > maximumInput) {
      throw failure("Bounded text or attachment IDs and a stable messageId are required.", "conversation_invalid_message", 400);
    }
    if (!originalInput && input.attachments?.length) throw failure("Supply attachmentIds; only the application's resolver can supply file content.", "conversation_unsupported", 400);
    if (attachmentIds.length && !capabilities(entry).attachments) throw failure("File attachments are not configured for this conversation.", "conversation_unsupported", 400);
    if (input.steer !== undefined && typeof input.steer !== "boolean") throw failure("steer must be a boolean.", "conversation_invalid_message", 400);
    if (input.steer && !entry.driver.capabilities.steering) throw failure("This connection does not support steering.", "conversation_unsupported", 400);
    let data;
    if (input.data !== undefined) {
      try {
        if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) throw new TypeError();
        const encoded = JSON.stringify(input.data);
        if (input.text.length + encoded.length > maximumInput) throw new TypeError();
        data = JSON.parse(encoded);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError();
      } catch {
        throw failure("Application data must be a JSON object within the conversation input limit.", "conversation_invalid_message", 400);
      }
    }
    const message = { messageId: input.messageId, text: input.text.trim(), origin,
      attachments: attachmentIds.map(attachmentId => ({ attachmentId })), ...(data !== undefined ? { data } : {}), ...(goal ? { goal } : {}) };
    if (entry.storageFailure) throw entry.storageFailure;
    if (entry.executionFailure) throw entry.executionFailure;
    if (goal && goal.expectedSegmentId !== entry.segmentId) throw failure("The conversation changed before this goal command was sent.", "conversation_goal_changed");
    const pending = entry.active?.requests.get(message.messageId);
    if (pending && entry.engine !== "api" && !pending.admissionSettled) {
      if (!entry.conversation && !sameRequest(pending.input, message)) throw failure("This messageId already belongs to different content.", "conversation_message_conflict");
      return { promise: pending.admission.promise };
    }
    const history = await readTranscript(entry);
    const existing = history.find(turn => submittedMessage(turn)?.messageId === message.messageId);
    const nativeState = entry.engine !== "api" && (await readState(entry));
    const nativePending = nativeState?.request;
    if (existing) {
      const previous = submittedMessage(existing);
      if (!entry.conversation && !sameRequest(previous, message)) {
        throw failure("This messageId already belongs to different content.", "conversation_message_conflict");
      }
      if (!entry.conversation && !nativePending) return { receipt: { status: "accepted", messageId: message.messageId, turnId: existing.turnId, origin, duplicate: true } };
    }
    if (pending && !entry.conversation) {
      if (!sameRequest(pending.input, message)) throw failure("This messageId already belongs to different content.", "conversation_message_conflict");
      return { promise: pending.admission.promise };
    }
    const working = entry.active;
    if (entry.conversation && ["codex", "opencode", "claude"].includes(entry.engine) && operation === "send" && working?.finishing) {
      // No native dispatch has occurred for this request. Finish the previous
      // waiter before reserving the same authored request on the ordinary path.
      await working.done;
      return admitSend(entry, context, input, origin, goal, originalInput);
    }
    const nativeSteering = !working && (nativeState.nativeTurn?.active || entry.driver.canonicalTranscript && nativeState.binding?.codexAppServerRun &&
      codexAppServerTurnStateFromAgentRun(nativeState.binding.codexAppServerRun).active);
    if (working && !input.steer && !goal && !entry.conversation) throw failure("Wait for this answer or use steer to send another instruction.", "conversation_busy");
    if (input.steer && (!working && !nativeSteering || working?.finishing) && !(nativePending?.attempted || nativePending?.inspectionOnly)) throw failure("There is no active native turn to steer. Send a new message.", "conversation_not_steerable");
    if (goal && working?.finishing) throw failure("Wait for the current turn to finish saving before starting the goal.", "conversation_busy");
    if (working && (!working.request.admissionSettled || working.steering)) throw failure("Wait for the pending instruction to be admitted before steering again.", "conversation_busy");
    const barrier = working ? Promise.withResolvers() : null;
    if (barrier) working.steering = barrier.promise;
    const release = () => {
      barrier?.resolve();
      if (working && working.steering === barrier?.promise) working.steering = null;
    };
    let configuration;
    let requestAt = new Date().toISOString();
    try { configuration = entry.conversation ? (await readState(entry)).configuration : await storage.write(entry.id, async transaction => {
      const metadata = await transaction.readMetadata();
      if (metadata.runtime.replacement) throw failure("Finish the pending native replacement before sending another message.", "conversation_replacement_pending");
      if (retainedSegments(metadata.runtime).some(segment => segment.segmentId !== entry.segmentId && segment.request?.messageId === message.messageId)) {
        throw failure("This message has uncertain delivery in a retained conversation. Select that engine and check its receipt before submitting it again.", "conversation_delivery_uncertain");
      }
      if (metadata.runtime.request) {
        if (entry.engine === "api") throw failure("The previous submission has uncertain delivery. It will not be resent automatically.", "conversation_delivery_uncertain");
        if (metadata.runtime.request.messageId === message.messageId) {
          if (!sameRequest(metadata.runtime.request, message)) throw failure("This messageId already belongs to different content.", "conversation_message_conflict");
          requestAt = metadata.runtime.request.at;
        }
      } else metadata.runtime.request = { ...message, at: requestAt,
        ...(entry.engine !== "api" ? { attempted: false } : {}), ...(input.steer ? { steering: true } : {}) };
      await transaction.writeMetadata(metadata);
      return metadata.runtime.configuration;
    }); } catch (error) { release(); throw error; }
    const request = { input: message, originalInput, operation, context, at: requestAt, steering: Boolean(working || input.steer && nativeSteering),
      admission: Promise.withResolvers(), progress: new Map() };
    request.admission.promise.catch(() => {});
    if (working) {
      working.requests.set(message.messageId, request);
      working.submit(request).catch(error => request.admission.reject(error)).finally(release);
      return { promise: request.admission.promise };
    }
    const active = { request, requests: new Map([[message.messageId, request]]), controller: new AbortController() };
    entry.active = active;
    entry.error = "";
    if (limits.timeoutMs !== undefined) active.timer = setTimeout(() => {
      active.timedOut = true;
      active.controller.abort(new Error("The conversation request exceeded its time limit."));
    }, limits.timeoutMs);
    active.done = perform(entry, active, configuration);
    return { promise: request.admission.promise };
  }

  async function stop(entry, context, input, representation) {
    if (representation === "native") return entry.provider.cancel({ context, input, representation });
    const active = entry.active;
    if (!active && entry.executionFailure) {
      await entry.provider.cancel();
      await retrySave(entry);
      if (entry.cleanupTurnId && !entry.conversation) await storage.write(entry.id, async transaction => {
        const turn = await transaction.readTurn(entry.cleanupTurnId);
        await transaction.updateTurnMetadata(entry.cleanupTurnId,
          { runtime: { ...turn.metadata.runtime, status: "cancelled", error: "Work stopped." } });
      });
      entry.executionFailure = null;
      entry.cleanupTurnId = null;
      entry.error = "Work stopped.";
      return { stopped: true };
    }
    if (!active) {
      if (!entry.conversation && !entry.driver.canonicalTranscript) return { stopped: false };
      const metadata = { runtime: await readState(entry) };
      const result = await entry.provider.cancel({ configuration: metadata.runtime.configuration, context });
      return { stopped: result?.interrupted === true || result?.operationOutcome === "interrupted" };
    }
    active.controller.abort(new Error("Work stopped."));
    await active.done;
    if (entry.executionFailure) throw entry.executionFailure;
    return { stopped: true };
  }

  async function readGoal(entry, context, representation) {
    await access(context, entry.id, "readGoal", entry);
    if (!capabilities(entry).goals) return null;
    const configuration = representation === "native" ? undefined : (await readState(entry)).configuration;
    const result = await entry.provider.readGoal({ context, configuration });
    if (entry.conversation && representation !== "native" && result.nativeResult.status === "unavailable") {
      throw failure("The native goal is unavailable. Try reading its status again.", "conversation_goal_unavailable", 503);
    }
    entry.goal = entry.conversation ? result.goal : result;
    return representation === "native" ? result.nativeResult : structuredClone(entry.goal);
  }

  async function updateGoal(entry, context, input, representation) {
    await access(context, entry.id, "goal", entry);
    if (!capabilities(entry).goals) throw failure("This connection does not support native goals.", "conversation_unsupported", 400);
    if (representation !== "native" && !capabilities(entry).goals) {
      throw failure("This bound conversation does not yet map native goal messages to canonical receipts.", "conversation_unsupported", 400);
    }
    if (representation === "native") {
      const { operation } = await serial(entry, async () => {
        await access(context, entry.id, "goal", entry);
        // The original goal owner has its own admission. Its native message
        // acknowledgement must not hold the common queue ahead of Stop.
        return { operation: entry.provider.updateGoal({ context, input, representation }) };
      });
      const result = await operation;
      if (result.nativeResult.ok !== false) {
        entry.goal = result.goal;
        await emit(entry, { type: "goal", goal: entry.goal });
      }
      return result.nativeResult;
    }
    if (!input || !["set", "resume", "pause", "cancel"].includes(input.action) ||
        (typeof input.expectedSegmentId !== "string" && !(entry.conversation && input.expectedSegmentId === null)) ||
        input.expectedGoalId != null && (typeof input.expectedGoalId !== "string" || !input.expectedGoalId)) {
      throw failure("A goal action and current conversation segment are required.", "conversation_invalid_goal", 400);
    }
    const starting = input.action === "set" || input.action === "resume";
    const goal = { action: input.action, expectedSegmentId: input.expectedSegmentId, expectedGoalId: input.expectedGoalId || null };
    if (starting) {
      if (input.action === "set") {
        if (input.tokenBudget != null && !entry.driver.capabilities.goalBudgets) throw failure("This connection does not support goal token budgets.", "conversation_unsupported", 400);
        if (typeof input.objective !== "string" || !input.objective.trim() || input.objective.length > 4000 ||
            input.tokenBudget != null && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1)) {
          throw failure("A bounded objective and optional positive token budget are required.", "conversation_invalid_goal", 400);
        }
        goal.objective = input.objective.trim();
        if (input.tokenBudget != null) goal.tokenBudget = input.tokenBudget;
      } else if (!goal.expectedGoalId) throw failure("Select the goal to resume.", "conversation_invalid_goal", 400);
    }
    if (!starting && !input.expectedGoalId) throw failure("Select the goal to stop.", "conversation_invalid_goal", 400);
    const delivery = entry.driver.capabilities.goalCommands?.[input.action]?.delivery;
    if (!["message", "control"].includes(delivery)) throw failure("This connection does not support that goal command.", "conversation_unsupported", 400);
    const messageCommand = delivery === "message";
    if (messageCommand && (typeof input.messageId !== "string" || !/^[\w-]{1,128}$/u.test(input.messageId))) {
      throw failure("A stable messageId is required for this goal command.", "conversation_invalid_message", 400);
    }
    if (conversationAttachmentIds(input.attachmentIds).length || input.attachments?.length) {
      throw failure("This engine's native goal commands do not accept attachments.", "conversation_unsupported", 400);
    }
    const result = await serial(entry, async () => {
      await access(context, entry.id, "goal", entry);
      if (entry.conversation) await readState(entry);
      if (entry.segmentId !== input.expectedSegmentId) throw failure("The conversation changed before this goal command was sent.", "conversation_goal_changed");
      if (entry.conversation && input.expectedSegmentId === null && input.action !== "set") {
        throw failure("This command requires an existing native conversation.", "conversation_goal_changed");
      }
      if (entry.storageFailure) throw entry.storageFailure;
      if (entry.executionFailure) throw entry.executionFailure;
      if (messageCommand) {
        const history = await readTranscript(entry);
        const existing = history.find(turn => submittedMessage(turn)?.messageId === input.messageId);
        if (existing) {
          if (!entry.conversation && !isDeepStrictEqual(submittedMessage(existing).goal, goal)) throw failure("This messageId already belongs to different content.", "conversation_message_conflict");
          return { receipt: { status: "accepted", messageId: input.messageId, turnId: existing.turnId, origin: "user", duplicate: true } };
        }
      }
      if (entry.active && !entry.active.request.accepted) throw failure("Wait for the goal command to be admitted.", "conversation_busy");
      const metadata = { runtime: await readState(entry) };
      if (metadata.runtime.request && (entry.engine === "api" || metadata.runtime.request.attempted || metadata.runtime.request.inspectionOnly)) {
        throw failure("Check the uncertain command's delivery before changing the goal.", "conversation_delivery_uncertain");
      }
      if (entry.driver.canonicalTranscript && metadata.runtime.binding?.goalRequest) {
        throw failure("A goal command from an earlier runtime has unresolved delivery. Inspect its saved state before changing the goal.", "conversation_delivery_uncertain");
      }
      if (starting && (metadata.runtime.replacement || !entry.conversation && pendingSuccessor(metadata.runtime) || metadata.runtime.lastEngine !== entry.engine)) {
        throw failure("Send a message to catch this AI up before starting or resuming its goal.", "conversation_replacement_briefing_pending");
      }
      // Definitions keep native thread discovery stable. A control has no
      // admitted request, application-tool actor or executor of its own.
      const tools = catalog && entry.driver.toolDiscovery
        ? { schemas: catalog.resolveToolSet(context, { discoveryOnly: true }).tools.map(catalog.toOpenAiToolSchema) } : undefined;
      if (entry.conversation) {
        let receipt;
        // Preserve the original goal owner's acknowledgement wait outside the
        // invocation queue so the same Stop command can still interrupt it.
        const operation = entry.provider.updateGoal({ context, configuration: metadata.runtime.configuration,
          input: { ...input, ...goal }, representation, tools, interrupt: () => stop(entry, context),
          async send({ message }, { threadId }) {
            const admission = await serial(entry, async () => {
              const state = await readState(entry);
              const selectedSegment = `${entry.engine}:${threadId}`;
              if (!threadId || state.segmentId !== selectedSegment ||
                  input.expectedSegmentId !== null && input.expectedSegmentId !== selectedSegment) {
                throw failure("The conversation changed before this goal command was sent.", "conversation_goal_changed");
              }
              return admitSend(entry, context, { messageId: input.messageId, text: message }, "user",
                { ...goal, expectedSegmentId: selectedSegment });
            });
            const accepted = await (admission.receipt || admission.promise);
            if (accepted.error) throw accepted.error;
            receipt = accepted.receipt;
          }
        }).then(async updated => {
          if (updated.nativeResult.ok === false) throw Object.assign(new Error(updated.nativeResult.error), updated.nativeResult);
          entry.goal = updated.goal;
          await emit(entry, { type: "goal", goal: entry.goal });
          return receipt ? { receipt } : { goal: structuredClone(entry.goal) };
        });
        return { operation };
      }
      let delivery;
      const updated = await entry.provider.updateGoal({ context, configuration: metadata.runtime.configuration, input: { ...input, ...goal }, tools,
        interrupt: () => stop(entry, context),
        async send({ message }) {
          delivery = await admitSend(entry, context, { messageId: input.messageId, text: message }, "user", goal);
        }
      });
      // Release the queue once Send is reserved, just as an ordinary message
      // does. Stop remains available while native acknowledgement is pending.
      if (delivery) return delivery;
      if (entry.conversation && updated.nativeResult.ok === false) throw Object.assign(new Error(updated.nativeResult.error), updated.nativeResult);
      entry.goal = entry.conversation ? updated.goal : updated;
      await emit(entry, { type: "goal", goal: entry.goal });
      return { goal: structuredClone(entry.goal) };
    });
    const completed = result.operation ? await result.operation : result;
    return completed.receipt || completed.promise || completed.goal;
  }

  async function retrySave(entry) {
    if (!entry.storageFailure || !entry.saveProgress) return { saved: false };
    const event = await entry.saveProgress();
    await emit(entry, event);
    return { saved: true };
  }

  async function recoverDelivery(entry, context, messageId, { observation: suppliedObservation, allowActive = false } = {}) {
    await access(context, entry.id, "inspectDelivery", entry);
    if (entry.active && !allowActive) throw failure("Wait for the current submission before checking delivery.", "conversation_busy");
    if (entry.storageFailure) throw entry.storageFailure;
    if (entry.executionFailure) throw entry.executionFailure;
    const history = await readTranscript(entry);
    const existing = history.find(turn => submittedMessage(turn)?.messageId === messageId);
    const receipt = existing && { status: "accepted", messageId, turnId: existing.turnId, duplicate: true };
    const goalMessageId = existing?.metadata.runtime.goalMessageId;
    const goalRequest = Boolean(submittedMessage(existing || {})?.goal || goalMessageId === messageId);
    if (existing && (existing.metadata?.runtime?.segmentId !== entry.segmentId || existing.metadata.runtime.supersededBy ||
        existing.metadata.runtime.status === "complete" && !goalRequest)) return receipt;
    if (goalMessageId && goalMessageId !== messageId) {
      const owner = history.find(turn => submittedMessage(turn)?.messageId === goalMessageId);
      if (owner?.metadata.runtime.goalMessageId !== goalMessageId || owner.metadata.runtime.segmentId !== entry.segmentId) throw new Error("The goal command for this native continuation is missing.");
      const result = await inspectDelivery(entry, context, goalMessageId);
      return { ...receipt, recovered: result.recovered === true };
    }
    const metadata = { runtime: await readState(entry) };
    if (metadata.runtime.replacement) throw failure("Finish the native replacement before recovering output.", "conversation_replacement_pending");
    const savedRequests = [...metadata.runtime.predecessors, metadata.runtime].filter(segment => segment.request?.messageId === messageId);
    if (!existing && savedRequests.length && savedRequests.every(segment =>
      ["codex", "claude", "opencode"].includes(segment.engine) && segment.request.attempted === false && !segment.request.inspectionOnly &&
      isDeepStrictEqual(segment.request, savedRequests[0].request))) {
      await access(context, entry.id, "inspectDelivery", entry);
      return { status: "not-sent", messageId, error: "This message was not sent. Review it before sending a new message." };
    }
    const request = existing ? submittedMessage(existing) : metadata.runtime.request;
    if (!request || request.messageId !== messageId || !entry.provider.inspectAdmission) return receipt || { status: "unknown", messageId };
    const pending = metadata.runtime.request?.messageId === messageId ? metadata.runtime.request : null;
    if (pending?.threadId && pending.threadId !== nativeIdentity(metadata.runtime)) return receipt || { status: "unknown", messageId };
    const observation = suppliedObservation || await entry.provider.inspectAdmission({ ...request, nativeTurnId: existing?.metadata?.runtime?.nativeTurnId,
      context, configuration: metadata.runtime.configuration });
    await access(context, entry.id, "inspectDelivery", entry);
    if (!observation.accepted) return { ...(receipt || { status: "unknown", messageId }),
      ...(observation.recoveryLimitation ? { recoveryLimitation: observation.recoveryLimitation } : {}) };
    if (entry.driver.canonicalTranscript) {
      const latest = await readTranscript(entry);
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
          throw failure("Finish the native replacement before recovering output.", "conversation_replacement_pending");
        }
        const exact = await transaction.readTurn(saved.turnId);
        const { error: _previousError, ...runtime } = exact.metadata.runtime;
        await transaction.updateTurnMetadata(saved.turnId, { runtime: { ...runtime, status, ...(error ? { error } : {}) } });
      });
      if (Object.hasOwn(observation, "goal")) entry.goal = observation.goal;
      entry.error = error;
      const result = { ...(receipt || { status: "accepted", messageId, turnId: saved.turnId }),
        recovered: observation.recovered === true, ...(observation.recoveryLimitation ? { recoveryLimitation: observation.recoveryLimitation } : {}) };
      if (!existing) await emit(entry, { type: "accepted", ...result });
      if (result.recovered) await emit(entry, { type: "settled", turnId: saved.turnId, messageId, status, error });
      return result;
    }
    const recovered = await storage.write(entry.id, async transaction => {
      const current = await transaction.readMetadata();
      if (current.runtime.segmentId !== entry.segmentId || current.runtime.replacement) throw failure("Finish the native replacement before recovering output.", "conversation_replacement_pending");
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
            turnMetadata: { runtime: { engine: entry.engine, segmentId: entry.segmentId, origin: input.origin || "user" } } });
          turn = await transaction.readTurn(turnId);
          history.push(turn);
        }
        const runtime = turn.metadata.runtime;
        if (runtime.nativeTurnId && native.nativeTurnId && runtime.nativeTurnId !== native.nativeTurnId) throw new Error("Native history changed the accepted turn's identity.");
        const replies = [];
        for (const message of native.messages || []) {
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
        const oversizedReply = replyText.length > maximumFinalReply;
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
    if (!existing) await emit(entry, { type: "accepted", ...result });
    for (const turn of recovered) await emit(entry, { type: "settled", ...turn });
    return result;
  }

  async function inspectDelivery(entry, context, messageId) {
    if (entry.conversation?.commands) {
      await access(context, entry.id, "inspectDelivery", entry);
      const result = await entry.conversation.commands.inspectDelivery({ messageId }, context);
      await access(context, entry.id, "inspectDelivery", entry);
      return result;
    }
    if (entry.conversation) {
      await access(context, entry.id, "inspectDelivery", entry);
      const state = await readState(entry);
      // A running owner completes its own receipt. Only an idle owner recovers
      // the saved changeover, preserving write-receipt-before-clear ordering.
      if (!entry.active && state.request?.messageId === messageId && state.request.attempted) {
        const sender = nativeChangeover(entry, context, null, () => {
          throw new Error("Receipt inspection cannot submit another native prompt.");
        });
        const delivered = await sender.send({ engineId: entry.engine,
          messages: await entry.conversation.transcript.history(), input: { messageId } });
        if (!delivered?.delivered) throw failure(delivered?.error || "Native delivery could not be confirmed.", delivered?.code || "conversation_delivery_uncertain");
      }
      const row = (await readTranscript(entry)).find(turn => submittedMessage(turn)?.messageId === messageId);
      if (row) return { status: "accepted", messageId, turnId: row.turnId, duplicate: true };
      const threadId = state.request?.messageId === messageId ? state.request.threadId : nativeIdentity(state);
      if (!threadId) return { status: "unknown", messageId };
      const observation = await entry.provider.inspectAdmission({ messageId, threadId, context });
      await access(context, entry.id, "inspectDelivery", entry);
      // Native-only acceptance is evidence of delivery, not permission to
      // manufacture an authored row or use a native turn ID as its receipt.
      return observation.accepted ? { status: "accepted", messageId, duplicate: true } : { status: "unknown", messageId };
    }
    const result = await recoverDelivery(entry, context, messageId);
    if (result.status !== "accepted" || entry.engine === "api") return result;
    if (entry.driver.canonicalTranscript && result.recoveryLimitation) {
      const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
      if (runtime.request?.goal || runtime.binding?.goalRequest?.messageId === messageId ||
          runtime.binding?.goalReceipt?.messageId === messageId) return result;
    }
    const messages = conversationNativeMessages((await readTranscript(entry)).filter(turn => !turn.metadata?.runtime?.supersededBy));
    const sender = nativeChangeover(entry, context, null, () => {
      throw new Error("Receipt inspection cannot submit another native prompt.");
    });
    const pending = (await readState(entry)).request;
    if (pending?.messageId === messageId) {
      const delivered = await sender.send({ engineId: entry.engine, messages, input: { messageId } });
      if (!delivered?.delivered) throw failure(delivered?.error || "Native delivery could not be confirmed.", delivered?.code || "conversation_delivery_uncertain");
    }
    await sender.remember({ engineId: entry.engine, messages });
    return result;
  }

  async function replace(entry, context, input, selection = false, representation) {
    const operation = selection ? "select" : "replace";
    await access(context, entry.id, operation, entry);
    if (entry.conversation?.commands) {
      if (!selection) throw failure("This conversation retains its original replacement policy.", "conversation_unsupported", 400);
      return entry.conversation.commands.select(input, context);
    }
    if (entry.conversation?.native?.scoped) throw failure("This scoped conversation retains its original selected profile.", "conversation_unsupported");
    const keys = selection ? ["operationId", "expectedSegmentId", "engine", "configuration", "retireNative"]
      : ["operationId", "expectedSegmentId", "reason", "engine", "configuration", "briefing"];
    if (!input || !/^[\w-]{1,128}$/u.test(input.operationId || "") || typeof input.expectedSegmentId !== "string" ||
        !input.expectedSegmentId || (selection ? typeof input.engine !== "string" : !["engine-change", "model-change", "renewal"].includes(input.reason)) ||
        input.briefing !== undefined && typeof input.briefing !== "string" ||
        input.retireNative !== undefined && typeof input.retireNative !== "boolean" ||
        Object.keys(input).some(key => !keys.includes(key))) {
      throw failure("Replacement needs an operationId, exact predecessor segment, and an engine-change, model-change or renewal reason.", "conversation_invalid_replacement", 400);
    }
    if (entry.active) throw failure("Stop the current turn before replacing its native conversation.", "conversation_busy");
    if (entry.storageFailure) throw entry.storageFailure;
    if (entry.conversation) {
      const state = await readState(entry);
      const saved = await entry.conversation.state.read();
      const retry = saved?.replacement?.operationId === input.operationId;
      let nativeResult;
      if (state.segmentId !== input.expectedSegmentId && !retry) throw failure("The native predecessor has changed. Read the conversation before replacing it.", "conversation_replacement_conflict");
      if (selection) {
        if (!entry.conversation.selection?.write) throw failure("This host requires its authorized assistant selection operation.", "conversation_unsupported");
        await entry.conversation.selection.write(input, context);
      } else {
        if (!input.briefing?.trim()) throw failure("Native replacement requires a continuity briefing.", "conversation_invalid_replacement", 400);
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
      const next = await entry.host.conversation({ id: entry.id, context });
      entry.conversation = next;
      entry.applicationTools = boundApplicationTools(next);
      entry.engine = next.engine;
      entry.driver = createDriver(entry.engine, entry.host);
      const current = await readState(entry);
      entry.provider = await openProvider(entry, entry.driver, current.binding, current.segmentId);
      entry.goal = null;
      const receipt = { operationId: input.operationId, segmentId: entry.segmentId, ...(retry ? { duplicate: true } : {}) };
      await emit(entry, { type: "replaced", reason: input.reason || "model-change", engine: entry.engine, ...receipt });
      return representation === "native" ? nativeResult : receipt;
    }
    const request = { ...structuredClone(input), operation };
    // Receipt identity must survive JSON storage without picking up a later
    // runtime's connection default when the same operation is retried.
    if (request.engine === undefined) delete request.engine;
    if (request.briefing === undefined) delete request.briefing;
    if (request.configuration === undefined) delete request.configuration;
    else if (request.configuration) request.configuration = normalizeConversationConfiguration(request.configuration);
    let state = (await readState(entry));
    if (hasUnfinishedConversationRewind(state)) {
      throw failure("This conversation has an unfinished Undo operation from an earlier runtime. Inspect its saved native and local history offline before replacing it; no history was changed.", "conversation_rewind_inspection_required");
    }
    const completed = state.predecessors.find(item => item.replacement?.operationId === input.operationId);
    if (completed) {
      if (!isDeepStrictEqual(completed.replacement, request)) throw failure("This replacement operationId already belongs to another request.", "conversation_replacement_conflict");
      return { operationId: input.operationId, segmentId: completed.successorId, duplicate: true };
    }
    let pending = state.replacement;
    if (pending && !isDeepStrictEqual(pending.request, request)) throw failure("Retry the unfinished native replacement before starting another one.", "conversation_replacement_pending");
    if (state.segmentId !== input.expectedSegmentId) throw failure("The native predecessor has changed. Read the conversation before replacing it.", "conversation_replacement_conflict");
    if (!selection && retainedSegments(state).some(segment => segment.request)) throw failure("Resolve pending delivery before replacing native history. Another engine may be selected while its receipt stays pending.", "conversation_delivery_uncertain");
    if (!selection && !pending && pendingSuccessor(state)) throw failure("Deliver the previous replacement's briefing before replacing native history again.", "conversation_replacement_briefing_pending");
    if (entry.executionFailure && !pending) throw entry.executionFailure;
    const engine = pending?.engine || input.engine || state.engine;
    const configuration = pending?.configuration || (input.configuration
      ? normalizeConversationConfiguration(input.configuration, { engine, defaultIntegrationId }) : state.configuration);
    const driver = createDriver(engine, entry.host);
    driver.validateConfiguration(configuration);
    const predecessorId = nativeIdentity(state);
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
      await emit(entry, { type: "replaced", reason: "model-change", engine, ...receipt });
      return receipt;
    }
    if (!pending) {
      const history = (await readTranscript(entry)).filter(turn => !turn.metadata?.runtime?.supersededBy);
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
      pending = { request, engine, configuration: structuredClone(configuration),
        reason: selection ? state.engine === engine ? "model-change" : "engine-change" : input.reason,
        segmentId: destination?.segmentId || randomUUID(),
        continuity: continuity.text, continuityAttachments: continuity.attachments,
        seen: destination ? destination.seen : engine === "api" ? conversationHistoryVersions(history) : {},
        ...(destination ? { binding: destination.binding || null, submission: destination.request } : {}) };
    }

    function saveReplacement() {
      return storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        if (metadata.runtime.segmentId !== input.expectedSegmentId || metadata.runtime.replacement &&
            !isDeepStrictEqual(metadata.runtime.replacement.request, request)) {
          throw failure("The saved replacement changed before it could be written.", "conversation_replacement_conflict");
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
      await access(context, entry.id, operation, entry);
      if (pending.segmentId === state.segmentId) {
        pending.binding = (await readState(entry)).binding || null;
      }
      if (!Object.hasOwn(pending, "binding")) {
        pending.binding = driver.createBinding ? await driver.createBinding() : null;
        await saveReplacement();
      }
      provider = await openProvider(entry, driver, pending.binding, pending.segmentId, bindingOwner);
      try {
        await access(context, entry.id, operation, entry);
        await storage.write(entry.id, async transaction => {
          const metadata = await transaction.readMetadata();
          state = metadata.runtime;
          if (state.segmentId !== input.expectedSegmentId || !isDeepStrictEqual(state.replacement?.request, request)) {
            throw failure("The saved replacement changed before its binding was released.", "conversation_replacement_conflict");
          }
          await callback({
            async releaseBinding(replacement) {
              if (replacement && nativeIdentity(state) !== replacement.previous.conversationId) {
                throw failure("The native predecessor identity changed before its binding was released.", "conversation_replacement_conflict");
              }
              state.predecessors.push({ segmentId: state.segmentId, engine: state.engine,
                configuration: state.configuration, binding: state.binding, seen: state.seen,
                continuity: state.continuity, continuityAttachments: state.continuityAttachments, request: state.request,
                successorId: pending.segmentId, replacement: request,
                ...(pending.preparedAt ? { preparedAt: pending.preparedAt } : {}) });
              Object.assign(state, { engine, configuration: pending.configuration, binding: pending.binding,
                segmentId: pending.segmentId, continuity: pending.continuity, continuityAttachments: pending.continuityAttachments, seen: pending.seen });
              if (pending.submission) state.request = pending.submission;
              else delete state.request;
            },
            async write(value) {
              if (value) {
                if (engine !== "api") state.seen = value.engines[engine].seen;
                state.lastEngine = value.lastEngine;
              } else if (engine !== "api" &&
                  (!selection || input.retireNative === true || engine === "opencode" && !pending.binding.sessionId)) {
                state.lastEngine = "";
              }
              delete state.replacement;
              await transaction.writeMetadata(metadata);
            }
          });
        });
      } catch (error) { await provider.dispose(); throw error; }
    }

    if (nativeReplacement) {
      const replacement = createConversationChangeover({
        state: {
          read: changeoverState(entry).read,
          async write(value) {
            pending.preparedAt = value.replacement.preparedAt;
            await saveReplacement();
          },
          transaction: replacementTransaction
        },
        identity: {
          async inspect(expectedId) {
            const { runtime } = await storage.read(entry.id, transaction => transaction.readMetadata());
            if (runtime.segmentId !== input.expectedSegmentId || nativeIdentity(runtime) !== expectedId) {
              throw failure("The native predecessor identity changed or is incomplete.", "conversation_replacement_conflict");
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
    Object.assign(entry, { engine, driver, provider, bindingOwner, segmentId: pending.segmentId,
      goal: null, executionFailure: null, error: pending.submission?.error || "" });
    const receipt = { operationId: input.operationId, segmentId: pending.segmentId };
    await emit(entry, { type: "replaced", reason: pending.reason, engine, ...receipt });
    return receipt;
  }

  function retireEntry(entry) {
    entry.disposed = true;
    entry.listeners.clear();
    streams.clear(entry.id);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  async function disposeEntry(entry, context, options, representation) {
    if (entry.conversation?.commands) { retireEntry(entry); return; }
    if (!entry.conversation) await stop(entry, context);
    await retrySave(entry);
    const result = await entry.provider.dispose(entry.conversation?.native?.scoped && representation === "native"
      ? { input: options, context } : representation === "native" ? options : undefined);
    if (result?.ok === false) return result;
    if (entry.conversation) await entry.active?.done;
    retireEntry(entry);
    return result;
  }

  return Object.freeze({
    // Internal host composition uses its existing admission/write lease. These
    // original coordinators share the scoped owner and introduce no entry or queue.
    async readPersistentConversation(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return readPersistentConversation(options);
    },
    async startPersistentConversationTurn(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return startPersistentConversationTurn(options);
    },
    async inspectPersistentConversationAdmission(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return inspectPersistentConversationAdmission(options);
    },
    async preparePersistentConversationChangeover(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return preparePersistentConversationChangeover(options);
    },
    async inspectPersistentConversationDelivery(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return inspectPersistentConversationDelivery(options);
    },
    async stopPersistentConversation(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return stopPersistentConversation(options);
    },
    async deletePersistentConversation(options) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      return deletePersistentConversation(options);
    },
    async runScopedTurn(options = {}) {
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      if (["createEphemeralConversation", "startEphemeralConversationTurn", "waitForEphemeralConversationTurn", "stopEphemeralConversation"]
        .some(name => typeof options.operations?.[name] !== "function")) {
        throw new TypeError("A scoped turn requires its existing admitted conversation operations.");
      }
      return runScopedConversationTurn(options);
    },
    // Activity can still be inspected while cleanup retries after runtime closure.
    // Use the configured owner without retaining or creating a Main conversation.
    async inspectNativeTemporaryActivity({ id, context } = {}) {
      if (!await authorize({ context, conversationId: id, operation: "inspectTemporaryActivity" })) {
        throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
      }
      if (typeof defaultHost?.conversation !== "function") throw new TypeError("Native activity requires a configured conversation host.");
      const prepared = await defaultHost.conversation({ id, context, operation: "inspectTemporaryActivity" });
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) ||
          !prepared.native || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native activity requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).inspectTemporaryActivity(prepared);
    },
    // Renewal cleanup keeps its existing trusted server authority after closure.
    // Neither proof release opens a retained conversation or admits inference.
    async releaseNativeRenewalPredecessorProcessExitProof({ id, context, input = {} } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native renewal proof release requires a configured conversation host.");
      }
      const prepared = defaultHost.conversation({ id, context, input, operation: "releaseRenewalPredecessorProcessExitProof" });
      if (!prepared || typeof prepared.then === "function" || prepared.sessionId !== id ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native renewal proof release requires synchronous configured host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.releaseRenewalPredecessorProcessExitProof !== "function") {
        throw new TypeError("The selected conversation driver does not implement native renewal proof release.");
      }
      return driver.releaseRenewalPredecessorProcessExitProof(prepared);
    },
    async releaseNativeRenewalSuccessorProcessExitProof({ id, context, input = {} } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native renewal proof release requires a configured conversation host.");
      }
      const prepared = defaultHost.conversation({ id, context, input, operation: "releaseRenewalSuccessorProcessExitProof" });
      if (!prepared || typeof prepared.then === "function" || prepared.sessionId !== id ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native renewal proof release requires synchronous configured host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.releaseRenewalSuccessorProcessExitProof !== "function") {
        throw new TypeError("The selected conversation driver does not implement native renewal proof release.");
      }
      return driver.releaseRenewalSuccessorProcessExitProof(prepared);
    },
    // Renewal retains the application's existing session and private successor transaction.
    async generateNativeRenewalHandover({ id, context, input = {} } = {}) {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
      await access(context, id, "generateRenewalHandover");
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native renewal requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input, operation: "generateRenewalHandover" });
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native renewal requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).generateRenewalHandover(prepared);
    },
    // Renewal retains the application's existing session and private successor transaction.
    async seedNativeRenewalHandover({ id, context, input = {} } = {}) {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
      await access(context, id, "seedRenewalHandover");
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native renewal requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input, operation: "seedRenewalHandover" });
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native renewal requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).seedRenewalHandover(prepared);
    },
    // Readiness uses the same authorized host and original native owner without
    // opening a retained handle or starting a conversational turn.
    async ensureNativeConversation({ id, context } = {}) {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
      await access(context, id, "ensure");
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native conversation readiness requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, operation: "ensure" });
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) ||
          !prepared.native || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native conversation readiness requires its authorized host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.ensureConversation !== "function") {
        throw new TypeError("The selected conversation driver does not implement native readiness.");
      }
      return driver.ensureConversation(prepared);
    },
    // Advanced hosts create a native identity before a retained handle exists.
    // Only the configured host supplies native facilities; caller input is data.
    async createNativeConversation({ id, context, input = {} } = {}) {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
      await access(context, id, "create");
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native conversation creation requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input, operation: "create" });
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native conversation creation requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).createConversation(prepared);
    },
    async runNativeDetachedConversation({ id, context, input = {}, options } = {}) {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
      await access(context, id, "runDetachedConversation");
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native detached execution requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input,
        ...(options === undefined ? {} : { options }), operation: "runDetachedConversation" });
      if (closed) throw failure("This conversation runtime is closed.", "conversation_closed");
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context") || !Object.hasOwn(prepared, "options")) {
        throw new TypeError("Native detached execution requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).runDetachedConversation(prepared);
    },
    async open({ id, context, configuration, engine, host, representation = "canonical" } = {}) {
      if (typeof id !== "string" || !id.trim()) throw new TypeError("A conversation id is required.");
      await access(context, id, "open");
      const selectedHost = host || defaultHost;
      const conversation = selectedHost?.conversation ? await selectedHost.conversation({ id, context }) : null;
      const scoped = conversation?.native?.scoped;
      const commands = conversation?.commands;
      const invalidClaudeOwner = conversation?.engine === "claude" && (!conversation.native?.owner ||
        typeof conversation.native.owner !== "object" || typeof conversation.native.owner.acquire !== "function" ||
        typeof conversation.native.preparation?.cleanup !== "function");
      const invalidOpenCodeOwner = conversation?.engine === "opencode" && (!conversation.native?.owner ||
        typeof conversation.native.owner !== "object" || typeof conversation.native.preparation?.cleanup !== "function" ||
        (scoped ? ["turn", "existing"] : ["message", "inspection", "interruption"])
          .some(name => typeof conversation.native.preparation?.[name] !== "function") ||
        !scoped && typeof conversation.native.acquire !== "function");
      if (commands && (representation !== "canonical" || configuration !== undefined ||
          ["send", "cancel", "select", "inspectDelivery"].some(name => typeof commands[name] !== "function") ||
          typeof conversation.read !== "function" || typeof conversation.readStream !== "function")) {
        throw new TypeError("A logical conversation requires its complete original command, read and stream owners.");
      }
      if (scoped && (representation !== "native" || configuration !== undefined || !["codex", "claude", "opencode"].includes(conversation.engine) ||
          typeof scoped.conversationId !== "string" || !scoped.conversationId ||
          (conversation.engine === "claude" ? invalidClaudeOwner : conversation.engine === "opencode" ? invalidOpenCodeOwner
            : typeof conversation.native.preparation?.cleanup !== "function" ||
              ["startConversationTurn", "readConversation", "waitForConversationTurn", "stopConversation", "deleteConversation"]
                .some(name => typeof conversation.native.runOwner?.[name] !== "function")))) {
        throw new TypeError("An original scoped conversation requires its native representation, identity and existing operations.");
      }
      if (conversation && (conversation.sessionId !== id || typeof conversation.namespace !== "string" || !conversation.namespace ||
          !["codex", "claude", "opencode"].includes(conversation.engine) || !scoped && !commands && (
          (conversation.engine === "codex" ? !conversation.native?.runOwner || !conversation.native?.providerOwner
            : conversation.engine === "claude" ? invalidClaudeOwner
              : invalidOpenCodeOwner) ||
          typeof conversation.prepareInput !== "function" || typeof conversation.read !== "function"))) {
        throw new TypeError("A bound native conversation requires its original identity, store, preparation and native owners.");
      }
      if (!["canonical", "native"].includes(representation) || representation === "native" && !conversation) {
        throw new TypeError("Native result representation requires an original bound conversation.");
      }
      const key = conversation?.namespace || id;
      let entry = entries.get(key);
      if (!entry) {
        entry = { id, key, conversation, host: selectedHost, pending: Promise.resolve(), active: null, listeners: new Set(), error: "" };
        entries.set(key, entry);
        entry.initializing = initialize(entry, configuration, engine).catch(error => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      }
      await entry.initializing;
      if (entry.disposed) throw failure("This conversation handle is disposed.", "conversation_closed");
      if (host && !isDeepStrictEqual(host, entry.host)) throw failure("This open conversation already belongs to another host scope. Dispose its handle before reopening it on the original host.", "conversation_host_mismatch");
      if (engine && engine !== entry.engine) throw failure("Use replace() to change this conversation's engine.", "conversation_engine_mismatch");
      if (configuration) {
        const metadata = { runtime: await readState(entry) };
        const supplied = entry.conversation ? configuration
          : normalizeConversationConfiguration(configuration, { engine: entry.engine, defaultIntegrationId });
        if (!isDeepStrictEqual(supplied, metadata.runtime.configuration)) {
          throw failure("Use configure() to change a saved conversation's settings.", "conversation_configuration_mismatch");
        }
      }
      return Object.freeze({
        id,
        get capabilities() { return capabilities(entry); },
        replace: input => serial(entry, () => replace(entry, context, input, false, representation)),
        select: input => serial(entry, () => replace(entry, context, input, true, representation)),
        async read(query) {
          await access(context, id, "read", entry);
          const result = await read(entry, representation, context, query);
          if (entry.conversation?.commands) await access(context, id, "read", entry);
          return result;
        },
        send: input => send(entry, context, input, "user", undefined, representation),
        wake: input => send(entry, context, input, "application", undefined, representation),
        readGoal: () => serial(entry, () => readGoal(entry, context, representation)),
        updateGoal: input => updateGoal(entry, context, input, representation),
        inspectDelivery({ messageId, threadId } = {}) {
          if (typeof messageId !== "string" || !messageId) throw new TypeError("A message id is required.");
          return serial(entry, async () => {
            if (representation !== "native") return inspectDelivery(entry, context, messageId);
            await access(context, id, "inspectDelivery", entry);
            return entry.provider.inspectAdmission({ messageId, threadId, context, representation });
          });
        },
        async wait(input) {
          await access(context, id, "read", entry);
          if (entry.conversation?.commands) throw failure("This conversation uses its original read and subscription operations.", "conversation_unsupported", 400);
          if (entry.conversation?.native?.scoped) return entry.provider.waitNative({ input, context });
          await entry.pending;
          await entry.active?.done;
          await access(context, id, "read", entry);
          return read(entry);
        },
        async cancel(input) {
          await access(context, id, "cancel", entry);
          if (entry.conversation?.commands) return entry.conversation.commands.cancel(input, context);
          await entry.pending;
          await access(context, id, "cancel", entry);
          return stop(entry, context, input, representation);
        },
        async retrySave() {
          await access(context, id, "retrySave", entry);
          return serial(entry, async () => {
            await access(context, id, "retrySave", entry);
            return retrySave(entry);
          });
        },
        async configure(patch) {
          await access(context, id, "configure", entry);
          if (entry.conversation?.commands) throw failure("Use the conversation's authorized selection operation.", "conversation_unsupported", 400);
          return serial(entry, async () => {
            await access(context, id, "configure", entry);
            if (entry.active) throw failure("Stop the current turn before changing its settings.", "conversation_busy");
            if (entry.storageFailure) throw entry.storageFailure;
            if (entry.executionFailure) throw entry.executionFailure;
            if (entry.conversation) {
              if (!entry.conversation.selection?.write) throw failure("This host requires its authorized assistant selection operation.", "conversation_unsupported");
              return entry.conversation.selection.write({ configuration: patch }, context);
            }
            return storage.write(id, async transaction => {
              const metadata = await transaction.readMetadata();
              if (metadata.runtime.replacement) throw failure("Finish the pending native replacement before changing settings.", "conversation_replacement_pending");
              if (metadata.runtime.request && (entry.engine === "api" || metadata.runtime.request.attempted || metadata.runtime.request.inspectionOnly)) {
                throw failure("Resolve uncertain delivery before changing settings.", "conversation_delivery_uncertain");
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
          await access(context, id, "subscribe", entry);
          if (entry.conversation?.native?.scoped) throw failure("This scoped conversation retains its original event delivery.", "conversation_unsupported");
          if (typeof listener !== "function") throw new TypeError("A conversation listener is required.");
          const subscription = { context, listener };
          entry.listeners.add(subscription);
          return () => entry.listeners.delete(subscription);
        },
        async dispose(options) {
          await access(context, id, "dispose", entry);
          return serial(entry, async () => {
            await access(context, id, "dispose", entry);
            const result = await disposeEntry(entry, context, options, representation);
            if (result?.ok === false || representation === "native") return result;
          });
        }
      });
    },
    // Trusted server lifecycle, like close(): the application has already
    // authorized its project operation. Never expose this through browser routes.
    // Acquisition is synchronous and creates no retained conversation or queue.
    async closeNativeProject({ context, input = {} } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native project cleanup requires a configured conversation host.");
      }
      const prepared = defaultHost.conversation({ context, input, operation: "closeProject" });
      if (!prepared || typeof prepared.then === "function" ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native project cleanup requires synchronous configured host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.closeProject !== "function") {
        throw new TypeError("The selected conversation driver does not implement native project cleanup.");
      }
      return driver.closeProject(prepared);
    },
    // Account revocation and shutdown use this same trusted lifecycle boundary.
    // The configured owner enters its native closing fence before its first await.
    invalidateNativeRuntimes({ context, input = {} } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native runtime invalidation requires a configured conversation host.");
      }
      const prepared = defaultHost.conversation({ context, input, operation: "invalidateRuntimes" });
      if (!prepared || typeof prepared.then === "function" ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native runtime invalidation requires synchronous configured host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.invalidateRuntimes !== "function") {
        throw new TypeError("The selected conversation driver does not implement native runtime invalidation.");
      }
      return driver.invalidateRuntimes(prepared);
    },
    // Startup reconciliation and subscription reset use the existing trusted
    // lifecycle caller. Native owners retain their own shutdown fences and tasks.
    reconcileNativeSessions({ context, sessions, options = {} } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native reconciliation requires a configured conversation host.");
      }
      const prepared = defaultHost.conversation({ context, input: sessions, options, operation: "reconcileSessions" });
      if (!prepared || typeof prepared.then === "function" ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "sessions") || !Object.hasOwn(prepared, "options") ||
          !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native reconciliation requires synchronous configured host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.reconcileSessions !== "function") {
        throw new TypeError("The selected conversation driver does not implement native reconciliation.");
      }
      return driver.reconcileSessions(prepared);
    },
    unsubscribeNativeSessions({ context, sessions } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native subscription reset requires a configured conversation host.");
      }
      const prepared = defaultHost.conversation({ context, input: sessions, operation: "unsubscribeSessions" });
      if (!prepared || typeof prepared.then === "function" ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "sessions") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native subscription reset requires synchronous configured host preparation.");
      }
      const driver = createDriver(prepared.engine, defaultHost);
      if (typeof driver.unsubscribeSessions !== "function") {
        throw new TypeError("The selected conversation driver does not implement native subscription reset.");
      }
      return driver.unsubscribeSessions(prepared);
    },
    // Historical cleanup has a saved native identity but no retained scope.
    // Recheck its original caller authority; native owners retain shutdown guards.
    async interruptNativeDetachedConversation({ id, context, input = {} } = {}) {
      if (!await authorize({ context, conversationId: id, operation: "interruptDetachedConversation" })) {
        throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
      }
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Historical native cleanup requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input, operation: "interruptDetachedConversation" });
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Historical native cleanup requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).interruptDetachedConversation(prepared);
    },
    async deleteNativeDetachedConversation({ id, context, input = {} } = {}) {
      if (!await authorize({ context, conversationId: id, operation: "deleteDetachedConversation" })) {
        throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
      }
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Historical native cleanup requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input, operation: "deleteDetachedConversation" });
      if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Historical native cleanup requires its authorized host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).deleteDetachedConversation(prepared);
    },
    // Trusted server storage operations retain the saved engine and preservation
    // policy. They neither authorize inference nor acquire a retained handle.
    async listNativeConversationStorage({ id, context, binding } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native history storage requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input: binding, operation: "listNativeConversationStorage" });
      if (prepared?.sessionId !== id || prepared.binding !== binding || prepared.engine !== binding?.engineId ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native history storage requires its saved binding and configured host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).listConversationStorage(prepared);
    },
    async retireNativeConversationHistory({ id, context, binding } = {}) {
      if (typeof defaultHost?.conversation !== "function") {
        throw new TypeError("Native history storage requires a configured conversation host.");
      }
      const prepared = await defaultHost.conversation({ id, context, input: binding, operation: "retireConversationHistory" });
      if (prepared?.sessionId !== id || prepared.binding !== binding || prepared.engine !== binding?.engineId ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "context")) {
        throw new TypeError("Native history storage requires its saved binding and configured host preparation.");
      }
      return createDriver(prepared.engine, defaultHost).retireConversationHistory(prepared);
    },
    // Cleanup may retry after runtime closure. Missing or unready retained
    // handles use the configured native owner without opening a Main record.
    async disposeNative({ namespace, sessionId, context, options }) {
      const authorizeCleanup = async () => {
        if (!await authorize({ context, conversationId: sessionId, operation: "dispose" })) {
          throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
        }
      };
      const cleanupUnopened = async () => {
        if (typeof defaultHost?.conversation !== "function") return null;
        await authorizeCleanup();
        const prepared = await defaultHost.conversation({ id: sessionId, context, input: options, operation: "dispose" });
        if (prepared?.sessionId !== sessionId || prepared.namespace !== namespace ||
            !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
            !Object.hasOwn(prepared, "context") || !Object.hasOwn(prepared, "options")) {
          throw new TypeError("Native cleanup requires its authorized host preparation.");
        }
        return { result: await createDriver(prepared.engine, defaultHost).disposeNative(prepared) };
      };
      const entry = entries.get(namespace);
      if (!entry || entry.disposed) return cleanupUnopened();
      if (entry.id !== sessionId || !entry.conversation) {
        throw failure("Native cleanup requires its original bound conversation.", "conversation_host_mismatch");
      }
      await authorizeCleanup();
      const retained = await serial(entry, async () => {
        if (entry.disposed) return null;
        await authorizeCleanup();
        if (!entry.provider) {
          retireEntry(entry);
          return null;
        }
        return { result: await disposeEntry(entry, context, options, "native") };
      });
      return retained || cleanupUnopened();
    },
    // Host publication from the same native owner, through the existing entry.
    // This does not subscribe to a provider or retain another observer registry.
    async publishNative({ namespace, sessionId, event }) {
      const entry = entries.get(namespace);
      if (!entry || entry.id !== sessionId || entry.disposed || !entry.conversation) return;
      await entry.initializing;
      return entry.conversation.commands ? publish(entry, event) : entry.provider.publishNative(event);
    },
    async close() {
      closed = true;
      const results = await Promise.allSettled([...entries.values()].map(entry => serial(entry, async () => {
        await entry.initializing;
        const result = await disposeEntry(entry);
        if (result?.ok === false) throw Object.assign(new Error(result.error || "Native cleanup could not be confirmed."), result);
      })));
      const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, "Some conversations could not be safely closed. Restore their storage or execution host and retry close().");
    }
  });
}
