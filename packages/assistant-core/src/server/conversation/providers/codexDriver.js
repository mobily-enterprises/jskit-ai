import { jsonHash as hash } from "../normalize.js";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { open as openFile, realpath } from "node:fs/promises";
import { createCodexAppServerRuntime } from "../codexRuntime.js";
import { inspectCodexAppServerMessageAdmission, retireCodexConversationHistory } from "../codexProviderThreads.js";
import { createCodexAppServerProviderOwner } from "../codexProviderOwner.js";
import { codexAuthOutputRequiresReconnect } from "../codexAccountReader.js";
import { createCodexAppServerRunOwner, codexAppServerTurnState } from "../codexTurn.js";
import { createLocalConversationExecution } from "../localExecution.js";
import { validateConversationConfiguration } from "../configuration.js";
import { createScopedConversationHandle } from "./scoped.js";
import { codexCommandHookCommand } from "../commandWrapper.js";
import { isCompletedEnvelopeTurn } from "../transcript.js";
import { createInertCodexConversationBinding } from "../runtimeStateUpgrade.js";
import { createCodexDriverConnection } from "./codexDriverConnection.js";
import { createCodexDriverTurns, goalValue } from "./codexDriverTurns.js";

/**
 * The mutable state of one open driver conversation, shared by its connection and its turns.
 * @typedef {object} CodexDriverSession
 * @property {object} binding
 * @property {Promise<void>} bindingWork
 * @property {object | undefined} native
 * @property {string | undefined} nativeProviderId
 * @property {object | undefined} current
 * @property {Promise<void> | undefined} stopping
 * @property {boolean} disposed
 * @property {object | undefined} preparedThreadSettings
 * @property {Error | undefined} observationError
 * @property {object | undefined} observationTarget
 */

const goalCapabilities = Object.freeze({ goals: true, goalBudgets: true,
  goalCommands: Object.freeze({
    set: Object.freeze({ delivery: "control", interruptsTurn: false }),
    resume: Object.freeze({ delivery: "control", interruptsTurn: false }),
    pause: Object.freeze({ delivery: "control", interruptsTurn: true }),
    cancel: Object.freeze({ delivery: "control", interruptsTurn: false })
  }) });

/**
 * The conversation connections an application authorizes models through.
 * @typedef {object} CodexConversationConnections
 * @property {(request: { context: object, integrationId: string }) => Promise<object>} resolve
 */

// input validation: the driver's own conversations run Codex in the application's environment.
function assertCodexApplicationEnvironment(host) {
  if (!host.env) throw new TypeError("createCodexConversationDriver requires the application's environment, such as process.env.");
}

// Refusals Codex conversations send from several places; each names its sentence.
function codexOutputTooLarge() {
  return Object.assign(new Error("Codex output exceeded the configured limit."), {
    messageCode: "assistant.codex.outputTooLarge", messageParams: {}
  });
}

function nativeGoalChanged() {
  return Object.assign(new Error("The native goal changed. Read it again before changing it."), {
    messageCode: "assistant.codex.nativeGoalChanged", messageParams: {}
  });
}

function beginShutdown({ native }) {
  return native.runOwner.beginShutdown();
}

/**
 * Conversations own threads and observers on the account's shared native runtime.
 * @param {object} dependencies
 * @param {CodexConversationConnections} [dependencies.connections]
 * @param {Record<string, any>} [dependencies.host] The application's host description. Its env, the application's
 *   environment such as process.env, is required by the driver's own conversations.
 * @param {object} [dependencies.limits]
 */
// readable-check: allow dependency-default - data: a runtime without host settings runs Codex in its working directory with local execution
export function createCodexConversationDriver({ connections, host = {}, limits = {} }) {
  // A host that opens its own conversations may pass no environment; the
  // driver's own conversations require it.
  const env = { ...host.env };
  const workdir = path.resolve(host.workdir || process.cwd());
  const configRoot = path.resolve(workdir, env.CODEX_HOME || path.join(env.HOME || homedir(), ".codex"));
  env.CODEX_HOME = configRoot;
  const command = host.commands?.codex || "codex";
  const execution = host.execution || createLocalConversationExecution();
  if (host.runtimeDirectory !== undefined && (typeof host.runtimeDirectory !== "string" || !path.isAbsolute(host.runtimeDirectory))) {
    throw new TypeError("The native runtime directory must be absolute.");
  }
  const nativeTools = host.nativeTools === true;
  const maximumOutput = limits.maxOutputCharacters ?? 64_000;
  const maximumFinalReply = limits.maxFinalReplyCharacters ?? maximumOutput;
  if (!Number.isSafeInteger(maximumFinalReply) || maximumFinalReply < 1) throw new TypeError("Invalid Codex final reply limit.");
  if (!Number.isSafeInteger(maximumOutput) || maximumOutput < 1) throw new TypeError("Invalid Codex output limit.");

  async function accountRecord() {
    let auth = {};
    let file;
    try {
      file = await openFile(path.join(configRoot, "auth.json"), "r");
      const bytes = Buffer.alloc(1024 * 1024 + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length === bytes.length) throw new Error("Credential data exceeded its size limit.");
      auth = JSON.parse(bytes.subarray(0, length).toString("utf8"));
      if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error("Invalid credential data.");
    } catch (error) {
      // Native keychain logins can have no auth file. Never expose malformed
      // credential contents in a parser's error message.
      if (error.code !== "ENOENT") throw Object.assign(new Error("Codex credential data could not be read. Restore its account configuration."), { messageCode: "assistant.codex.credentialsUnreadable", messageParams: {} });
    } finally { await file?.close(); }
    return auth;
  }

  async function accountIdentity(client, signal) {
    const { account } = await client.request("account/read", { refreshToken: false }, { signal });
    const auth = await accountRecord();
    if (account?.type === "chatgpt" && account.email) {
      // The native account ID distinguishes workspaces sharing the same email;
      // token refresh does not change this binding.
      return hash([configRoot, account.type, account.email.toLowerCase(), auth.tokens?.account_id || ""]);
    }
    const key = env.OPENAI_API_KEY || auth.OPENAI_API_KEY;
    if (account?.type === "apiKey" && typeof key === "string" && key) return hash([configRoot, account.type, key]);
    throw Object.assign(new Error("Sign in with codex login before using this conversation."), { messageCode: "assistant.codex.signInRequired", messageParams: {} });
  }

  async function nativeHost(selected) {
    // Managed applications supply their own execution and account scope. This
    // facility contains host policy; the provider and process algorithms stay here.
    if (host.codex) return host.codex({ providerId: selected.providerId });
    // readable-check: allow method-probe - input validation: the application's execution host must run native processes
    if (typeof execution.run !== "function") {
      throw new TypeError("The Codex execution host must support capture and detached native execution.");
    }
    const processExecution = { ...execution, run: request => execution.run({ ...request, limits: host.limits }) };
    const scope = hash([configRoot, selected.providerId, selected.accountIdentity || "", command, host.commandWrapper || null]).slice(0, 16);
    // readable-check: allow optional-call - platform object: process.getuid exists only on POSIX platforms
    const runtimeDir = path.join(host.runtimeDirectory || path.join(tmpdir(), `jskit-${process.getuid?.() ?? "user"}`),
      `codex-app-server-${scope}`);
    async function generation() {
      if (selected.accountIdentity) return selected.accountIdentity;
      const auth = await accountRecord();
      // Token refresh is not a new account. Native keychain accounts are also
      // checked through account/read before this conversation can send work.
      return hash([configRoot, auth.auth_mode, auth.tokens?.account_id || "", env.OPENAI_API_KEY || auth.OPENAI_API_KEY || ""]);
    }
    const credentials = {
      identity: generation,
      generation,
      async assertCurrent(captured) {
        if (captured && captured !== await generation()) throw Object.assign(new Error("Codex authentication changed. Reopen the conversation with its original account."), { messageCode: "assistant.codex.authChangedReopen", messageParams: {} });
      },
      markInvalid() {},
      reconnectRequiredCode: "codex_reconnect_required",
      reconnectError: () => Object.assign(new Error("Sign in with codex login before continuing."), { code: "codex_reconnect_required" }),
      observeFailure(output) { if (codexAuthOutputRequiresReconnect(output)) throw this.reconnectError(); }
    };
    const configuration = { commandHookCommand: host.commandWrapper ? codexCommandHookCommand(host.commandWrapper) : undefined };
    const parameters = { runtimeDir, codexCommand: command, env, workdir: "", terminalEnv: {},
      readyTimeoutMs: limits.admissionTimeoutMs || 30_000,
      compatibility: { attachmentHostRoot: "", executionContextHash: scope, runtimesHash: hash([command, configuration]) } };
    return { credentials, execution: processExecution, configuration, parameters,
      runtime: createCodexAppServerRuntime({ credentials, execution: processExecution, configuration }) };
  }

  // Storage work borrows the shared process; it is not a user that keeps it running.
  async function withNativeStorageProvider({ sessionId, native, binding, context }, operation) {
    const prepared = await native.preparation.storage(sessionId, binding, context);
    return native.providerOwner.withTransientSession(prepared.providerContext,
      provider => operation(provider, prepared.toolHomeSource));
  }

  async function disposeNative({ sessionId, namespace, native, options }) {
    if (options?.assistantScope) {
      if (options.assistantScope.id !== sessionId) throw new TypeError("Codex helper scope does not match.");
      const result = await native.providerOwner.stopCachedProvidersForSession(native.namespace || namespace, { requireStopped: true });
      return { ...result, closed: result.stopped };
    }
    return native.runOwner.closeSession(sessionId, native.preparation.cleanup(options));
  }

  function validateConfiguration(config) {
    validateConversationConfiguration(config, { engine: "Codex", connections, structuredOutput: true, maxOutputCharacters: maximumOutput });
  }

  function interruptDetachedConversation({ sessionId, native, input, context }) {
    return native.runOwner.interruptDetachedTurn(sessionId, input, context);
  }

  function deleteDetachedConversation({ sessionId, native, input, context }) {
    return native.runOwner.deleteDetachedThread(sessionId, input, context);
  }

  function listConversationStorage(prepared) {
    const { binding } = prepared;
    return withNativeStorageProvider(prepared, async provider =>
      (await provider.listNativeThreadsForCwd(binding.workdir)).map((conversationId) => ({ ...binding, conversationId })));
  }

  function retireConversationHistory(prepared) {
    return withNativeStorageProvider(prepared, (provider, toolHomeSource) =>
      retireCodexConversationHistory(provider, prepared.binding, {
        toolHomeSource, beforeDelete: prepared.context.beforeDelete, signal: prepared.context.signal,
        errorPrefix: prepared.native.errorPrefix
      }));
  }

  function invalidateRuntimes({ native, input }) {
    return native.runOwner.invalidateRuntimes(input, native.preparation);
  }

  function reconcileSessions({ native, sessions, options }) {
    return native.runOwner.reconcileSessions(sessions, options, native.preparation);
  }

  function unsubscribeSessions({ native, sessions }) {
    return native.runOwner.unsubscribeSessions(sessions, native.preparation);
  }

  async function closeProject({ native, input }) {
    const prepared = await native.preparation.projectCleanup();
    if (Object.hasOwn(prepared, "value")) return prepared.value;
    return native.runOwner.closeProject(input, prepared);
  }

  function inspectTemporaryActivity({ sessionId, native }) {
    return native.runOwner.hasActiveTemporaryConversation(sessionId);
  }

  function releaseRenewalPredecessorProcessExitProof({ native, context }) {
    const prepared = native.preparation.predecessor(context);
    return native.providerOwner.releasePreparedRuntimeProof(prepared);
  }

  function releaseRenewalSuccessorProcessExitProof({ native, context }) {
    const prepared = native.preparation.successor(context);
    return native.providerOwner.releasePreparedRuntimeProof(prepared);
  }

  async function generateRenewalHandover({ sessionId, native, input, context }) {
    const prepared = native.preparation.handover(input, context);
    const acquired = await native.runOwner.conversationContext(sessionId, input, prepared.context);
    if (acquired.ok === false) return acquired;
    const turn = await prepared.turn(acquired);
    const execution = await native.runOwner.runRenewalHandover(sessionId, turn.input, turn.context);
    return turn.completeResult(execution);
  }

  async function seedRenewalHandover({ sessionId, native, input, context }) {
    const prepared = native.preparation.seed(input, context);
    const acquired = await native.runOwner.conversationContext(sessionId, input, prepared.context);
    if (acquired.ok === false) return acquired;
    const turn = prepared.turn(acquired);
    const execution = await native.runOwner.runRenewalSeed(turn.input, turn.context);
    return turn.completeResult(execution);
  }

  async function ensureConversation({ sessionId, native }) {
    return native.runOwner.ensureSessionReadiness(sessionId, await native.preparation.readiness());
  }

  async function updateConversationSettings({ sessionId, native, context, input }) {
    // Changing a thread's settings is not a use that keeps Codex running.
    const borrow = { release() {} };
    try {
      const acquired = await native.runOwner.conversationContext(sessionId, { conversationId: input.threadId }, context, borrow);
      if (acquired.ok === false) return acquired;
      await acquired.provider.updateThreadSettings(input.threadId, { model: input.model, effort: input.effort });
      return { ok: true };
    } finally {
      borrow.release();
    }
  }

  /** @param {{ sessionId: string, native: { runOwner: import("../codexRuntimeLifecycle.js").CodexRunOwner }, input: object, context: object }} request */
  async function createConversation({ sessionId, native, input, context }) {
    return native.runOwner.createConversation(sessionId, input, context);
  }

  async function runDetachedConversation({ sessionId, native, input, options }) {
    return native.runOwner.runDetachedConversation(sessionId, input, options);
  }

  async function createBinding() {
    assertCodexApplicationEnvironment(host);
    return createInertCodexConversationBinding({ workdir: await realpath(workdir), configRoot });
  }

  async function open({ binding, writeBinding, onFailure: reportFailure, conversation }) {
    const supplied = conversation?.native;
    if (supplied?.scoped) {
      const { conversationId, context: openingContext } = supplied.scoped;
      const { runOwner: owner } = supplied;
      const sessionId = conversation.sessionId;
      // These are the run owner's scoped commands, including their native
      // start dedup, watcher/deadline and Stop/delete proof. No main journal
      // or additional command queue is introduced for this representation.
      return createScopedConversationHandle({ conversationId,
        sendNative: (input, context) => owner.startConversationTurn(sessionId, input, context),
        readNative: (input, context) => owner.readConversation(sessionId, input, context),
        waitNative: (input, context) => owner.waitForConversationTurn(sessionId, input, context),
        cancel: (input, context) => owner.stopConversation(sessionId, input, context),
        deleteConversation: (input, context) => owner.deleteConversation(sessionId, input, context),
        // Runtime shutdown retains the parent's cleanup receipt. Explicit
        // scoped deletion above owns native deletion and its proof.
        disposeOpening: () => disposeNative({ sessionId, namespace: conversation.namespace, native: supplied, options: openingContext })
      });
    }
    if (!supplied) assertCodexApplicationEnvironment(host);
    if (!supplied && (!binding || typeof binding.threadId !== "string" || binding.workdir !== await realpath(workdir) || binding.configRoot !== configRoot)) {
      throw Object.assign(new Error("This Codex conversation belongs to another working directory or credential home. Restore its original host configuration."), { messageCode: "assistant.codex.otherHostConfiguration", messageParams: {} });
    }
    const session = {
      binding,
      bindingWork: Promise.resolve(),
      native: undefined,
      nativeProviderId: undefined,
      current: undefined,
      stopping: undefined,
      disposed: false,
      preparedThreadSettings: undefined,
      observationError: undefined,
      observationTarget: undefined
    };
    const providerKey = "conversation";
    const providerOwner = supplied?.providerOwner || createCodexAppServerProviderOwner({
      onRecoveryEvent(_owner, event, error) {
        if (event === "stopFailed") session.current?.completion.reject(error);
      }
    });
    if (!conversation?.runtime?.store) throw new TypeError("Codex requires its bound conversation store.");
    const sessionId = conversation.sessionId;
    const nativeStore = conversation.runtime.store;
    const boundedWriter = name => (id, input) => {
      const limit = name === "writeConversationThinkingMessage" ? 4 * 1024 * 1024
        : name.includes("AssistantMessage") ? Math.min(maximumOutput, maximumFinalReply) : maximumOutput;
      const length = input.text?.length || 0;
      if (length <= limit) return nativeStore[name](id, input);
      if (!name.includes("AssistantMessage") || length > maximumOutput) throw codexOutputTooLarge();
      return nativeStore.mutateSession(id, async transaction => {
        const { runtime: state } = await transaction.readMetadata();
        const identity = input.nativeIdentity;
        const run = state.binding?.codexAppServerRun;
        if (identity?.threadId && identity.turnId && state.engine === "codex" &&
            state.binding.threadId === identity.threadId && run?.providerThreadId === identity.threadId &&
            run.providerTurnId === identity.turnId && run.outerTurnId) {
          for (const turnId of (await transaction.listTurnIds()).reverse()) {
            const turn = await transaction.readTurn(turnId);
            if (turn?.system?.messageId !== run.outerTurnId) continue;
            if (turn.system.origin === "application" && !turn.system.goal && isCompletedEnvelopeTurn(turn) &&
                turn.metadata.runtime.engine === "codex" && turn.metadata.runtime.segmentId === state.segmentId &&
                turn.metadata.runtime.nativeTurnId === identity.turnId) {
              return nativeStore[name](id, input);
            }
            break;
          }
        }
        throw codexOutputTooLarge();
      });
    };
    const runtime = supplied ? conversation.runtime : { ...conversation.runtime, store: { ...nativeStore,
      writeConversationAssistantMessage: boundedWriter("writeConversationAssistantMessage"),
      upsertConversationAssistantMessage: boundedWriter("upsertConversationAssistantMessage"),
      writeConversationCommentaryMessage: boundedWriter("writeConversationCommentaryMessage"),
      writeConversationThinkingMessage: boundedWriter("writeConversationThinkingMessage"),
      async updateConversationStream(id, input) {
        if ((input.delta?.length || input.text?.length || 0) > maximumOutput) throw codexOutputTooLarge();
        const stream = await nativeStore.updateConversationStream(id, input);
        if (stream?.messages.some(message => message.text.length > maximumOutput)) throw codexOutputTooLarge();
        return stream;
      },
      writeConversationUserMessage(id, input) {
        const pending = owner.pendingUserMessages.get(`${sessionId}\0${input.messageId}`);
        return conversation.runtime.store.writeConversationUserMessage(id, {
          ...input, authoredRequest: pending?.authoredInput
        });
      }
    } };
    const owner = supplied?.runOwner || createCodexAppServerRunOwner({
      persistCommentary: conversation.persistCommentary,
      finalizingGraceMs: limits.codexFinalizingGraceMs,
      finalizingGraceAfterHistoryRead: limits.codexFinalizingGraceAfterHistoryRead,
      failureDetailGraceMs: limits.codexFailureDetailGraceMs,
      createRuntime: async () => runtime,
      createStore: async () => runtime.store,
      acquireProvider: async () => session.native,
      hasRuntime: () => Boolean(session.binding.threadId),
      publish: (_id, event) => publishNative(event),
      checkpoint: (_id, input) => conversation.checkpoint({ ...input,
        status: input.turnOutcome === "response_delivery_failure" ? "failed" : input.status }),
      async onNotificationSignal(kind, { threadId, turnId, provider, error }) {
        const active = session.current;
        if (kind !== "provider_error" || !active?.dispatched || active.finished || provider !== session.native ||
            threadId !== session.binding.threadId || !turnId || active.turnId && active.turnId !== turnId) return;
        const tracked = codexAppServerTurnState(await runtime.getSession(sessionId));
        if (tracked.threadId !== threadId || tracked.turnId !== turnId) return;
        // Recovery covers only this admitted turn and keeps native activity
        // truthful; the run's own cleanup owns Stop.
        await owner.recoverActiveTurn(sessionId, { provider, retryOnError: false, providerError: { threadId, turnId, error } });
        if (session.current !== active || active.finished || active.turnId !== turnId ||
            provider !== session.native || threadId !== session.binding.threadId) return;
        const result = await owner.stopTurnWithProviderFailure(sessionId, threadId, turnId, { provider, error, failureDetailReady: true });
        if (session.current === active && active.turnId === turnId && provider === session.native &&
            threadId === session.binding.threadId && result.reason === "provider_still_active") {
          // readable-check: allow no-patched-error - data: status is the turn outcome the conversation reports, not an HTTP status
          active.completion.reject(Object.assign(new Error(error), { status: "failed" }));
        }
      }
    });
    // Retain this queue's exact opening namespace, never its admission grant.
    const drainNotifications = owner.notificationQueue.captureDrain(sessionId);
    async function publishNative(event) {
      if (supplied) session.binding.threadId = await conversation.identity.read();
      await conversation.publish(event);
      if (event.nativeGoal?.threadId === session.binding.threadId) {
        await recordGoal(event.nativeGoal.goal);
      }
      const turn = event.payload?.agentSession?.turn;
      if (!turn || !session.current?.dispatched) return;
      if (turn.active && session.current.finished && session.current.finishIfCurrent) {
        // The run owner may start the next turn during Send.
        // Its publication replaces only this adapter's settled waiter.
        session.current.completion = Promise.withResolvers();
        session.current.completion.promise.catch(() => {});
        session.current.finished = false;
      }
      if (turn.id && turn.id !== session.current.turnId) {
        const previous = session.current.turnId;
        session.current.turnId = turn.id;
        if (session.current.admitted) {
          if (previous) await session.current.onNativeTurn({ turnId: turn.id, nativeOwner: true });
        } else session.current.pendingNativeTurn = turn.id;
      }
      if (!turn.active && event.reason === "codex-app-server-turn-idle") {
        session.current.finished = true;
        if ((["failed", "interrupted"].includes(turn.status) || !supplied && turn.error) && !session.current.signal.aborted) {
          // readable-check: allow no-patched-error - data: status is the turn outcome the conversation reports, not an HTTP status
          session.current.completion.reject(Object.assign(new Error(turn.error || `Codex turn ${turn.status}.`), {
            status: turn.status === "completed" ? "failed" : turn.status }));
        } else session.current.completion.resolve();
      }
    }
    const savedTurn = codexAppServerTurnState({ agentRuns: session.binding.codexAppServerRun ? [session.binding.codexAppServerRun] : [] });
    session.observationError = session.binding.observationLoss && (!session.binding.observationLoss.stopped ||
      savedTurn.active && savedTurn.status === "observation_lost")
      ? Object.assign(new Error(session.binding.observationLoss.message), { cleanupFailed: true }) : null;
    if (session.observationError) await reportFailure(session.observationError);
    function updateBinding(patch) {
      const work = session.bindingWork.then(async () => {
        const next = { ...session.binding, ...patch };
        await writeBinding(next);
        session.binding = next;
      });
      session.bindingWork = work.catch(() => {});
      return work;
    }
    async function recordGoal(goal) {
      if (supplied) session.binding.goal = goal;
      else await updateBinding({ goal });
      if (session.current?.admitted) await session.current.onEvent({ type: "goal", goal: goalValue(goal) });
      else if (session.current) session.current.pendingGoal = goal;
      else await conversation.publish({ payload: { goal: goalValue(goal) }, reason: "codex-goal" });
      return goal;
    }

    const connection = createCodexDriverConnection({
      session, supplied, sessionId, providerKey, providerOwner, owner, runtime, reportFailure, updateBinding, recordGoal,
      accountIdentity, connections, env, host, limits, nativeHost, nativeTools
    });
    const { stop, selection, connect } = connection;
    const { goalContext, interrupt, run } = createCodexDriverTurns({
      session, supplied, conversation, sessionId, providerKey, providerOwner, owner, runtime, updateBinding, drainNotifications,
      connection
    });

    return Object.freeze({
      publishNative,
      async readGoal({ configuration, context }) {
        if (supplied) {
          const target = await supplied.readGoalContext(context);
          const result = target.ok === false ? { status: "unavailable", goal: null }
            : await providerOwner.readSessionGoal(conversation.namespace, target.threadId);
          session.binding.threadId = target.threadId || "";
          session.binding.goal = result.goal || null;
          if (target.completeResult) await target.completeResult(result, {
            segmentId: target.threadId ? `codex:${target.threadId}` : null, capabilities: goalCapabilities
          });
          return { goal: goalValue(result.goal), nativeResult: result };
        }
        if (!session.binding.threadId) return null;
        const signal = AbortSignal.timeout(30_000);
        await connect(signal, await selection(configuration, context, signal));
        const { goal } = await session.native.readGoal(session.binding.threadId, { signal });
        await recordGoal(goal || null);
        return goalValue(goal);
      },
      async updateGoal({ configuration, context, input, tools, representation }) {
        if (supplied) {
          const invalid = owner.validateGoalInput(input);
          if (invalid) return { goal: goalValue(session.binding.goal), nativeResult: invalid };
          const admission = supplied.admission();
          if (admission.ok === false) return { goal: goalValue(session.binding.goal), nativeResult: admission };
          let nativeContext;
          let result;
          try {
            nativeContext = await goalContext(configuration, context);
            let command = input;
            if (representation !== "native") {
              session.binding.threadId = nativeContext.threadId;
              const goal = session.binding.goal || null;
              if ((goalValue(goal)?.id || null) !== (input.expectedGoalId || null)) throw nativeGoalChanged();
              command = { ...input, threadId: session.binding.threadId,
                createdAt: goal?.createdAt, objective: input.action === "set" ? input.objective : goal?.objective };
            }
            result = await owner.updateGoal(sessionId, command, {
              context: nativeContext, signal: context?.signal, prepareConversation: () => goalContext(configuration, context, undefined, { prepareThread: true })
            });
            if (result.ok !== false) session.binding.goal = result.goal || null;
          } finally { admission.release(); }
          if (result.ok !== false && input.action === "pause") {
            // Pause keeps the goal and uses the verified Stop owner
            // to stop its current conversation turn as well as scheduling.
            const stopped = await interrupt({ configuration, context });
            if (stopped?.ok === false) throw Object.assign(new Error(stopped.error), stopped, { cleanupFailed: true });
          }
          if (nativeContext.completeResult) await nativeContext.completeResult(result);
          return { goal: goalValue(result.goal), nativeResult: result };
        }
        if (session.binding.goalRequest) throw Object.assign(new Error("A goal command from an earlier runtime has unresolved delivery. Inspect its saved state before changing the goal."), {
          code: "conversation_delivery_uncertain"
        });
        const signal = AbortSignal.timeout(30_000);
        const nativeContext = await goalContext(configuration, context, signal, {
          prepareThread: Boolean(session.binding.threadId && ["set", "resume"].includes(input.action)), tools
        });
        const goal = session.binding.threadId ? (await session.native.readGoal(session.binding.threadId, { signal })).goal : null;
        if ((goalValue(goal)?.id || null) !== (input.expectedGoalId || null)) throw nativeGoalChanged();
        const result = await owner.updateGoal(sessionId, { ...input, threadId: session.binding.threadId,
          createdAt: goal?.createdAt, objective: input.action === "set" ? input.objective : goal?.objective }, {
          context: nativeContext, signal: context?.signal,
          prepareConversation: () => goalContext(configuration, context, signal, { prepareThread: true, tools })
        });
        if (result.ok === false) throw new Error(result.error);
        if (input.action === "pause") await interrupt({ configuration, context });
        return goalValue(result.goal);
      },
      async inspectAdmission({ messageId, threadId, nativeTurnId, configuration, context, goal: command, representation, verifyAccount = false, receiptBinding }) {
        if (supplied) {
          const prepared = await supplied.inspectionPreparation({ messageId, threadId }, context);
          if (prepared.ok === false) return representation === "native" ? prepared : { accepted: false, ...prepared };
          const target = await owner.conversationContext(sessionId, {}, prepared);
          if (target.ok === false) return representation === "native" ? target : { accepted: false, ...target };
          const receipt = await inspectCodexAppServerMessageAdmission({ provider: target.provider, threadId, messageId });
          return representation === "native" ? receipt : { ...receipt, accepted: receipt.admission === "accepted" };
        }
        if (command || session.binding.goalReceipt?.messageId === messageId || session.binding.goalRequest?.messageId === messageId) {
          // Old goal-message records stay inspection-only. Native goal state
          // cannot certify the authored delivery invented by that adapter.
          return { accepted: false, recoveryLimitation: "This older goal-message record requires offline inspection. Its saved history and delivery evidence were preserved." };
        }
        if (verifyAccount === true && (!receiptBinding || threadId !== session.binding.threadId || receiptBinding.threadId !== session.binding.threadId ||
            receiptBinding.workdir !== session.binding.workdir || receiptBinding.configRoot !== session.binding.configRoot)) {
          throw new Error("The completed Codex response belongs to a different native conversation or host scope.");
        }
        if (!session.binding.threadId) return { accepted: false };
        const signal = AbortSignal.timeout(30_000);
        await connect(signal, await selection(configuration, context, signal, verifyAccount === true, receiptBinding));
        let acceptedTurn;
        let cursor;
        do {
          const page = await session.native.client.request("thread/turns/list", { threadId: session.binding.threadId,
            limit: 100, sortDirection: "desc", itemsView: "full", ...(cursor ? { cursor } : {}) }, { signal });
          acceptedTurn = page.data.find(turn => (!nativeTurnId || turn.id === nativeTurnId) &&
            turn.items?.some(item => item.type === "userMessage" && item.clientId === messageId));
          cursor = page.nextCursor;
        } while (!acceptedTurn && cursor);
        if (!acceptedTurn) return { accepted: false };
        const stored = await runtime.getSession(sessionId);
        const tracked = codexAppServerTurnState(stored);
        const before = await runtime.store.readConversationLog(sessionId);
        const request = JSON.parse(await runtime.store.readMetadataValue(sessionId, "assistant_delivery")).engines.codex.pending;
        if (request?.messageId === messageId) await owner.writeDeliveredUserMessage(runtime, sessionId,
          request.displayMessage, messageId, request.turnMetadata, request.displayAttachments,
          { threadId: session.binding.threadId, turnId: acceptedTurn?.id || "" }, request.data);
        let recoveryLimitation;
        if (!stored.agentRuns.length) {
          recoveryLimitation = "Delivery is confirmed, but this older binding has no original native run record. Stored history is preserved; output recovery cannot be proven.";
        } else if (tracked.threadId !== session.binding.threadId || acceptedTurn && tracked.turnId !== acceptedTurn.id && tracked.outerTurnId !== messageId) {
          recoveryLimitation = "Delivery is confirmed. The original native owner tracks a different turn, so this inspection preserves stored history without reconstructing unowned output.";
        } else {
          owner.subscribeEvents(sessionId, session.native, session.binding.threadId, { providerKey });
          await owner.reconcileThreadStatus(sessionId, session.native, session.binding.threadId, {
            source: "delivery_inspection", requireTrackedTurn: true, observeLatestTurn: true
          });
          if (tracked.turnId) {
            const recovered = await owner.submitAssistantResult(sessionId, session.binding.threadId, tracked.turnId, { recoverFromProvider: true });
            if (recovered.reason === "error") throw new Error(recovered.error);
          }
          await owner.notificationQueue.drain(sessionId);
        }
        const after = await runtime.store.readConversationLog(sessionId);
        const row = after.find(turn => (turn.user || turn.system)?.messageId === messageId);
        const latest = codexAppServerTurnState(await runtime.getSession(sessionId));
        return { accepted: true, conversationTurn: row, recovered: JSON.stringify(before) !== JSON.stringify(after),
          nativeTurnId: acceptedTurn?.id || latest.turnId, status: latest.active ? "interrupted" : latest.status,
          ...(recoveryLimitation ? { recoveryLimitation } : {}) };
      },
      steer(command) {
        if (!session.current || session.current.finished && !session.current.finishIfCurrent) throw new Error("Codex has no active turn to steer.");
        return session.current.steer(command);
      },
      run,
      cancel: interrupt,
      async dispose(options) {
        if (supplied) {
          try {
            const result = await disposeNative({ sessionId, namespace: conversation.namespace, native: supplied, options });
            if (result?.ok === false) throw Object.assign(new Error(result.error), result);
            session.disposed = true;
            // readable-check: allow no-patched-error - data: status is the turn outcome the conversation reports, not an HTTP status
            session.current?.completion.reject(Object.assign(new Error("This conversation handle is closed."), { status: "interrupted" }));
            return result;
          } catch (error) {
            error.cleanupFailed = true;
            session.current?.completion.reject(error);
            throw error;
          }
        }
        await stop();
        owner.clearSessionRecoveryTimers(sessionId);
        for (const key of owner.eventSubscriptions.keys()) owner.unsubscribeEventSubscription(key);
        await owner.notificationQueue.drain(sessionId);
        await providerOwner.stopCachedProvider(providerKey, { preserveProcessExitProof: true, requireStopped: true });
        session.disposed = true;
      }
    });
  }

  return Object.freeze({
    // Codex fixes dynamic tool definitions when the thread is created. The three
    // discovery entry points stay stable while the authorized action set changes.
    toolDiscovery: true,
    canonicalTranscript: true,
    unsavedToolsRefusal: "Codex saves every tool call and its result in its own thread history, where the app cannot remove them.",
    attachmentTypes: ["text", "image", "localFile"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, history: true,
      instructions: true, configuration: true, steering: true, ...goalCapabilities,
      attachments: true, tools: true, nativeTools, structuredOutput: true }),
    validateConfiguration,
    disposeNative,
    interruptDetachedConversation,
    deleteDetachedConversation,
    listConversationStorage,
    retireConversationHistory,
    beginShutdown,
    invalidateRuntimes,
    reconcileSessions,
    unsubscribeSessions,
    closeProject,
    inspectTemporaryActivity,
    releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof,
    generateRenewalHandover,
    seedRenewalHandover,
    ensureConversation,
    updateConversationSettings,
    createConversation,
    runDetachedConversation,
    createBinding,
    open
  });
}
