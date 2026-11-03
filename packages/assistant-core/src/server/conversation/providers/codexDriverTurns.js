import { codexAppServerFrozenTurnInterruptResponse } from "../codexTurn.js";
import { assertCodexApplicationToolSchemaIdentity, codexApplicationToolConfiguration } from "../codexProviderThreads.js";
import { codexLocalImageInput } from "../codexProviderTurns.js";
import { jsonHash as hash } from "../normalize.js";

/** The goal a conversation reports, from Codex's native goal. */
export const goalValue = goal => goal ? {
  id: hash([goal.threadId, goal.createdAt, goal.objective]), objective: goal.objective, status: goal.status,
  tokenBudget: goal.tokenBudget ?? null, tokensUsed: goal.tokensUsed, timeUsedSeconds: goal.timeUsedSeconds,
  ...(Number.isFinite(goal.createdAt) ? { createdAt: new Date(goal.createdAt * 1000).toISOString() } : {}),
  ...(Number.isFinite(goal.updatedAt) ? { updatedAt: new Date(goal.updatedAt * 1000).toISOString() } : {})
} : null;

const nativeInput = input => [
  ...(input.text || input.attachmentManifest ? [{ type: "text", text: `${input.text || ""}${input.attachmentManifest || ""}` }] : []),
  ...(input.content || []).map(part => part.type === "text" ? part :
    { type: "image", url: `data:${part.mediaType};base64,${part.image.toString("base64")}` }),
  ...codexLocalImageInput(input.localFiles)
];

/**
 * The turns of one driver conversation: message delivery, goal context, interruption and the run of a turn. It
 * reads and updates the conversation's session record and uses its native connection.
 * @param {object} dependencies
 * @param {import("./codexDriver.js").CodexDriverSession} dependencies.session
 * @param {object | undefined} dependencies.supplied
 * @param {object} dependencies.conversation
 * @param {string} dependencies.sessionId
 * @param {string} dependencies.providerKey
 * @param {ReturnType<typeof import("../codexProviderOwner.js").createCodexAppServerProviderOwner>} dependencies.providerOwner
 * @param {ReturnType<typeof import("../codexTurn.js").createCodexAppServerRunOwner>} dependencies.owner
 * @param {object} dependencies.runtime
 * @param {(update: (binding: object) => object) => Promise<void>} dependencies.updateBinding
 * @param {() => Promise<void>} dependencies.drainNotifications
 * @param {ReturnType<typeof import("./codexDriverConnection.js").createCodexDriverConnection>} dependencies.connection
 */
export function createCodexDriverTurns({
  session,
  supplied,
  conversation,
  sessionId,
  providerKey,
  providerOwner,
  owner,
  runtime,
  updateBinding,
  drainNotifications,
  connection
}) {
  const { stop, selection, connect, prepareConfiguration, prepare } = connection;

  function deliveryInput(input, beforeDispatch, rejected) {
    if (supplied) return { ...input.nativeMessage,
      onPromptSending: beforeDispatch,
      onPromptRejected: async () => { await input.nativeMessage.onPromptRejected?.(); await rejected?.(); } };
    return { messageId: input.messageId, message: input.text,
      displayMessage: input.authoredInput?.text ?? input.text,
      displayAttachments: input.attachments, attachments: input.localFiles,
      onPromptSending: value => beforeDispatch({ threadId: value.threadId }), onPromptRejected: rejected };
  }

  async function deliveredRow(input, nativeIdentity) {
    const written = await owner.writeDeliveredUserMessage(runtime, sessionId,
      input.authoredInput?.text ?? input.text, input.messageId, null, input.attachments,
      nativeIdentity);
    if (written) return written;
    const saved = (await runtime.store.readConversationLog(sessionId)).find(turn =>
      (turn.user || turn.system)?.messageId === input.messageId);
    if (!saved) throw new Error("The accepted native receipt has no authored conversation message.");
    return saved;
  }

  async function withDelivery(command, operation) {
    const input = command.input;
    return owner.withMessageDelivery(sessionId, input.messageId, {
      attachments: input.attachments, text: input.authoredInput?.text ?? input.text,
      turnMetadata: input.nativeMessage?.turnMetadata || null, actorContext: input.nativeMessage?.actorContext || null,
      authoredInput: input.authoredInput,
      onNativeReceipt: command.onNativeReceipt,
      onReceiptPersisted: command.onReceiptPersisted
    }, operation);
  }

  function messagePreparation(configuration, context, signal, tools) {
    if (supplied) return tools ? { ...supplied.messagePreparation, applicationTools: tools,
      providerReady: session.current.providerReady } : supplied.messagePreparation;
    return {
      async readContext() {
        const runtimeSession = await runtime.getSession(sessionId);
        return { runtime, session: runtimeSession, selection: {
          runtime, session: runtimeSession, threadId: () => session.binding.threadId,
          async acquireProvider() {
            const reused = Boolean(session.native?.isAvailable());
            await connect(signal, await selection(configuration, context, signal));
            return { provider: session.native, reused };
          }
        } };
      },
      threadPreparation() {
        return {
          get failureThreadId() { return session.binding.threadId; },
          async provider() {
            const { selected, params, toolSchemaIdentity } = await prepareConfiguration(configuration, context, signal, tools);
            const retainedThreadId = session.binding.threadId;
            return {
              provider: session.native,
              workdir: session.binding.workdir,
              observerOptions: { providerKey },
              requirePaginatedHistory: !retainedThreadId,
              settings: { ...selected, resumeOptions: params },
              preparation: {
                settings: async () => ({ threadSettings: params, threadStartSettings: params }),
                identity: { read: () => retainedThreadId,
                  async write({ threadId }) { await updateBinding({ threadId, toolSchemaIdentity }); } }
              }
            };
          }
        };
      },
      async prepareMessage(input, prepared, { starting }) {
        if (!starting) return null;
        const { settings } = prepared;
        return { renderedPrompt: input.message,
          get turnSettings() { return { cwd: session.binding.workdir,
            ...(settings.model ? { model: settings.model } : {}), effort: configuration.effort || null,
            ...(configuration.outputSchema ? { outputSchema: configuration.outputSchema } : {}) }; }
        };
      },
      async finishMessage(input, prepared, outcome) {
        if (Object.hasOwn(outcome, "error")) throw outcome.error;
      }
    };
  }

  async function acceptMessage(command, nativeIdentity, row, nativeResult) {
    if (typeof nativeIdentity?.threadId !== "string" || !nativeIdentity.threadId.trim() ||
        typeof nativeIdentity?.turnId !== "string" || !nativeIdentity.turnId.trim()) {
      throw Object.assign(new Error("The native delivery has no exact turn identity. Inspect this message's receipt before continuing."), {
        code: "conversation_delivery_uncertain", delivery: "uncertain"
      });
    }
    const { turnId } = nativeIdentity;
    const active = session.current;
    if (!active) throw new Error("The native delivery lost its active conversation owner.");
    active.inputId = command.input.messageId;
    if (!active.turnId) active.turnId = turnId;
    await command.accept({ nativeTurnId: turnId, conversationTurn: row || await deliveredRow(command.input, nativeIdentity),
      ...(supplied ? { nativeResult } : {}) });
    active.admitted = true;
    active.admission.resolve();
    if (active.pendingGoal !== undefined) {
      const goal = active.pendingGoal;
      delete active.pendingGoal;
      await active.onEvent({ type: "goal", goal: goalValue(goal) });
    }
    if (active.pendingNativeTurn) {
      const next = active.pendingNativeTurn;
      delete active.pendingNativeTurn;
      await active.onNativeTurn({ turnId: next, nativeOwner: true });
    }
  }

  async function sendMessage(command, configuration, context, signal, tools) {
    return withDelivery(command, async () => {
      let attempted = false;
      let rejected = false;
      let accepted = false;
      const input = deliveryInput(command.input, async value => {
        await command.beforeDispatch(value);
        signal.throwIfAborted();
        attempted = true;
        session.current.dispatched = true;
      }, () => { rejected = true; });
      try {
        const delivered = await owner.dispatchMessage(sessionId, input, {
          ...(supplied ? { ...context, actorContext: input.actorContext || null } : { preparedInput: nativeInput(command.input) })
        }, messagePreparation(configuration, context, signal, tools));
        const { value, nativeIdentity } = delivered;
        if (supplied ? value.delivered === true : value.delivered || nativeIdentity) {
          await acceptMessage(command, nativeIdentity || { threadId: value.threadId, turnId: value.turnId }, value.conversationTurn, delivered);
          accepted = true;
          if (value.ok === false) throw new Error(value.error);
          return delivered;
        }
        // The original main sender retains its pending evidence when the
        // command returns delivered:false, even if a native ID is known.
        if (supplied) return delivered;
        throw Object.assign(new Error(value?.error || "Codex is not ready to receive this instruction."), value);
      } catch (error) {
        if (attempted && !accepted && !rejected && error.delivery !== "not-sent" && !Number.isInteger(error.code)) error.delivery = "uncertain";
        throw error;
      }
    });
  }

  async function goalContext(configuration, context, signal, { prepareThread = false, tools } = {}) {
    if (supplied) return owner.prepareGoalContext(sessionId, context, supplied.goalPreparation, { prepareThread });
    let selected;
    if (prepareThread && !session.binding.threadId) selected = await prepare(configuration, context, signal, tools);
    else if (prepareThread) {
      const prepared = await prepareConfiguration(configuration, context, signal, tools);
      selected = { ...prepared.selected, resumeOptions: prepared.params };
    } else {
      selected = await selection(configuration, context, signal);
      await connect(signal, selected);
    }
    return { runtime, session: await runtime.getSession(sessionId), provider: session.native,
      threadId: session.binding.threadId, providerKey, resumeOptions: selected.resumeOptions };
  }

  async function interrupt({ configuration, context, input = {}, representation } = {}) {
    if (supplied) {
      const admission = supplied.admission();
      if (admission.ok === false) {
        const value = codexAppServerFrozenTurnInterruptResponse({
          threadId: input.threadId || input.codexSessionId, turnId: input.turnId || input.codexTurnId
        });
        return representation === "native" ? { value } : value;
      }
      try {
        const prepared = await supplied.controlPreparation(context, input);
        if (prepared.ok === false) {
          if (representation === "native") return { value: prepared };
          throw Object.assign(new Error(prepared.error), prepared, { cleanupFailed: true });
        }
        const result = await owner.interruptTurn(sessionId, input, owner.controlContext(sessionId, prepared));
        if (representation === "native") return result;
        if (result.value?.ok === false) throw Object.assign(new Error(result.value.error), result.value, { cleanupFailed: true });
        return result.value;
      } finally { admission.release(); }
    }
    if (session.observationError) {
      await stop();
      return { ok: true, interrupted: true };
    }
    const result = await owner.interruptTurn(sessionId, {}, {
      runtime, admissionError: () => null, threadId: () => session.binding.threadId,
      observationOwner: () => session.native,
      async acquireProvider() {
        if (!session.native && configuration) {
          const signal = AbortSignal.timeout(30_000);
          await connect(signal, await selection(configuration, context, signal));
        }
        if (!session.native) throw new Error("Codex's retained runtime owner is unavailable.");
        await session.native.ensureAvailable();
        return session.native;
      }
    }).catch(error => {
      // A thrown control error also leaves this native owner unconfirmed.
      if (error === session.current?.toolFailure && !session.current.signal.aborted && !error.cleanupFailed) {
        session.current.toolFailureCleanup = error;
      }
      error.cleanupFailed = true;
      throw error;
    });
    if (result.value?.ok === false) throw Object.assign(new Error(result.value.error || "Codex could not confirm that work stopped."), { cleanupFailed: true });
    return result.value;
  }

  async function run({ configuration, context, input, tools, signal, beforeDispatch, accept, onNativeReceipt, onReceiptPersisted,
    onEvent, onNativeTurn, finishIfCurrent }) {
    if (session.disposed || session.current) throw new Error("This Codex conversation is closed or already working.");
    const completion = Promise.withResolvers();
    const admission = Promise.withResolvers();
    completion.promise.catch(() => {});
    admission.promise.catch(() => {});
    if (input.goal) throw new Error("Codex goals are controls. Inspect any unresolved goal-message record before continuing.");
    const active = session.current = { configuration, context, inputId: input.messageId,
      onEvent, onNativeTurn, signal, completion, admission, inputReady: admission.promise, finishIfCurrent,
      admitted: false, dispatched: false, turnId: "" };
    let cancellation;
    let toolFailureRecovery;
    let problem;
    let delivered;
    let waitForTurn = false;
    let executingProvider;
    const toolCalls = new Set();
    const toolRegistrations = new Map();
    // This run still owns the original native provider's current turn.
    const ownsTurn = (provider, threadId, turnId) => session.current === active && !session.disposed && !signal.aborted &&
      Boolean(provider) && provider === executingProvider && provider === session.native &&
      threadId === session.binding.threadId && turnId === active.turnId;
    function toolHandler(provider, threadId, isRegistered = () => true) {
      return async ({ method, params }) => {
        if (method !== "item/tool/call" || !tools || params?.threadId !== (threadId || session.binding.threadId) || params.namespace ||
            supplied && (session.disposed || session.current !== active || active.finished || signal.aborted || owner.runtimeLifecycle?.closing === true || !isRegistered())) {
          throw new Error("This conversation does not authorize that native tool request.");
        }
        let owned = !supplied;
        const operation = (async () => {
          await active.inputReady;
          if (supplied && owner.runtimeLifecycle?.closing === true) {
            throw new Error("This conversation does not authorize that native tool request.");
          }
          const ownership = Promise.withResolvers();
          owner.notificationQueue.run({ sessionId, provider }, () => {
            if (supplied && (params.turnId !== active.turnId || session.disposed || session.current !== active || active.finished ||
                signal.aborted || !isRegistered())) {
              ownership.resolve(false);
              return;
            }
            owned = true;
            const failure = provider.observationFailure;
            if (failure) ownership.reject(failure.cause || failure);
            else ownership.resolve(params.turnId === active.turnId);
          });
          if (!await ownership.promise || supplied && (session.disposed || session.current !== active || active.finished || signal.aborted || !isRegistered())) {
            owned = false;
            throw new Error("This application tool call belongs to another turn.");
          }
          let result;
          try {
            result = await tools.execute({ id: params.callId, name: params.tool, arguments: JSON.stringify(params.arguments) });
          } catch (error) {
            if (!supplied && owned && ownsTurn(provider, params.threadId, params.turnId)) active.toolFailure ||= error;
            throw error;
          }
          return { success: result.ok, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] };
        })();
        toolCalls.add(operation);
        try { return await operation; }
        catch (error) {
          if (!supplied || owned && session.current === active && params.turnId === active.turnId && isRegistered()) {
            if (supplied) active.toolFailure = error;
            active.completion.reject(error);
          }
          throw error;
        }
        finally { toolCalls.delete(operation); }
      };
    }
    active.providerReady = async ({ provider, threadId }) => {
      signal.throwIfAborted();
      if (!threadId) return;
      if (typeof conversation.identity?.readToolSchemaIdentity !== "function") {
        throw new TypeError("Bound Codex application tools require the original schema identity reader and writer.");
      }
      if (await conversation.identity.read() !== threadId) throw new Error("The native application tool thread changed before dispatch.");
      assertCodexApplicationToolSchemaIdentity(threadId, await conversation.identity.readToolSchemaIdentity(),
        codexApplicationToolConfiguration(tools).toolSchemaIdentity);
      signal.throwIfAborted();
      if (session.disposed || session.current !== active) throw new Error("This conversation handle is closed.");
      for (const [previous, owned] of toolRegistrations) {
        if (previous === provider && owned.threadId === threadId && owned.client === provider.client && owned.registration.isCurrent()) return;
        owned.registration.release();
        toolRegistrations.delete(previous);
      }
      const client = provider.client;
      let registration;
      registration = provider.registerThreadRequestHandler(threadId, toolHandler(provider, threadId,
        () => registration?.isCurrent() === true && provider.client === client));
      toolRegistrations.set(provider, { threadId, client, registration });
    };
    function abort() {
      if (cancellation) return;
      cancellation = interrupt();
      cancellation.then(() => active.completion.reject(signal.reason), error => active.completion.reject(error));
    }
    async function submit(command, operation) {
      await admission.promise;
      const ready = Promise.withResolvers();
      const previous = active.inputReady;
      active.inputReady = ready.promise;
      try { return await operation(command, configuration, context, signal, tools); }
      finally { ready.resolve(); active.inputReady = previous; }
    }
    active.steer = command => submit(command, sendMessage);
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      // Preparation retains the provider's authenticated account and the
      // stable application-tool entry points. The original owner alone
      // subscribes to notifications and handles native turn state/output.
      if (!supplied) {
        const selected = await selection(configuration, context, signal);
        await connect(signal, selected);
        executingProvider = session.native;
      }
      if (!supplied) session.native.setServerRequestHandler(toolHandler(executingProvider));
      const command = { input, beforeDispatch, accept, onNativeReceipt, onReceiptPersisted };
      delivered = await sendMessage(command, configuration, context, signal, tools);
      waitForTurn = !supplied || delivered.value?.delivered === true;
      if (!finishIfCurrent && waitForTurn) {
        await completion.promise;
        await drainNotifications();
      }
    } catch (error) { problem = error; }
    if (finishIfCurrent) {
      try {
        for (;;) {
          const settling = active.completion;
          if (waitForTurn) {
            try { await settling.promise; }
            catch (error) { problem = error; }
          }
          if (await finishIfCurrent(() => active.completion === settling)) break;
          // The same original dispatch established another native turn.
          // Keep its completion and Stop owner until that turn settles.
          problem = undefined;
          waitForTurn = true;
        }
        if (!problem && waitForTurn) await drainNotifications();
      } catch (error) { problem = error; }
    }
    signal.removeEventListener("abort", abort);
    admission.reject(problem || signal.reason);
    const failureThreadId = session.binding.threadId;
    const failureTurnId = active.turnId;
    try {
      // Account invalidation already owns this stop attempt. Its failed
      // proof stays available for explicit cleanup through the same owner.
      if ((!supplied && problem || supplied && active.toolFailure || signal.aborted) && problem?.code !== "codex_runtime_invalidated") {
        await (cancellation || interrupt());
      }
    } catch (error) {
      problem = error;
      // A direct Stop checkpoint can throw before its native completion
      // reaches the queue. Keep the same admitted tool failure with the
      // original observation-stop owner until its pending recovery joins.
      if (!supplied && error === active.toolFailure && ownsTurn(executingProvider, failureThreadId, failureTurnId) &&
          error.code !== "codex_runtime_invalidated") {
        toolFailureRecovery = executingProvider.failObservation(error);
      }
    }
    try {
      await drainNotifications();
      // The original queue starts observation recovery without awaiting
      // it. Join only this provider's existing attempt before settling.
      if (!supplied) await providerOwner.pendingRecovery(providerKey, executingProvider);
      if (toolFailureRecovery) {
        await toolFailureRecovery;
        if (problem === active.toolFailureCleanup && ownsTurn(executingProvider, failureThreadId, failureTurnId) &&
            !session.observationError && session.binding.observationLoss?.stopped === true) delete problem.cleanupFailed;
      }
    } catch (error) { problem = error; }
    finally {
      for (const owned of toolRegistrations.values()) owned.registration.release();
      toolRegistrations.clear();
      await Promise.allSettled([...toolCalls]);
      if (!supplied) {
        session.native?.setServerRequestHandler(null);
        owner.clearSessionRecoveryTimers(sessionId);
      }
      session.current = null;
    }
    if (problem) throw problem;
    return delivered;
  }

  return Object.freeze({
    sendMessage,
    goalContext,
    interrupt,
    run
  });
}
