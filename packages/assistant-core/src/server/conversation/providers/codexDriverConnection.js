import { CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES, codexCommandHookDefinition } from "../codexProcess.js";
import { CodexAppServerAgentProvider } from "../codexProvider.js";
import {
  assertCodexApplicationToolSchemaIdentity,
  codexApplicationToolConfiguration,
  ensureCodexAppServerThread
} from "../codexProviderThreads.js";
import { codexProviderConfiguration } from "../codexConfiguration.js";
import { codexToolFreeConfiguration } from "../codexIsolation.js";
import { codexCommandHookCommand } from "../commandWrapper.js";
import { validateConnectionModel } from "../configuration.js";
import { jsonHash as hash } from "../normalize.js";
import { nativeAiProvider, nativeAiModel } from "../../../shared/nativeProviders.js";

/**
 * The native side of one driver conversation: its observation, the provider it acquires and stops, the account it
 * selects and the thread settings it prepares. It reads and updates the conversation's session record.
 * @param {object} dependencies
 * @param {import("./codexDriver.js").CodexDriverSession} dependencies.session
 * @param {object | undefined} dependencies.supplied
 * @param {string} dependencies.sessionId
 * @param {string} dependencies.providerKey
 * @param {ReturnType<typeof import("../codexProviderOwner.js").createCodexAppServerProviderOwner>} dependencies.providerOwner
 * @param {ReturnType<typeof import("../codexTurn.js").createCodexAppServerRunOwner>} dependencies.owner
 * @param {object} dependencies.runtime
 * @param {((error: Error) => void) | undefined} dependencies.reportFailure
 * @param {(update: (binding: object) => object) => Promise<void>} dependencies.updateBinding
 * @param {(goal: object | null) => Promise<object | null>} dependencies.recordGoal
 * @param {(client: object, signal: AbortSignal) => Promise<string>} dependencies.accountIdentity
 * @param {object} dependencies.connections
 * @param {Record<string, string>} dependencies.env
 * @param {object} dependencies.host
 * @param {object} dependencies.limits
 * @param {(selected: object) => Promise<object>} dependencies.nativeHost
 * @param {boolean} dependencies.nativeTools
 */
export function createCodexDriverConnection({
  session,
  supplied,
  sessionId,
  providerKey,
  providerOwner,
  owner,
  runtime,
  reportFailure,
  updateBinding,
  recordGoal,
  accountIdentity,
  connections,
  env,
  host,
  limits,
  nativeHost,
  nativeTools
}) {
  const observation = supplied ? null : owner.createObservation(sessionId, {
    target(error) {
      if (session.observationTarget?.error !== error) session.observationTarget = { error, threadId: session.binding.threadId,
        message: "Codex observation was lost. Work is stopped; use Resume or Send to continue.",
        pendingMessage: "Codex observation was lost. A stop is not yet confirmed." };
      return session.observationTarget;
    },
    retireProvider: () => providerOwner.closeProvider(providerKey)
  });

  async function recordObservationBarrier({ provider, error }) {
    session.observationError = error;
    // Keep admission unavailable in memory even if its durable write fails.
    await reportFailure(error);
    await updateBinding({ observationLoss: {
      message: error.message, providerId: session.nativeProviderId,
      runtime: provider.runtime || provider.runtimeStopOwner || session.binding.observationLoss?.runtime,
      stopped: false
    } });
  }

  async function completeObservation({ provider, error, sharedStop, threadIds }) {
    if (threadIds && !threadIds.includes(session.binding.threadId)) return;
    await updateBinding({ observationLoss: { ...session.binding.observationLoss, stopped: true },
      ...(sharedStop ? { executionId: "" } : {}) });
    await observation.complete({ provider, error, sharedStop, threadIds });
    session.observationError = null;
    await reportFailure(error, { recovered: true });
    session.current?.completion.reject(error);
  }

  function acquireProvider(facilities, providerId) {
    session.nativeProviderId = providerId;
    const providerOptions = {
      ...facilities.options, runtimeDir: facilities.parameters.runtimeDir, modelProviderId: providerId,
      threadEnv: env,
      readInstructions: () => session.preparedThreadSettings?.developerInstructions,
      prepareThreadEnvironment: environment => session.preparedThreadSettings?.config.shell_environment_policy.set || environment,
      prepareThreadResumeParams(threadId, params) {
        if (threadId !== session.binding.threadId || !session.preparedThreadSettings) {
          throw new Error("Codex requires current authorized settings before resuming this conversation.");
        }
        return { ...session.preparedThreadSettings, ...params,
          config: { ...session.preparedThreadSettings.config, ...params.config } };
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
          if (session.native === provider) session.native = null;
          const subscriptionPrefix = `${providerKey}:`;
          for (const key of [...owner.eventSubscriptions.keys()]) {
            if (key.startsWith(subscriptionPrefix)) owner.unsubscribeEventSubscription(key);
          }
        },
        invalidation: {
          async prepare(input) {
            if (session.native !== input.provider) return false;
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
              session.observationError = error;
              await reportFailure(error);
              session.current?.completion.reject(error);
              throw failure;
            }
          }
        }
      },
      create: onObservationLost => new CodexAppServerAgentProvider({ ...providerOptions, onObservationLost }, facilities),
      observation: {
        async prepare(input) {
          if (input.threadIds && !input.threadIds.includes(session.binding.threadId)) return new Map();
          session.observationError = input.error;
          await reportFailure(input.error);
          const threads = await observation.prepare(input);
          await recordObservationBarrier(input);
          return threads;
        },
        async barrier(input) {
          if (input.threadIds && !input.threadIds.includes(session.binding.threadId)) return;
          await observation.barrier(input);
          await recordObservationBarrier(input);
        },
        complete: completeObservation
      }
    }), providerKey, providerOptions);
  }

  async function stop() {
    if (session.stopping) return session.stopping;
    session.stopping = (async () => {
      if (!session.native && session.observationError) {
        // Recover the exact saved owner through the production disk lock
        // and metadata path. Cleanup must not start or resume a thread.
        const saved = session.binding.observationLoss;
        const facilities = await nativeHost({ providerId: saved.providerId,
          accountIdentity: session.binding.connectionIdentities?.[saved.providerId] });
        session.native = await acquireProvider(facilities, saved.providerId);
        session.native.runtimeStopOwner = saved.runtime;
        session.native.observationFailure = session.observationError;
      }
      if (session.native?.observationFailure) {
        await providerOwner.recover(providerKey, session.native.observationFailure);
        return;
      }
      if (session.native && session.binding.threadId) {
        const provider = session.native;
        try {
          const { goal } = await provider.stopThreadForObservationLoss(session.binding.threadId, session.current?.turnId);
          await recordGoal(goal || null);
        } catch (error) {
          await provider.failObservation(error);
        }
      }
    })().catch(error => { error.cleanupFailed = true; throw error; }).finally(() => { session.stopping = null; });
    return session.stopping;
  }

  async function selection(configuration, context, signal, requireBound = false, receiptBinding) {
    if (!configuration.integrationId) {
      if (requireBound && !receiptBinding?.accountIdentity) throw new Error("The completed Codex response has no saved native account fingerprint.");
      if (requireBound && session.binding.accountIdentity !== receiptBinding.accountIdentity) {
        throw new Error("The completed Codex response belongs to a different native account binding.");
      }
      return { model: configuration.model, providerId: "openai" };
    }
    const connection = await connections.resolve({ context, integrationId: configuration.integrationId });
    signal.throwIfAborted();
    const provider = nativeAiProvider(connection.providerId);
    const model = nativeAiModel(connection.model, connection.providerId);
    if (!provider || !model) throw new Error("This exact provider/model is not supported by the Codex integration. Choose a supported model without renaming it.");
    validateConnectionModel(configuration, connection);
    if (configuration.effort && !model.variants.includes(configuration.effort)) throw new Error("The selected Codex model does not support this reasoning effort.");
    const identity = hash([provider.id, provider.baseUrl, connection.apiKey]);
    const previous = session.binding.connectionIdentities?.[provider.id];
    const expected = receiptBinding?.connectionIdentities?.[provider.id];
    if (requireBound && !expected) throw new Error("The completed Codex response has no saved provider account fingerprint.");
    if (requireBound && (previous !== expected || identity !== expected)) {
      throw new Error("The completed Codex response belongs to a different provider account binding.");
    }
    if (previous && previous !== identity) throw new Error("This conversation belongs to another Codex provider account. Restore that connection or start a new conversation.");
    if (!previous) await updateBinding({ connectionIdentities: { ...session.binding.connectionIdentities, [provider.id]: identity } });
    return { model: model.id, providerId: provider.id, accountIdentity: identity, config: codexProviderConfiguration(provider, connection.apiKey) };
  }

  async function connect(signal, selected) {
    if (session.observationError) throw session.observationError;
    if (session.native && session.nativeProviderId !== selected.providerId) {
      await stop();
      providerOwner.closeProvider(providerKey);
    }
    if (!session.native) {
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
        session.native = provider;
        session.nativeProviderId = selected.providerId;
      } catch (error) {
        void connected.then(() => providerOwner.closeProvider(providerKey), () => providerOwner.closeProvider(providerKey));
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    }
    signal.throwIfAborted();
    if (selected.providerId !== "openai") return;
    const identity = await accountIdentity(session.native.client, signal);
    if (session.binding.accountIdentity && session.binding.accountIdentity !== identity) {
      providerOwner.closeProvider(providerKey);
      throw new Error("This conversation belongs to another Codex account. Restore that account or start a new conversation.");
    }
    if (!session.binding.accountIdentity) await updateBinding({ accountIdentity: identity });
  }

  async function prepareConfiguration(configuration, context, signal, tools) {
    const { dynamicTools, toolSchemaIdentity } = codexApplicationToolConfiguration(tools);
    assertCodexApplicationToolSchemaIdentity(session.binding.threadId, session.binding.toolSchemaIdentity, toolSchemaIdentity);
    const selected = await selection(configuration, context, signal);
    await connect(signal, selected);
    const [configResult, hookResult] = await Promise.all([
      session.native.client.request("config/read", { cwd: session.binding.workdir, includeLayers: false }, { signal }),
      session.native.client.request("hooks/list", { cwds: [session.binding.workdir] }, { signal })
    ]);
    const toolConfiguration = codexToolFreeConfiguration({ configResult, hookResult, workdir: session.binding.workdir });
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
      toolConfiguration.hooks.PreToolUse = codexCommandHookDefinition(hookCommand);
      toolConfiguration.hooks.state[owned[0].key] = { enabled: true, trusted_hash: owned[0].currentHash };
    }
    if (nativeTools) {
      Object.assign(toolConfiguration.features, { shell_tool: true, unified_exec: true, view_image: true });
      toolConfiguration.include_environment_context = true;
      toolConfiguration.include_permissions_instructions = true;
      toolConfiguration.tools.update_plan.enabled = true;
      toolConfiguration.shell_environment_policy.set = Object.fromEntries(Object.entries(env).filter(([name, value]) =>
        typeof value === "string" && !CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES.has(name)));
      toolConfiguration.web_search = selected.config?.web_search || "disabled";
    }
    const params = { developerInstructions: configuration.systemPrompt,
      cwd: session.binding.workdir, modelProvider: selected.providerId, ...(selected.model ? { model: selected.model } : {}),
      dynamicTools, ...(!nativeTools ? { environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [] } : {}),
      approvalPolicy: "never", sandbox: nativeTools ? "danger-full-access" : "read-only", allowProviderModelFallback: false,
      config: { ...selected.config, ...toolConfiguration }
    };
    // Cold control recovery uses the provider's original settings facilities;
    // it must not resume with ambient defaults or an old instruction prompt.
    session.preparedThreadSettings = params;
    return { selected, params, toolSchemaIdentity };
  }

  async function prepare(configuration, context, signal, tools) {
    const { selected, params, toolSchemaIdentity } = await prepareConfiguration(configuration, context, signal, tools);
    const retainedThreadId = session.binding.threadId;
    const prepared = await ensureCodexAppServerThread({
      provider: session.native, workdir: session.binding.workdir,
      observeThread: threadId => owner.subscribeEvents(sessionId, session.native, threadId, { providerKey }),
      settings: async () => ({ threadSettings: params, threadStartSettings: params }),
      identity: { read: () => retainedThreadId,
        async write({ threadId }) { await updateBinding({ threadId, toolSchemaIdentity }); } }
    });
    if (!retainedThreadId && prepared.thread.raw?.historyMode !== "paginated") {
      throw new Error("Codex did not create the required paginated history. Update Codex before starting this conversation.");
    }
    owner.subscribeEvents(sessionId, session.native, prepared.threadId, { providerKey });
    return { ...selected, resumeOptions: params };
  }

  return Object.freeze({
    stop,
    selection,
    connect,
    prepareConfiguration,
    prepare
  });
}
