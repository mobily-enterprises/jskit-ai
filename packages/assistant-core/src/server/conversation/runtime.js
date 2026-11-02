import { createConversationProviderFactory } from "./provider.js";
import { normalizeConversationDeliveryHostStages } from "./deliveryTiming.js";
import * as scopedConversations from "./providers/scoped.js";
import { createConversationTranscript } from "./transcript.js";
import { createConversationStreams } from "./streams.js";
import { createReentrantConversationStorage } from "./storage.js";
import { createServiceToolCatalog } from "../lib/serviceToolCatalog.js";
import { failure } from "./conversationRefusals.js";
import { createConversationEvents, serial } from "./conversationEvents.js";
import { createConversationReads } from "./conversationReads.js";
import { createConversationOpening } from "./conversationOpening.js";
import { createConversationDelivery } from "./conversationDelivery.js";
import { createCompletedResponses } from "./completedResponses.js";
import { createConversationTurns } from "./conversationTurns.js";
import { createConversationSending } from "./conversationSending.js";
import { createConversationStopping } from "./conversationStopping.js";
import { createConversationGoals } from "./conversationGoals.js";
import { createConversationReplacement } from "./conversationReplacement.js";
import { createNativeConversationLifecycle } from "./nativeConversationLifecycle.js";
import { createConversationHandles } from "./conversationHandles.js";

/**
 * One application conversation API. Storage and authorization remain host facilities.
 * @param {object} [options]
 * @param {string} [options.engine] The engine of a new conversation; "api" when not given.
 * @param {string} [options.defaultIntegrationId] The AI connection a new API conversation uses.
 * @param {import("../types.js").ConversationStorage} [options.storage] Required unless the host supplies its conversations.
 * @param {import("../types.js").ConversationAuthorize} options.authorize
 * @param {import("../types.js").ConversationConnections} [options.connections]
 * @param {import("../types.js").ConversationApiClientFactory} [options.apiClientFactory]
 * @param {import("../types.js").ConversationApiHistory} [options.apiHistory]
 * @param {object} [options.actions] Application actions offered as tools, with toolPolicy.
 * @param {(action: object, context: object) => boolean} [options.toolPolicy]
 * @param {import("../types.js").ServiceToolCatalog} [options.toolCatalog] An existing tool catalogue, instead of actions.
 * @param {import("../types.js").ConversationAttachments} [options.attachments]
 * @param {typeof fetch} [options.fetch]
 * @param {import("../types.js").ConversationHost} [options.host]
 * @param {import("../types.js").ConversationDeliveryTimingObserver} [options.onDeliveryTiming]
 * @param {readonly string[]} [options.hostDeliveryStages]
 * @param {boolean} [options.persistCommentary]
 * @param {boolean} [options.completedEnvelope]
 * @param {import("../types.js").ConversationLimits} [options.limits]
 */
// readable-check: allow dependency-default - input validation: a call without options reaches the authorize check and its TypeError
export function createConversationRuntime({ engine: defaultEngine = "api", defaultIntegrationId, storage, authorize, connections, apiClientFactory, apiHistory,
  actions, toolPolicy, toolCatalog, attachments, fetch, host: defaultHost, onDeliveryTiming, hostDeliveryStages, persistCommentary = true, completedEnvelope = false,
  // readable-check: allow dependency-default - data: limits are numbers, and each absent one takes its default below
  limits = {} } = {}) {
  // readable-check: allow method-probe - input validation: the application must pass its authorize function
  if (typeof authorize !== "function") throw new TypeError("Conversation access requires an authorize function.");
  // readable-check: allow method-probe - input validation: an optional delivery timing observer must be a function
  if (onDeliveryTiming !== undefined && typeof onDeliveryTiming !== "function") throw new TypeError("Delivery timing requires a server-owned observer.");
  const deliveryHostStages = normalizeConversationDeliveryHostStages(hostDeliveryStages);
  if (typeof completedEnvelope !== "boolean") throw new TypeError("Completed envelope policy requires a server-side boolean.");
  if (typeof persistCommentary !== "boolean") throw new TypeError("Conversation commentary persistence requires an explicit server-side boolean.");
  // readable-check: allow method-probe - input validation: an optional API history selector must be a function
  if (apiHistory !== undefined && typeof apiHistory !== "function") throw new TypeError("API request history requires a server-owned selector.");
  if (toolCatalog && (actions || toolPolicy)) throw new TypeError("Supply the existing tool catalog or actions and toolPolicy, not both.");
  storage = (storage || !defaultHost?.conversation) ? createReentrantConversationStorage(storage) : null;
  const transcript = storage ? createConversationTranscript({ storage, applicationTurns: true }) : null;
  const streams = createConversationStreams();
  const entries = new Map();
  let closed = false;
  const isClosed = () => closed;
  const providers = createConversationProviderFactory({ connections, apiClientFactory, fetch, limits, actions, toolCatalog });
  const catalog = toolCatalog || (actions ? createServiceToolCatalog(actions, { ...limits, isActionAvailable: toolPolicy }) : null);
  if (completedEnvelope && !catalog) throw new TypeError("Completed envelopes require an application tool catalogue.");
  const maximumToolCalls = limits.maxToolCalls ?? 32;
  if (!Number.isSafeInteger(maximumToolCalls) || maximumToolCalls < 1) throw new TypeError("Invalid application tool-call limit.");
  const maximumInput = limits.maxInputCharacters ?? 32_000;
  if (!Number.isSafeInteger(maximumInput) || maximumInput < 1) throw new TypeError("Invalid conversation input limit.");
  const maximumFinalReply = limits.maxFinalReplyCharacters ?? Infinity;
  if (limits.maxFinalReplyCharacters !== undefined && (!Number.isSafeInteger(maximumFinalReply) || maximumFinalReply < 1)) {
    throw new TypeError("Invalid conversation final reply limit.");
  }
  const maximumCompletedOutput = limits.maxOutputCharacters ?? 64_000;
  if (completedEnvelope && (!Number.isSafeInteger(maximumCompletedOutput) || maximumCompletedOutput < 1)) {
    throw new TypeError("Invalid completed envelope output limit.");
  }
  const maximumContinuity = limits.maxContinuityCharacters ?? 128_000;
  if (!Number.isSafeInteger(maximumContinuity) || maximumContinuity < 1) throw new TypeError("Invalid conversation continuity limit.");
  const maximumAttachmentBytes = limits.maxAttachmentBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumAttachmentBytes) || maximumAttachmentBytes < 1) throw new TypeError("Invalid conversation attachment byte limit.");
  // readable-check: allow method-probe - input validation: optional attachments must bring their resolve function
  if (attachments !== undefined && typeof attachments?.resolve !== "function") throw new TypeError("Conversation attachments require an authorized resolve function.");
  if (limits.timeoutMs !== undefined && (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1)) {
    throw new TypeError("Invalid conversation request time limit.");
  }

  const events = createConversationEvents({ authorize, isClosed, storage, streams, completedEnvelope });
  const reads = createConversationReads({ storage, transcript, streams, providers, attachments, completedEnvelope });
  const opening = createConversationOpening({ storage, transcript, streams, providers, events, reads, catalog, defaultEngine, defaultIntegrationId,
    persistCommentary, completedEnvelope });
  const delivery = createConversationDelivery({ storage, transcript, events, reads, limits, persistCommentary, completedEnvelope, maximumFinalReply,
    maximumCompletedOutput });
  const completedResponses = createCompletedResponses({ storage, transcript, events, catalog, isClosed, completedEnvelope, maximumToolCalls });
  const turns = createConversationTurns({ storage, streams, events, reads, delivery, catalog, attachments, apiHistory, isClosed, persistCommentary,
    completedEnvelope, maximumToolCalls, maximumFinalReply, maximumCompletedOutput, maximumContinuity, maximumAttachmentBytes });
  const sending = createConversationSending({ storage, events, reads, turns, onDeliveryTiming, deliveryHostStages, limits, completedEnvelope, maximumInput });
  const stopping = createConversationStopping({ storage, streams, entries, events, reads, delivery });
  const goals = createConversationGoals({ events, reads, sending, stopping, catalog });
  const replacement = createConversationReplacement({ storage, providers, events, reads, opening, delivery, completedEnvelope, defaultIntegrationId,
    maximumContinuity });
  const lifecycle = createNativeConversationLifecycle({ authorize, defaultHost, providers, entries, events, stopping, isClosed });
  const handles = createConversationHandles({ entries, storage, defaultHost, events, reads, opening, sending, goals, delivery, stopping, replacement,
    completedResponses, completedEnvelope, persistCommentary, defaultIntegrationId });

  // Internal host composition uses its existing admission/write lease. These
  // original coordinators share the scoped owner and introduce no entry or queue.

  async function projectStoredPersistentConversation(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.projectStoredPersistentConversation(options);
  }

  async function readPersistentConversation(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.readPersistentConversation(options);
  }

  async function startPersistentConversationTurn(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.startPersistentConversationTurn(options);
  }

  async function inspectPersistentConversationAdmission(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.inspectPersistentConversationAdmission(options);
  }

  async function preparePersistentConversationChangeover(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.preparePersistentConversationChangeover(options);
  }

  async function inspectPersistentConversationDelivery(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.inspectPersistentConversationDelivery(options);
  }

  async function stopPersistentConversation(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.stopPersistentConversation(options);
  }

  async function deletePersistentConversation(options) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return scopedConversations.deletePersistentConversation(options);
  }

  async function runScopedTurn(options = {}) {
    if (closed) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    if (["createEphemeralConversation", "startEphemeralConversationTurn", "waitForEphemeralConversationTurn", "stopEphemeralConversation"]
      // readable-check: allow method-probe - input validation: a scoped turn's caller passes its admitted conversation operations
      .some(name => typeof options.operations?.[name] !== "function")) {
      throw new TypeError("A scoped turn requires its existing admitted conversation operations.");
    }
    return scopedConversations.runScopedConversationTurn(options);
  }

  // Trusted server lifecycle: the application deleted or archived a logical
  // conversation that it binds through its own commands. Its open entry, if
  // any, leaves memory and its handles close. Nothing is opened; native and
  // storage-owned conversations keep their own disposal.
  async function retireOpenConversation({ namespace, sessionId }) {
    const entry = entries.get(namespace);
    if (!entry || entry.id !== sessionId) return { retired: false };
    if (!entry.conversation?.commands) {
      throw new TypeError("Only a logical conversation bound through its commands retires without disposal.");
    }
    await entry.initializing.catch(() => {});
    return serial(entry, async () => {
      if (entry.disposed || entries.get(namespace) !== entry) return { retired: false };
      stopping.retireEntry(entry);
      return { retired: true };
    });
  }

  // Host publication from the same native owner, through the existing entry.
  // This does not subscribe to a provider or retain another observer registry.
  async function publishNative({ namespace, sessionId, event }) {
    const entry = entries.get(namespace);
    if (!entry || entry.id !== sessionId || entry.disposed || !entry.conversation) return;
    await entry.initializing;
    return entry.conversation.commands ? events.publish(entry, event) : entry.provider.publishNative(event);
  }

  async function close() {
    closed = true;
    const results = await Promise.allSettled([...entries.values()].map(entry => serial(entry, async () => {
      await entry.initializing;
      const result = await stopping.disposeEntry(entry);
      if (result?.ok === false) throw Object.assign(new Error(result.error || "Native cleanup could not be confirmed."), result);
    })));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "Some conversations could not be safely closed. Restore their storage or execution host and retry close().");
  }

  return Object.freeze({
    projectStoredPersistentConversation,
    readPersistentConversation,
    startPersistentConversationTurn,
    inspectPersistentConversationAdmission,
    preparePersistentConversationChangeover,
    inspectPersistentConversationDelivery,
    stopPersistentConversation,
    deletePersistentConversation,
    runScopedTurn,
    inspectNativeTemporaryActivity: lifecycle.inspectNativeTemporaryActivity,
    releaseNativeRenewalPredecessorProcessExitProof: lifecycle.releaseNativeRenewalPredecessorProcessExitProof,
    releaseNativeRenewalSuccessorProcessExitProof: lifecycle.releaseNativeRenewalSuccessorProcessExitProof,
    generateNativeRenewalHandover: lifecycle.generateNativeRenewalHandover,
    seedNativeRenewalHandover: lifecycle.seedNativeRenewalHandover,
    updateNativeConversationSettings: lifecycle.updateNativeConversationSettings,
    ensureNativeConversation: lifecycle.ensureNativeConversation,
    createNativeConversation: lifecycle.createNativeConversation,
    runNativeDetachedConversation: lifecycle.runNativeDetachedConversation,
    open: handles.open,
    closeNativeProject: lifecycle.closeNativeProject,
    invalidateNativeRuntimes: lifecycle.invalidateNativeRuntimes,
    reconcileNativeSessions: lifecycle.reconcileNativeSessions,
    unsubscribeNativeSessions: lifecycle.unsubscribeNativeSessions,
    interruptNativeDetachedConversation: lifecycle.interruptNativeDetachedConversation,
    deleteNativeDetachedConversation: lifecycle.deleteNativeDetachedConversation,
    listNativeConversationStorage: lifecycle.listNativeConversationStorage,
    retireNativeConversationHistory: lifecycle.retireNativeConversationHistory,
    disposeNative: lifecycle.disposeNative,
    retireOpenConversation,
    publishNative,
    close
  });
}
