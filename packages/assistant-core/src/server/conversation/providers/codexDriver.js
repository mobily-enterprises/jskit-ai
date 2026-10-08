import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { open, realpath } from "node:fs/promises";
import { createCodexAppServerRuntime } from "../codexProcess.js";
import { CodexAppServerAgentProvider, codexLocalImageInput, ensureCodexAppServerThread, codexApplicationToolConfiguration,
  assertCodexApplicationToolSchemaIdentity, inspectCodexAppServerMessageAdmission, retireCodexConversationHistory } from "../codexProvider.js";
import { createCodexAppServerProviderOwner } from "../codexProviderOwner.js";
import { codexAuthOutputRequiresReconnect, codexProviderConfiguration, codexToolFreeConfiguration } from "../codexConfiguration.js";
import { nativeAiProvider, nativeAiModel } from "../../../shared/nativeProviders.js";
import { createCodexAppServerRunOwner, codexAppServerTurnState, codexAppServerFrozenTurnInterruptResponse } from "../codexTurn.js";
import { createLocalConversationExecution } from "../localExecution.js";
import { validateConversationConfiguration, validateConnectionModel } from "../configuration.js";
import { codexCommandHookCommand } from "../commandWrapper.js";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const goalValue = goal => goal ? {
  id: hash([goal.threadId, goal.createdAt, goal.objective]), objective: goal.objective, status: goal.status,
  tokenBudget: goal.tokenBudget ?? null, tokensUsed: goal.tokensUsed, timeUsedSeconds: goal.timeUsedSeconds,
  ...(Number.isFinite(goal.createdAt) ? { createdAt: new Date(goal.createdAt * 1000).toISOString() } : {}),
  ...(Number.isFinite(goal.updatedAt) ? { updatedAt: new Date(goal.updatedAt * 1000).toISOString() } : {})
} : null;
const goalCapabilities = Object.freeze({ goals: true, goalBudgets: true,
  goalCommands: Object.freeze({
    set: Object.freeze({ delivery: "control", interruptsTurn: false }),
    resume: Object.freeze({ delivery: "control", interruptsTurn: false }),
    pause: Object.freeze({ delivery: "control", interruptsTurn: false }),
    cancel: Object.freeze({ delivery: "control", interruptsTurn: false })
  }) });
const nativeInput = input => [
  ...(input.text || input.attachmentManifest ? [{ type: "text", text: `${input.text || ""}${input.attachmentManifest || ""}` }] : []),
  ...(input.content || []).map(part => part.type === "text" ? part :
    { type: "image", url: `data:${part.mediaType};base64,${part.image.toString("base64")}` }),
  ...codexLocalImageInput(input.localFiles)
];

/** Conversations own threads and observers on the account's shared native runtime. */
export function createCodexConversationDriver({ connections, host = {}, limits = {} } = {}) {
  const env = { ...(host.env || process.env) };
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
      file = await open(path.join(configRoot, "auth.json"), "r");
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
      if (error.code !== "ENOENT") throw new Error("Codex credential data could not be read. Restore its account configuration.");
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
    throw new Error("Sign in with codex login before using this conversation.");
  }

  async function nativeHost(selected) {
    // Managed applications supply their existing execution/account scope. This
    // facility contains host policy; the provider and process algorithms stay here.
    if (host.codex) return host.codex({ providerId: selected.providerId });
    if (typeof execution.run !== "function") {
      throw new TypeError("The Codex execution host must support capture and detached native execution.");
    }
    const processExecution = { ...execution, run: request => execution.run({ ...request, limits: host.limits }) };
    const scope = hash([configRoot, selected.providerId, selected.accountIdentity || "", command, host.commandWrapper || null]).slice(0, 16);
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
        if (captured && captured !== await generation()) throw new Error("Codex authentication changed. Reopen the conversation with its original account.");
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

  async function nativeStorageProvider({ sessionId, native, binding, context }) {
    const prepared = await native.preparation.storage(sessionId, binding, context);
    return { provider: await native.providerOwner.ensureSession(prepared.providerContext),
      toolHomeSource: prepared.toolHomeSource };
  }

  async function disposeNative({ sessionId, namespace, native, options }) {
    if (options?.assistantScope) {
      if (options.assistantScope.id !== sessionId) throw new TypeError("Codex helper scope does not match.");
      const result = await native.providerOwner.stopCachedProvidersForSession(native.namespace || namespace, { requireStopped: true });
      return { ...result, closed: result.stopped };
    }
    return native.runOwner.closeSession(sessionId, native.preparation.cleanup(options));
  }

  return Object.freeze({
    // Codex fixes dynamic tool definitions when the thread is created. The three
    // discovery entry points stay stable while the authorized action set changes.
    toolDiscovery: true,
    canonicalTranscript: true,
    attachmentTypes: ["text", "image", "localFile"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, history: true,
      instructions: true, configuration: true, steering: true, ...goalCapabilities,
      attachments: true, tools: true, nativeTools, structuredOutput: true }),
    validateConfiguration(config) {
      validateConversationConfiguration(config, { engine: "Codex", connections, structuredOutput: true, maxOutputCharacters: maximumOutput });
    },
    disposeNative,
    interruptDetachedConversation({ sessionId, native, input, context }) {
      return native.runOwner.interruptDetachedTurn(sessionId, input, context);
    },
    deleteDetachedConversation({ sessionId, native, input, context }) {
      return native.runOwner.deleteDetachedThread(sessionId, input, context);
    },
    async listConversationStorage(prepared) {
      const { provider } = await nativeStorageProvider(prepared);
      const { binding } = prepared;
      return (await provider.listNativeThreadsForCwd(binding.workdir)).map((conversationId) => ({ ...binding, conversationId }));
    },
    async retireConversationHistory(prepared) {
      const { provider, toolHomeSource } = await nativeStorageProvider(prepared);
      return retireCodexConversationHistory(provider, prepared.binding, {
        toolHomeSource, beforeDelete: prepared.context.beforeDelete, signal: prepared.context.signal,
        errorPrefix: prepared.native.errorPrefix
      });
    },
    invalidateRuntimes({ native, input }) {
      return native.runOwner.invalidateRuntimes(input, native.preparation);
    },
    reconcileSessions({ native, sessions, options }) {
      return native.runOwner.reconcileSessions(sessions, options, native.preparation);
    },
    unsubscribeSessions({ native, sessions }) {
      return native.runOwner.unsubscribeSessions(sessions, native.preparation);
    },
    async closeProject({ native, input }) {
      const prepared = await native.preparation.projectCleanup();
      if (Object.hasOwn(prepared, "value")) return prepared.value;
      return native.runOwner.closeProject(input, prepared);
    },
    inspectTemporaryActivity({ sessionId, native }) {
      return native.runOwner.hasActiveTemporaryConversation(sessionId);
    },
    releaseRenewalPredecessorProcessExitProof({ native, context }) {
      const prepared = native.preparation.predecessor(context);
      return native.providerOwner.releasePreparedRuntimeProof(prepared);
    },
    releaseRenewalSuccessorProcessExitProof({ native, context }) {
      const prepared = native.preparation.successor(context);
      return native.providerOwner.releasePreparedRuntimeProof(prepared);
    },
    async generateRenewalHandover({ sessionId, native, input, context }) {
      const prepared = native.preparation.handover(input, context);
      const acquired = await native.runOwner.conversationContext(sessionId, input, prepared.context);
      if (acquired.ok === false) return acquired;
      const turn = await prepared.turn(acquired);
      const execution = await native.runOwner.runRenewalHandover(sessionId, turn.input, turn.context);
      return turn.completeResult(execution);
    },
    async seedRenewalHandover({ sessionId, native, input, context }) {
      const prepared = native.preparation.seed(input, context);
      const acquired = await native.runOwner.conversationContext(sessionId, input, prepared.context);
      if (acquired.ok === false) return acquired;
      const turn = prepared.turn(acquired);
      const execution = await native.runOwner.runRenewalSeed(turn.input, turn.context);
      return turn.completeResult(execution);
    },
    async ensureConversation({ sessionId, native }) {
      return native.runOwner.ensureSessionReadiness(sessionId, await native.preparation.readiness());
    },
    async createConversation({ sessionId, native, input, context }) {
      return native.runOwner.createConversation(sessionId, input, context);
    },
    async runDetachedConversation({ sessionId, native, input, options }) {
      return native.runOwner.runDetachedConversation(sessionId, input, options);
    },
    async createBinding() {
      return { threadId: "", workdir: await realpath(workdir), configRoot, executionId: "" };
    },
    async open({ binding, writeBinding, onFailure: reportFailure, conversation }) {
      const supplied = conversation?.native;
      if (supplied?.scoped) {
        const { conversationId, context: openingContext } = supplied.scoped;
        const { runOwner: owner } = supplied;
        const sessionId = conversation.sessionId;
        const inputFor = (input = {}) => {
          if (input.conversationId && String(input.conversationId).trim() !== conversationId) {
            throw new TypeError("This operation belongs to a different scoped conversation.");
          }
          return { ...input, conversationId };
        };
        const unsupported = () => { throw Object.assign(new Error("This original scoped conversation has no canonical message or goal receipt."), {
          code: "conversation_unsupported"
        }); };
        return Object.freeze({
          capabilities: Object.freeze({ streaming: false, instructions: false, configuration: false,
            goals: false, goalBudgets: false, goalCommands: Object.freeze({}), attachments: false, tools: false, nativeTools: false }),
          // These are the original scoped commands, including their native
          // start dedup, watcher/deadline and Stop/delete proof. No main journal
          // or additional command queue is introduced for this representation.
          sendNative: ({ input, context }) => owner.startConversationTurn(sessionId, inputFor(input), context),
          readNative: ({ input, context }) => owner.readConversation(sessionId, inputFor(input), context),
          waitNative: ({ input, context }) => owner.waitForConversationTurn(sessionId, inputFor(input), context),
          cancel: ({ input, context }) => owner.stopConversation(sessionId, inputFor(input), context),
          readGoal: unsupported, updateGoal: unsupported, inspectAdmission: unsupported,
          async dispose(options) {
            if (options) return owner.deleteConversation(sessionId, inputFor(options.input), options.context);
            // Runtime shutdown retains the parent's cleanup receipt. Explicit
            // scoped deletion above owns native deletion and its proof.
            const result = await disposeNative({ sessionId, namespace: conversation.namespace, native: supplied, options: openingContext });
            if (result?.ok === false) throw Object.assign(new Error(result.error || "Scoped cleanup could not be confirmed."), result);
            return result;
          }
        });
      }
      if (!supplied && (!binding || typeof binding.threadId !== "string" || binding.workdir !== await realpath(workdir) || binding.configRoot !== configRoot)) {
        throw new Error("This Codex conversation belongs to another working directory or credential home. Restore its original host configuration.");
      }
      let native;
      let nativeProviderId;
      let current;
      let stopping;
      let disposed = false;
      let preparedThreadSettings;
      let bindingWork = Promise.resolve();
      const providerKey = "conversation";
      const providerOwner = supplied?.providerOwner || createCodexAppServerProviderOwner({
        onRecoveryEvent(_owner, event, error) {
          if (event === "stopFailed") current?.completion.reject(error);
        }
      });
      if (!conversation?.runtime?.store) throw new TypeError("Codex requires its bound conversation store.");
      const sessionId = conversation.sessionId;
      const nativeStore = conversation.runtime.store;
      const boundedWriter = name => (id, input) => {
        const limit = name === "writeConversationThinkingMessage" ? 4 * 1024 * 1024
          : name.includes("AssistantMessage") ? Math.min(maximumOutput, maximumFinalReply) : maximumOutput;
        if ((input.text?.length || 0) > limit) throw new Error("Codex output exceeded the configured limit.");
        return nativeStore[name](id, input);
      };
      const runtime = supplied ? conversation.runtime : { ...conversation.runtime, store: { ...nativeStore,
        writeConversationAssistantMessage: boundedWriter("writeConversationAssistantMessage"),
        upsertConversationAssistantMessage: boundedWriter("upsertConversationAssistantMessage"),
        writeConversationCommentaryMessage: boundedWriter("writeConversationCommentaryMessage"),
        writeConversationThinkingMessage: boundedWriter("writeConversationThinkingMessage"),
        async updateConversationStream(id, input) {
          if ((input.delta?.length || input.text?.length || 0) > maximumOutput) throw new Error("Codex output exceeded the configured limit.");
          const stream = await nativeStore.updateConversationStream(id, input);
          if (stream?.messages.some(message => message.text.length > maximumOutput)) throw new Error("Codex output exceeded the configured limit.");
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
        finalizingGraceMs: limits.codexFinalizingGraceMs,
        finalizingGraceAfterHistoryRead: limits.codexFinalizingGraceAfterHistoryRead,
        failureDetailGraceMs: limits.codexFailureDetailGraceMs,
        createRuntime: async () => runtime,
        createStore: async () => runtime.store,
        acquireProvider: async () => native,
        hasRuntime: () => Boolean(binding.threadId),
        publish: (_id, event) => publishNative(event),
        checkpoint: (_id, input) => conversation.checkpoint({ ...input,
          status: input.turnOutcome === "response_delivery_failure" ? "failed" : input.status }),
        async onNotificationSignal(kind, { threadId, turnId, provider, error }) {
          const active = current;
          if (kind !== "provider_error" || !active?.dispatched || active.finished || provider !== native ||
              threadId !== binding.threadId || !turnId || active.turnId && active.turnId !== turnId) return;
          const tracked = codexAppServerTurnState(await runtime.getSession(sessionId));
          if (tracked.threadId !== threadId || tracked.turnId !== turnId) return;
          // The original detached waiter recovered only this admitted turn.
          // Keep native activity truthful; run's existing cleanup owns Stop.
          await owner.recoverActiveTurn(sessionId, { provider, retryOnError: false, providerError: { threadId, turnId, error } });
          if (current !== active || active.finished || active.turnId !== turnId ||
              provider !== native || threadId !== binding.threadId) return;
          const result = await owner.stopTurnWithProviderFailure(sessionId, threadId, turnId, { provider, error, failureDetailReady: true });
          if (current === active && active.turnId === turnId && provider === native &&
              threadId === binding.threadId && result.reason === "provider_still_active") {
            active.completion.reject(Object.assign(new Error(error), { status: "failed" }));
          }
        }
      });
      async function publishNative(event) {
        if (supplied) binding.threadId = await conversation.identity.read();
        await conversation.publish(event);
        if (event.nativeGoal?.threadId === binding.threadId) {
          await recordGoal(event.nativeGoal.goal);
        }
        const turn = event.payload?.agentSession?.turn;
        if (!turn || !current?.dispatched) return;
        if (turn.active && current.finished && current.finishIfCurrent) {
          // The original command owner may start the next turn during Send.
          // Its publication replaces only this adapter's settled waiter.
          current.completion = Promise.withResolvers();
          current.completion.promise.catch(() => {});
          current.finished = false;
        }
        if (turn.id && turn.id !== current.turnId) {
          const previous = current.turnId;
          current.turnId = turn.id;
          if (current.admitted) {
            if (previous) await current.onNativeTurn({ turnId: turn.id, nativeOwner: true });
          } else current.pendingNativeTurn = turn.id;
        }
        if (!turn.active && event.reason === "codex-app-server-turn-idle") {
          current.finished = true;
          if ((["failed", "interrupted"].includes(turn.status) || !supplied && turn.error) && !current.signal.aborted) {
            current.completion.reject(Object.assign(new Error(turn.error || `Codex turn ${turn.status}.`), {
              status: turn.status === "completed" ? "failed" : turn.status }));
          } else current.completion.resolve();
        }
      }
      const savedTurn = codexAppServerTurnState({ agentRuns: binding.codexAppServerRun ? [binding.codexAppServerRun] : [] });
      let observationError = binding.observationLoss && (!binding.observationLoss.stopped ||
        savedTurn.active && savedTurn.status === "observation_lost")
        ? Object.assign(new Error(binding.observationLoss.message), { cleanupFailed: true }) : null;
      if (observationError) await reportFailure(observationError);
      function updateBinding(patch) {
        const work = bindingWork.then(async () => {
          const next = { ...binding, ...patch };
          await writeBinding(next);
          binding = next;
        });
        bindingWork = work.catch(() => {});
        return work;
      }
      async function recordGoal(goal) {
        if (supplied) binding.goal = goal;
        else await updateBinding({ goal });
        if (current?.admitted) await current.onEvent({ type: "goal", goal: goalValue(goal) });
        else if (current) current.pendingGoal = goal;
        else await conversation.publish({ payload: { goal: goalValue(goal) }, reason: "codex-goal" });
        return goal;
      }

      let observationTarget;
      const observation = supplied ? null : owner.createObservation(sessionId, {
        target(error) {
          if (observationTarget?.error !== error) observationTarget = { error, threadId: binding.threadId,
            message: "Codex observation was lost. Work is stopped; use Resume or Send to continue.",
            pendingMessage: "Codex observation was lost. A stop is not yet confirmed." };
          return observationTarget;
        },
        retireProvider: () => providerOwner.closeProvider(providerKey)
      });

      async function recordObservationBarrier({ provider, error }) {
        observationError = error;
        // Keep admission unavailable in memory even if its durable write fails.
        await reportFailure(error);
        await updateBinding({ observationLoss: {
          message: error.message, providerId: nativeProviderId,
          runtime: provider.runtime || provider.runtimeStopOwner || binding.observationLoss?.runtime,
          stopped: false
        } });
      }

      async function completeObservation({ provider, error, sharedStop }) {
        await updateBinding({ observationLoss: { ...binding.observationLoss, stopped: true },
          ...(sharedStop ? { executionId: "" } : {}) });
        await observation.complete({ provider, error, sharedStop });
        observationError = null;
        await reportFailure(error, { recovered: true });
        current?.completion.reject(error);
      }

      function acquireProvider(facilities, providerId) {
        nativeProviderId = providerId;
        const providerOptions = {
          ...facilities.options, runtimeDir: facilities.parameters.runtimeDir, modelProviderId: providerId,
          threadEnv: env,
          readInstructions: () => preparedThreadSettings?.developerInstructions,
          prepareThreadEnvironment: environment => preparedThreadSettings?.config.shell_environment_policy.set || environment,
          prepareThreadResumeParams(threadId, params) {
            if (threadId !== binding.threadId || !preparedThreadSettings) {
              throw new Error("Codex requires current authorized settings before resuming this conversation.");
            }
            return { ...preparedThreadSettings, ...params,
              config: { ...preparedThreadSettings.config, ...params.config } };
          },
          async beforeResumeThread(threadId) {
            owner.assertThreadCanResume(await owner.readAgentRunForSession(runtime.store, sessionId), threadId);
          },
          requestTimeoutMs: limits.admissionTimeoutMs || 30_000
        };
        return providerOwner.withLifecycle(() => providerOwner.createProvider({
          providerKey, providerOptions, preserveProcessExitProof: true,
          resources: {
            release(provider) {
              if (native === provider) native = null;
              const subscriptionPrefix = `${providerKey}:`;
              for (const key of [...owner.eventSubscriptions.keys()]) {
                if (key.startsWith(subscriptionPrefix)) owner.unsubscribeEventSubscription(key);
              }
            },
            invalidation: {
              async prepare(input) {
                if (native !== input.provider) return false;
                await recordObservationBarrier(input);
                await observation.barrier(input);
              },
              async complete({ provider, error, preparationError, stopped }) {
                try {
                  if (preparationError) throw preparationError;
                  if (stopped.status !== "fulfilled") throw stopped.reason;
                  await completeObservation({ provider, error, sharedStop: true });
                } catch (failure) {
                  error.cleanupFailed = true;
                  error.cause = failure;
                  observationError = error;
                  await reportFailure(error);
                  current?.completion.reject(error);
                  throw failure;
                }
              }
            }
          },
          create: onObservationLost => new CodexAppServerAgentProvider({ ...providerOptions, onObservationLost }, facilities),
          observation: {
            async prepare(input) {
              observationError = input.error;
              await reportFailure(input.error);
              const threads = await observation.prepare(input);
              await recordObservationBarrier(input);
              return threads;
            },
            async barrier(input) {
              await observation.barrier(input);
              await recordObservationBarrier(input);
            },
            complete: completeObservation
          }
        }), providerKey, providerOptions);
      }

      async function stop() {
        if (stopping) return stopping;
        stopping = (async () => {
          if (!native && observationError) {
            // Recover the exact saved owner through the production disk lock
            // and metadata path. Cleanup must not start or resume a thread.
            const saved = binding.observationLoss;
            const facilities = await nativeHost({ providerId: saved.providerId,
              accountIdentity: binding.connectionIdentities?.[saved.providerId] });
            native = await acquireProvider(facilities, saved.providerId);
            native.runtimeStopOwner = saved.runtime;
            native.observationFailure = observationError;
          }
          if (native?.observationFailure) {
            await providerOwner.recover(providerKey, native.observationFailure);
            return;
          }
          if (native && binding.threadId) {
            const provider = native;
            try {
              const { goal } = await provider.stopThreadForObservationLoss(binding.threadId, current?.turnId);
              await recordGoal(goal || null);
            } catch (error) {
              await provider.failObservation(error);
            }
          }
        })().catch(error => { error.cleanupFailed = true; throw error; }).finally(() => { stopping = null; });
        return stopping;
      }

      async function selection(configuration, context, signal) {
        if (!configuration.integrationId) return { model: configuration.model, providerId: "openai" };
        const connection = await connections.resolve({ context, integrationId: configuration.integrationId });
        signal.throwIfAborted();
        const provider = nativeAiProvider(connection.providerId);
        const model = nativeAiModel(connection.model, connection.providerId);
        if (!provider || !model) throw new Error("This exact provider/model is not supported by the Codex integration. Choose a supported model without renaming it.");
        validateConnectionModel(configuration, connection);
        if (configuration.effort && !model.variants.includes(configuration.effort)) throw new Error("The selected Codex model does not support this reasoning effort.");
        const identity = hash([provider.id, provider.baseUrl, connection.apiKey]);
        const previous = binding.connectionIdentities?.[provider.id];
        if (previous && previous !== identity) throw new Error("This conversation belongs to another Codex provider account. Restore that connection or start a new conversation.");
        if (!previous) await updateBinding({ connectionIdentities: { ...binding.connectionIdentities, [provider.id]: identity } });
        return { model: model.id, providerId: provider.id, accountIdentity: identity, config: codexProviderConfiguration(provider, connection.apiKey) };
      }

      async function connect(signal, selected) {
        if (observationError) throw observationError;
        if (native && nativeProviderId !== selected.providerId) {
          await stop();
          providerOwner.closeProvider(providerKey);
        }
        if (!native) {
          const facilities = await nativeHost(selected);
          signal.throwIfAborted();
          const provider = await acquireProvider(facilities, selected.providerId);
          // Account startup has other waiters. Cancellation releases this
          // observer; the existing runtime owner still settles shared startup.
          const connected = providerOwner.acquireRuntime({ providerKey, provider,
            providerOptions: provider.options, operation: () => provider.connect() });
          const cancelled = Promise.withResolvers();
          const abort = () => cancelled.reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
          try {
            await Promise.race([connected, cancelled.promise]);
            signal.throwIfAborted();
            // Execution identity is a reference for recovery, not ownership of
            // the account service by this one conversation.
            await updateBinding({ executionId: provider.runtime.executionId });
            native = provider;
            nativeProviderId = selected.providerId;
          } catch (error) {
            void connected.then(() => providerOwner.closeProvider(providerKey), () => providerOwner.closeProvider(providerKey));
            throw error;
          } finally {
            signal.removeEventListener("abort", abort);
          }
        }
        signal.throwIfAborted();
        if (selected.providerId !== "openai") return;
        const identity = await accountIdentity(native.client, signal);
        if (binding.accountIdentity && binding.accountIdentity !== identity) {
          providerOwner.closeProvider(providerKey);
          throw new Error("This conversation belongs to another Codex account. Restore that account or start a new conversation.");
        }
        if (!binding.accountIdentity) await updateBinding({ accountIdentity: identity });
      }

      async function prepareConfiguration(configuration, context, signal, tools) {
        const { dynamicTools, toolSchemaIdentity } = codexApplicationToolConfiguration(tools);
        assertCodexApplicationToolSchemaIdentity(binding.threadId, binding.toolSchemaIdentity, toolSchemaIdentity);
        const selected = await selection(configuration, context, signal);
        await connect(signal, selected);
        const [configResult, hookResult] = await Promise.all([
          native.client.request("config/read", { cwd: binding.workdir, includeLayers: false }, { signal }),
          native.client.request("hooks/list", { cwds: [binding.workdir] }, { signal })
        ]);
        const toolConfiguration = codexToolFreeConfiguration({ configResult, hookResult, workdir: binding.workdir });
        // Native control verification runs the host's shell even when model
        // shell tools are disabled. Its login profile needs the standard tools;
        // do not copy credentials or the rest of the host environment here.
        toolConfiguration.shell_environment_policy.set.PATH = env.PATH || "/usr/bin:/bin";
        // A goal can be set while an ordinary turn is already running. Codex
        // must have its native scheduler enabled before that turn starts.
        toolConfiguration.features.goals = true;
        if (host.commandWrapper) {
          const hookCommand = codexCommandHookCommand(host.commandWrapper);
          const owned = hookResult.data[0].hooks.filter(hook => hook.source === "sessionFlags" &&
            hook.eventName === "preToolUse" && hook.handlerType === "command" && hook.command === hookCommand);
          if (owned.length !== 1 || typeof owned[0].currentHash !== "string" || !owned[0].currentHash) {
            throw new Error("Codex did not install the host's required command wrapper.");
          }
          toolConfiguration.features.hooks = true;
          toolConfiguration.hooks.PreToolUse = [{ matcher: "^Bash$", hooks: [{ type: "command", command: hookCommand, timeout: 30 }] }];
          toolConfiguration.hooks.state[owned[0].key] = { enabled: true, trusted_hash: owned[0].currentHash };
        }
        if (nativeTools) {
          Object.assign(toolConfiguration.features, { shell_tool: true, unified_exec: true, view_image: true });
          toolConfiguration.include_environment_context = true;
          toolConfiguration.include_permissions_instructions = true;
          toolConfiguration.tools.update_plan.enabled = true;
          toolConfiguration.shell_environment_policy.set = Object.fromEntries(Object.entries(env).filter(([name, value]) =>
            typeof value === "string" && !["DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE"].includes(name)));
          toolConfiguration.web_search = selected.config?.web_search || "disabled";
        }
        const params = { developerInstructions: configuration.systemPrompt,
          cwd: binding.workdir, modelProvider: selected.providerId, ...(selected.model ? { model: selected.model } : {}),
          dynamicTools, ...(!nativeTools ? { environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [] } : {}),
          approvalPolicy: "never", sandbox: nativeTools ? "danger-full-access" : "read-only", allowProviderModelFallback: false,
          config: { ...selected.config, ...toolConfiguration }
        };
        // Cold control recovery uses the provider's original settings facilities;
        // it must not resume with ambient defaults or an old instruction prompt.
        preparedThreadSettings = params;
        return { selected, params, toolSchemaIdentity };
      }

      async function prepare(configuration, context, signal, tools) {
        const { selected, params, toolSchemaIdentity } = await prepareConfiguration(configuration, context, signal, tools);
        const retainedThreadId = binding.threadId;
        const prepared = await ensureCodexAppServerThread({
          provider: native, workdir: binding.workdir,
          observeThread: threadId => owner.subscribeEvents(sessionId, native, threadId, { providerKey }),
          settings: async () => ({ threadSettings: params, threadStartSettings: params }),
          identity: { read: () => retainedThreadId,
            async write({ threadId }) { await updateBinding({ threadId, toolSchemaIdentity }); } }
        });
        if (!retainedThreadId && prepared.thread.raw?.historyMode !== "paginated") {
          throw new Error("Codex did not create the required paginated history. Update Codex before starting this conversation.");
        }
        owner.subscribeEvents(sessionId, native, prepared.threadId, { providerKey });
        return { ...selected, resumeOptions: params };
      }

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

      async function withDelivery(input, operation) {
        return owner.withMessageDelivery(sessionId, input.messageId, {
          attachments: input.attachments, text: input.authoredInput?.text ?? input.text,
          turnMetadata: input.nativeMessage?.turnMetadata || null, actorContext: input.nativeMessage?.actorContext || null,
          authoredInput: input.authoredInput
        }, operation);
      }

      function messagePreparation(configuration, context, signal, tools) {
        if (supplied) return tools ? { ...supplied.messagePreparation, applicationTools: tools,
          providerReady: current.providerReady } : supplied.messagePreparation;
        return {
          async readContext() {
            const session = await runtime.getSession(sessionId);
            return { runtime, session, selection: {
              runtime, session, threadId: () => binding.threadId,
              async acquireProvider() {
                const reused = Boolean(native?.isAvailable());
                await connect(signal, await selection(configuration, context, signal));
                return { provider: native, reused };
              }
            } };
          },
          threadPreparation() {
            return {
              get failureThreadId() { return binding.threadId; },
              async provider() {
                const { selected, params, toolSchemaIdentity } = await prepareConfiguration(configuration, context, signal, tools);
                const retainedThreadId = binding.threadId;
                return {
                  provider: native,
                  workdir: binding.workdir,
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
              get turnSettings() { return { cwd: binding.workdir,
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
        const active = current;
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
        return withDelivery(command.input, async () => {
          let attempted = false;
          let rejected = false;
          let accepted = false;
          const input = deliveryInput(command.input, async value => {
            await command.beforeDispatch(value);
            signal.throwIfAborted();
            attempted = true;
            current.dispatched = true;
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
            if (attempted && !accepted && !rejected && !Number.isInteger(error.code)) error.delivery = "uncertain";
            throw error;
          }
        });
      }

      async function goalContext(configuration, context, signal, { prepareThread = false, tools } = {}) {
        if (supplied) return owner.prepareGoalContext(sessionId, context, supplied.goalPreparation, { prepareThread });
        let selected;
        if (prepareThread && !binding.threadId) selected = await prepare(configuration, context, signal, tools);
        else if (prepareThread) {
          const prepared = await prepareConfiguration(configuration, context, signal, tools);
          selected = { ...prepared.selected, resumeOptions: prepared.params };
        } else {
          selected = await selection(configuration, context, signal);
          await connect(signal, selected);
        }
        return { runtime, session: await runtime.getSession(sessionId), provider: native,
          threadId: binding.threadId, providerKey, resumeOptions: selected.resumeOptions };
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
        if (observationError) {
          await stop();
          return { ok: true, interrupted: true };
        }
        const result = await owner.interruptTurn(sessionId, {}, {
          runtime, admissionError: () => null, threadId: () => binding.threadId,
          observationOwner: () => native,
          async acquireProvider() {
            if (!native && configuration) {
              const signal = AbortSignal.timeout(30_000);
              await connect(signal, await selection(configuration, context, signal));
            }
            if (!native) throw new Error("Codex's retained runtime owner is unavailable.");
            await native.ensureAvailable();
            return native;
          }
        });
        if (result.value?.ok === false) throw Object.assign(new Error(result.value.error || "Codex could not confirm that work stopped."), { cleanupFailed: true });
        return result.value;
      }

      return Object.freeze({
        publishNative,
        async readGoal({ configuration, context }) {
          if (supplied) {
            const target = await supplied.readGoalContext(context);
            const result = target.ok === false ? { status: "unavailable", goal: null }
              : await providerOwner.readSessionGoal(conversation.namespace, target.threadId);
            binding.threadId = target.threadId || "";
            binding.goal = result.goal || null;
            if (target.completeResult) await target.completeResult(result, {
              segmentId: target.threadId ? `codex:${target.threadId}` : null, capabilities: goalCapabilities
            });
            return { goal: goalValue(result.goal), nativeResult: result };
          }
          if (!binding.threadId) return null;
          const signal = AbortSignal.timeout(30_000);
          await connect(signal, await selection(configuration, context, signal));
          const { goal } = await native.readGoal(binding.threadId, { signal });
          await recordGoal(goal || null);
          return goalValue(goal);
        },
        async updateGoal({ configuration, context, input, tools, representation }) {
          if (supplied) {
            const invalid = owner.validateGoalInput(input);
            if (invalid) return { goal: goalValue(binding.goal), nativeResult: invalid };
            const admission = supplied.admission();
            if (admission.ok === false) return { goal: goalValue(binding.goal), nativeResult: admission };
            let nativeContext;
            let result;
            try {
              nativeContext = await goalContext(configuration, context);
              let command = input;
              if (representation !== "native") {
                binding.threadId = nativeContext.threadId;
                const goal = binding.goal || null;
                if ((goalValue(goal)?.id || null) !== (input.expectedGoalId || null)) throw new Error("The native goal changed. Read it again before changing it.");
                command = { ...input, threadId: binding.threadId,
                  createdAt: goal?.createdAt, objective: input.action === "set" ? input.objective : goal?.objective };
              }
              result = await owner.updateGoal(sessionId, command, {
                context: nativeContext, prepareConversation: () => goalContext(configuration, context, undefined, { prepareThread: true })
              });
              if (result.ok !== false) binding.goal = result.goal || null;
            } finally { admission.release(); }
            if (nativeContext.completeResult) await nativeContext.completeResult(result);
            return { goal: goalValue(result.goal), nativeResult: result };
          }
          if (binding.goalRequest) throw Object.assign(new Error("A goal command from an earlier runtime has unresolved delivery. Inspect its saved state before changing the goal."), {
            code: "conversation_delivery_uncertain"
          });
          const signal = AbortSignal.timeout(30_000);
          const nativeContext = await goalContext(configuration, context, signal, {
            prepareThread: Boolean(binding.threadId && ["set", "resume"].includes(input.action)), tools
          });
          const goal = binding.threadId ? (await native.readGoal(binding.threadId, { signal })).goal : null;
          if ((goalValue(goal)?.id || null) !== (input.expectedGoalId || null)) throw new Error("The native goal changed. Read it again before changing it.");
          const result = await owner.updateGoal(sessionId, { ...input, threadId: binding.threadId,
            createdAt: goal?.createdAt, objective: input.action === "set" ? input.objective : goal?.objective }, {
            context: nativeContext,
            prepareConversation: () => goalContext(configuration, context, signal, { prepareThread: true, tools })
          });
          if (result.ok === false) throw new Error(result.error);
          return goalValue(result.goal);
        },
        async inspectAdmission({ messageId, threadId, nativeTurnId, configuration, context, goal: command, representation }) {
          if (supplied) {
            const prepared = await supplied.inspectionPreparation({ messageId, threadId }, context);
            if (prepared.ok === false) return representation === "native" ? prepared : { accepted: false, ...prepared };
            const target = await owner.conversationContext(sessionId, {}, prepared);
            if (target.ok === false) return representation === "native" ? target : { accepted: false, ...target };
            const receipt = await inspectCodexAppServerMessageAdmission({ provider: target.provider, threadId, messageId });
            return representation === "native" ? receipt : { ...receipt, accepted: receipt.admission === "accepted" };
          }
          if (command || binding.goalReceipt?.messageId === messageId || binding.goalRequest?.messageId === messageId) {
            // Old goal-message records stay inspection-only. Native goal state
            // cannot certify the authored delivery invented by that adapter.
            return { accepted: false, recoveryLimitation: "This older goal-message record requires offline inspection. Its saved history and delivery evidence were preserved." };
          }
          if (!binding.threadId) return { accepted: false };
          const signal = AbortSignal.timeout(30_000);
          await connect(signal, await selection(configuration, context, signal));
          let acceptedTurn;
          let cursor;
          do {
            const page = await native.client.request("thread/turns/list", { threadId: binding.threadId,
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
            { threadId: binding.threadId, turnId: acceptedTurn?.id || "" }, request.data);
          let recoveryLimitation;
          if (!stored.agentRuns.length) {
            recoveryLimitation = "Delivery is confirmed, but this older binding has no original native run record. Stored history is preserved; output recovery cannot be proven.";
          } else if (tracked.threadId !== binding.threadId || acceptedTurn && tracked.turnId !== acceptedTurn.id && tracked.outerTurnId !== messageId) {
            recoveryLimitation = "Delivery is confirmed. The original native owner tracks a different turn, so this inspection preserves stored history without reconstructing unowned output.";
          } else {
            owner.subscribeEvents(sessionId, native, binding.threadId, { providerKey });
            await owner.reconcileThreadStatus(sessionId, native, binding.threadId, {
              source: "delivery_inspection", requireTrackedTurn: true, observeLatestTurn: true
            });
            if (tracked.turnId) {
              const recovered = await owner.submitAssistantResult(sessionId, binding.threadId, tracked.turnId, { recoverFromProvider: true });
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
          if (!current || current.finished && !current.finishIfCurrent) throw new Error("Codex has no active turn to steer.");
          return current.steer(command);
        },
        async run({ configuration, context, input, tools, signal, beforeDispatch, accept, onEvent, onNativeTurn, finishIfCurrent }) {
          if (disposed || current) throw new Error("This Codex conversation is closed or already working.");
          const completion = Promise.withResolvers();
          const admission = Promise.withResolvers();
          completion.promise.catch(() => {});
          admission.promise.catch(() => {});
          if (input.goal) throw new Error("Codex goals are controls. Inspect any unresolved goal-message record before continuing.");
          const active = current = { configuration, context, inputId: input.messageId,
            onEvent, onNativeTurn, signal, completion, admission, inputReady: admission.promise, finishIfCurrent,
            admitted: false, dispatched: false, turnId: "" };
          let cancellation;
          let problem;
          let delivered;
          let waitForTurn = false;
          let executingProvider;
          const toolCalls = new Set();
          const toolRegistrations = new Map();
          function toolHandler(provider, threadId, isRegistered = () => true) {
            return async ({ method, params }) => {
              if (method !== "item/tool/call" || !tools || params?.threadId !== (threadId || binding.threadId) || params.namespace ||
                  supplied && (disposed || current !== active || active.finished || signal.aborted || owner.runtimeLifecycle?.closing === true || !isRegistered())) {
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
                  if (supplied && (params.turnId !== active.turnId || disposed || current !== active || active.finished ||
                      signal.aborted || !isRegistered())) {
                    ownership.resolve(false);
                    return;
                  }
                  owned = true;
                  const failure = provider.observationFailure;
                  if (failure) ownership.reject(failure.cause || failure);
                  else ownership.resolve(params.turnId === active.turnId);
                });
                if (!await ownership.promise || supplied && (disposed || current !== active || active.finished || signal.aborted || !isRegistered())) {
                  owned = false;
                  throw new Error("This application tool call belongs to another turn.");
                }
                const result = await tools.execute({ id: params.callId, name: params.tool, arguments: JSON.stringify(params.arguments) });
                return { success: result.ok, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] };
              })();
              toolCalls.add(operation);
              try { return await operation; }
              catch (error) {
                if (!supplied || owned && current === active && params.turnId === active.turnId && isRegistered()) {
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
            if (disposed || current !== active) throw new Error("This conversation handle is closed.");
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
              executingProvider = native;
            }
            if (!supplied) native.setServerRequestHandler(toolHandler(executingProvider));
            const command = { input, beforeDispatch, accept };
            delivered = await sendMessage(command, configuration, context, signal, tools);
            waitForTurn = !supplied || delivered.value?.delivered === true;
            if (!finishIfCurrent && waitForTurn) {
              await completion.promise;
              await owner.notificationQueue.drain(sessionId);
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
              if (!problem && waitForTurn) await owner.notificationQueue.drain(sessionId);
            } catch (error) { problem = error; }
          }
          signal.removeEventListener("abort", abort);
          admission.reject(problem || signal.reason);
          try {
            // Account invalidation already owns this stop attempt. Its failed
            // proof stays available for explicit cleanup through the same owner.
            if ((!supplied && problem || supplied && active.toolFailure || signal.aborted) && problem?.code !== "codex_runtime_invalidated") {
              await (cancellation || interrupt());
            }
          } catch (error) { problem = error; }
          try {
            await owner.notificationQueue.drain(sessionId);
            // The original queue starts observation recovery without awaiting
            // it. Join only this provider's existing attempt before settling.
            if (!supplied) await providerOwner.pendingRecovery(providerKey, executingProvider);
          } catch (error) { problem = error; }
          finally {
            for (const owned of toolRegistrations.values()) owned.registration.release();
            toolRegistrations.clear();
            await Promise.allSettled([...toolCalls]);
            if (!supplied) {
              native?.setServerRequestHandler(null);
              owner.clearSessionRecoveryTimers(sessionId);
            }
            current = null;
          }
          if (problem) throw problem;
          return delivered;
        },
        cancel: interrupt,
        async dispose(options) {
          if (supplied) {
            try {
              const result = await disposeNative({ sessionId, namespace: conversation.namespace, native: supplied, options });
              if (result?.ok === false) throw Object.assign(new Error(result.error), result);
              disposed = true;
              current?.completion.reject(Object.assign(new Error("This conversation handle is closed."), { status: "interrupted" }));
              return result;
            } catch (error) {
              error.cleanupFailed = true;
              current?.completion.reject(error);
              throw error;
            }
          }
          await stop();
          owner.clearSessionRecoveryTimers(sessionId);
          for (const key of owner.eventSubscriptions.keys()) owner.unsubscribeEventSubscription(key);
          await owner.notificationQueue.drain(sessionId);
          await providerOwner.stopCachedProvider(providerKey, { preserveProcessExitProof: true, requireStopped: true });
          disposed = true;
        }
      });
    }
  });
}
