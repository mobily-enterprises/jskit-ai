import { failure } from "./conversationRefusals.js";
import { serial } from "./conversationEvents.js";

// readable-check: allow method-probe - input validation: a host preparation that is a promise is refused, since these operations prepare synchronously
const isThenable = value => typeof value.then === "function";

// readable-check: allow method-probe - optional operation: each native lifecycle method is optional in the conversation driver contract, and an engine without it refuses
const implementsOperation = (driver, name) => typeof driver[name] === "function";

/**
 * Native operations that use the configured host and its engine's driver directly, without a
 * retained conversation handle: activity, renewal, settings, readiness, creation, detached
 * runs, project and runtime lifecycle, session reconciliation, native history storage and
 * the cleanup of a conversation that is not open.
 * @param {object} dependencies
 * @param {import("../types.js").ConversationAuthorize} dependencies.authorize
 * @param {import("../types.js").ConversationHost | undefined} dependencies.defaultHost
 * @param {import("./provider.js").ConversationProviderFactory} dependencies.providers
 * @param {Map<string, any>} dependencies.entries The open conversations, by namespace or id.
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationStopping.js").ConversationStopping} dependencies.stopping
 * @param {() => boolean} dependencies.isClosed Whether the runtime has closed.
 */
function createNativeConversationLifecycle({ authorize, defaultHost, providers, entries, events, stopping, isClosed }) {
  // readable-check: allow method-probe - input validation: the runtime's host option is optional, and these operations need its conversation preparation
  const hostPrepares = () => typeof defaultHost?.conversation === "function";

  // Activity can still be inspected while cleanup retries after runtime closure.
  // Use the configured owner without retaining or creating a Main conversation.
  async function inspectNativeTemporaryActivity({ id, context } = {}) {
    if (!await authorize({ context, conversationId: id, operation: "inspectTemporaryActivity" })) {
      throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
    }
    if (!hostPrepares()) throw new TypeError("Native activity requires a configured conversation host.");
    const prepared = await defaultHost.conversation({ id, context, operation: "inspectTemporaryActivity" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) ||
        !prepared.native || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native activity requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).inspectTemporaryActivity(prepared);
  }

  // Renewal cleanup keeps its existing trusted server authority after closure.
  // Neither proof release opens a retained conversation or admits inference.
  async function releaseNativeRenewalPredecessorProcessExitProof({ id, context, input = {} } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native renewal proof release requires a configured conversation host.");
    }
    const prepared = defaultHost.conversation({ id, context, input, operation: "releaseRenewalPredecessorProcessExitProof" });
    if (!prepared || isThenable(prepared) || prepared.sessionId !== id ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native renewal proof release requires synchronous configured host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "releaseRenewalPredecessorProcessExitProof")) {
      throw new TypeError("The selected conversation driver does not implement native renewal proof release.");
    }
    return driver.releaseRenewalPredecessorProcessExitProof(prepared);
  }

  async function releaseNativeRenewalSuccessorProcessExitProof({ id, context, input = {} } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native renewal proof release requires a configured conversation host.");
    }
    const prepared = defaultHost.conversation({ id, context, input, operation: "releaseRenewalSuccessorProcessExitProof" });
    if (!prepared || isThenable(prepared) || prepared.sessionId !== id ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native renewal proof release requires synchronous configured host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "releaseRenewalSuccessorProcessExitProof")) {
      throw new TypeError("The selected conversation driver does not implement native renewal proof release.");
    }
    return driver.releaseRenewalSuccessorProcessExitProof(prepared);
  }

  // Renewal retains the application's existing session and private successor transaction.
  async function generateNativeRenewalHandover({ id, context, input = {} } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
    await events.access(context, id, "generateRenewalHandover");
    if (!hostPrepares()) {
      throw new TypeError("Native renewal requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input, operation: "generateRenewalHandover" });
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native renewal requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).generateRenewalHandover(prepared);
  }

  // Renewal retains the application's existing session and private successor transaction.
  async function seedNativeRenewalHandover({ id, context, input = {} } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
    await events.access(context, id, "seedRenewalHandover");
    if (!hostPrepares()) {
      throw new TypeError("Native renewal requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input, operation: "seedRenewalHandover" });
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native renewal requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).seedRenewalHandover(prepared);
  }

  async function updateNativeConversationSettings({ id, context, input = {} } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A conversation id is required.");
    await events.access(context, id, "configure");
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    // readable-check: allow optional-call - input validation: without a configured host the missing preparation is refused just below
    const prepared = await defaultHost?.conversation?.({ id, context, input, operation: "updateSettings" });
    if (prepared?.sessionId !== id || !prepared.native || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native settings require their authorized host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "updateConversationSettings")) {
      throw failure("This provider does not support live native settings.", "conversation_live_settings_unsupported", 409, { messageCode: "assistant.conversation.liveSettingsUnsupported" });
    }
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    return driver.updateConversationSettings({ ...prepared, input });
  }

  // Readiness uses the same authorized host and original native owner without
  // opening a retained handle or starting a conversational turn.
  async function ensureNativeConversation({ id, context } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
    await events.access(context, id, "ensure");
    if (!hostPrepares()) {
      throw new TypeError("Native conversation readiness requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, operation: "ensure" });
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) ||
        !prepared.native || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native conversation readiness requires its authorized host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "ensureConversation")) {
      throw new TypeError("The selected conversation driver does not implement native readiness.");
    }
    return driver.ensureConversation(prepared);
  }

  /**
   * Advanced hosts create a native identity before a retained handle exists.
   * Only the configured host supplies native facilities; caller input is data.
   * @param {{ id?: string, context?: object, input?: object }} [request]
   */
  // readable-check: allow dependency-default - input validation: a call without a request reaches the id check and its TypeError
  async function createNativeConversation({ id, context, input = {} } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
    await events.access(context, id, "create");
    if (!hostPrepares()) {
      throw new TypeError("Native conversation creation requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input, operation: "create" });
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native conversation creation requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).createConversation(prepared);
  }

  async function runNativeDetachedConversation({ id, context, input = {}, options } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("A parent conversation or scope id is required.");
    await events.access(context, id, "runDetachedConversation");
    if (!hostPrepares()) {
      throw new TypeError("Native detached execution requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input,
      ...(options === undefined ? {} : { options }), operation: "runDetachedConversation" });
    if (isClosed()) throw failure("This conversation runtime is closed.", "conversation_runtime_closed", 409, { messageCode: "assistant.conversation.runtimeClosed" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context") || !Object.hasOwn(prepared, "options")) {
      throw new TypeError("Native detached execution requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).runDetachedConversation(prepared);
  }

  // Trusted server lifecycle, like close(): the application has already
  // authorized its project operation. Never expose this through browser routes.
  // Acquisition is synchronous and creates no retained conversation or queue.
  async function closeNativeProject({ context, input = {} } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native project cleanup requires a configured conversation host.");
    }
    const prepared = defaultHost.conversation({ context, input, operation: "closeProject" });
    if (!prepared || isThenable(prepared) ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native project cleanup requires synchronous configured host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "closeProject")) {
      throw new TypeError("The selected conversation driver does not implement native project cleanup.");
    }
    return driver.closeProject(prepared);
  }

  // Account revocation and shutdown use this same trusted lifecycle boundary.
  // The configured owner enters its native closing fence before its first await.
  function invalidateNativeRuntimes({ context, input = {} } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native runtime invalidation requires a configured conversation host.");
    }
    const prepared = defaultHost.conversation({ context, input, operation: "invalidateRuntimes" });
    if (!prepared || isThenable(prepared) ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native runtime invalidation requires synchronous configured host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "invalidateRuntimes")) {
      throw new TypeError("The selected conversation driver does not implement native runtime invalidation.");
    }
    return driver.invalidateRuntimes(prepared);
  }

  // Startup reconciliation and subscription reset use the existing trusted
  // lifecycle caller. Native owners retain their own shutdown fences and tasks.
  function reconcileNativeSessions({ context, sessions, options = {} } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native reconciliation requires a configured conversation host.");
    }
    const prepared = defaultHost.conversation({ context, input: sessions, options, operation: "reconcileSessions" });
    if (!prepared || isThenable(prepared) ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "sessions") || !Object.hasOwn(prepared, "options") ||
        !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native reconciliation requires synchronous configured host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "reconcileSessions")) {
      throw new TypeError("The selected conversation driver does not implement native reconciliation.");
    }
    return driver.reconcileSessions(prepared);
  }

  function unsubscribeNativeSessions({ context, sessions } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native subscription reset requires a configured conversation host.");
    }
    const prepared = defaultHost.conversation({ context, input: sessions, operation: "unsubscribeSessions" });
    if (!prepared || isThenable(prepared) ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "sessions") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native subscription reset requires synchronous configured host preparation.");
    }
    const driver = providers.createDriver(prepared.engine, defaultHost);
    if (!implementsOperation(driver, "unsubscribeSessions")) {
      throw new TypeError("The selected conversation driver does not implement native subscription reset.");
    }
    return driver.unsubscribeSessions(prepared);
  }

  // Historical cleanup has a saved native identity but no retained scope.
  // Recheck its original caller authority; native owners retain shutdown guards.
  async function interruptNativeDetachedConversation({ id, context, input = {} } = {}) {
    if (!await authorize({ context, conversationId: id, operation: "interruptDetachedConversation" })) {
      throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
    }
    if (!hostPrepares()) {
      throw new TypeError("Historical native cleanup requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input, operation: "interruptDetachedConversation" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Historical native cleanup requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).interruptDetachedConversation(prepared);
  }

  async function deleteNativeDetachedConversation({ id, context, input = {} } = {}) {
    if (!await authorize({ context, conversationId: id, operation: "deleteDetachedConversation" })) {
      throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
    }
    if (!hostPrepares()) {
      throw new TypeError("Historical native cleanup requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input, operation: "deleteDetachedConversation" });
    if (prepared?.sessionId !== id || !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "input") || !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Historical native cleanup requires its authorized host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).deleteDetachedConversation(prepared);
  }

  // Trusted server storage operations retain the saved engine and preservation
  // policy. They neither authorize inference nor acquire a retained handle.
  async function listNativeConversationStorage({ id, context, binding } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native history storage requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input: binding, operation: "listNativeConversationStorage" });
    if (prepared?.sessionId !== id || prepared.binding !== binding || prepared.engine !== binding?.engineId ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native history storage requires its saved binding and configured host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).listConversationStorage(prepared);
  }

  async function retireNativeConversationHistory({ id, context, binding } = {}) {
    if (!hostPrepares()) {
      throw new TypeError("Native history storage requires a configured conversation host.");
    }
    const prepared = await defaultHost.conversation({ id, context, input: binding, operation: "retireConversationHistory" });
    if (prepared?.sessionId !== id || prepared.binding !== binding || prepared.engine !== binding?.engineId ||
        !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
        !Object.hasOwn(prepared, "context")) {
      throw new TypeError("Native history storage requires its saved binding and configured host preparation.");
    }
    return providers.createDriver(prepared.engine, defaultHost).retireConversationHistory(prepared);
  }

  // Cleanup may retry after runtime closure. Missing or unready retained
  // handles use the configured native owner without opening a Main record.
  async function disposeNative({ namespace, sessionId, context, options }) {
    const authorizeCleanup = async () => {
      if (!await authorize({ context, conversationId: sessionId, operation: "dispose" })) {
        throw failure("This conversation is not available to this identity.", "conversation_forbidden", 403);
      }
    };
    const cleanupUnopened = async () => {
      if (!hostPrepares()) return null;
      await authorizeCleanup();
      const prepared = await defaultHost.conversation({ id: sessionId, context, input: options, operation: "dispose" });
      if (prepared?.sessionId !== sessionId || prepared.namespace !== namespace ||
          !["codex", "claude", "opencode"].includes(prepared.engine) || !prepared.native ||
          !Object.hasOwn(prepared, "context") || !Object.hasOwn(prepared, "options")) {
        throw new TypeError("Native cleanup requires its authorized host preparation.");
      }
      return { result: await providers.createDriver(prepared.engine, defaultHost).disposeNative(prepared) };
    };
    const entry = entries.get(namespace);
    if (!entry || entry.disposed) return cleanupUnopened();
    if (entry.id !== sessionId || !entry.conversation) {
      throw failure("Native cleanup requires its original bound conversation.", "conversation_cleanup_needs_original_conversation", 409, { messageCode: "assistant.conversation.cleanupNeedsOriginalConversation" });
    }
    await authorizeCleanup();
    const retained = await serial(entry, async () => {
      if (entry.disposed) return null;
      await authorizeCleanup();
      if (!entry.provider) {
        stopping.retireEntry(entry);
        return null;
      }
      return { result: await stopping.disposeEntry(entry, context, options, "native") };
    });
    return retained || cleanupUnopened();
  }

  return Object.freeze({
    inspectNativeTemporaryActivity,
    releaseNativeRenewalPredecessorProcessExitProof,
    releaseNativeRenewalSuccessorProcessExitProof,
    generateNativeRenewalHandover,
    seedNativeRenewalHandover,
    updateNativeConversationSettings,
    ensureNativeConversation,
    createNativeConversation,
    runNativeDetachedConversation,
    closeNativeProject,
    invalidateNativeRuntimes,
    reconcileNativeSessions,
    unsubscribeNativeSessions,
    interruptNativeDetachedConversation,
    deleteNativeDetachedConversation,
    listNativeConversationStorage,
    retireNativeConversationHistory,
    disposeNative
  });
}

/** @typedef {ReturnType<typeof createNativeConversationLifecycle>} NativeConversationLifecycle */

export { createNativeConversationLifecycle };
