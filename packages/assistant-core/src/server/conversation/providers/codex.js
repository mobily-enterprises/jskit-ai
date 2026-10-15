import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const INSTRUCTION_REVISION_ENV = "JSKIT_CONVERSATION_INSTRUCTIONS";

/** Codex native context restoration; host callbacks own resources and access. */
export function createCodexConversationAdapter(host) {
  const bindings = new Map();
  // Losing a control binding does not erase an acknowledged prompt. Keeping
  // that acknowledgement avoids reinjecting it after unrelated control failures.
  const instructionPrompts = new Map();
  const tasks = new Map();
  const goalChanges = new Map();
  const settingsUpdates = new Map();
  const threadGenerations = new Map();
  let contextGeneration = 0;

  function instructionEnvironment(params, environment) {
    if (params.developerInstructions == null) return environment;
    return { ...environment, [INSTRUCTION_REVISION_ENV]: createHash("sha256").update(params.developerInstructions).digest("hex") };
  }

  function threadParameters(params, environment) {
    const result = host.threadParameters(params, environment);
    if (params.developerInstructions == null) return result;
    const policy = result.config?.shell_environment_policy || { inherit: "none", set: environment || {} };
    return { ...result, config: { ...result.config, shell_environment_policy: {
      ...policy, set: instructionEnvironment(params, policy.set || {})
    } } };
  }

  async function prepareInstructions({ systemPrompt, ...params }, threadId) {
    if (systemPrompt === undefined && params.developerInstructions != null) return params;
    const supplied = systemPrompt ?? await host.readInstructions?.(params, threadId);
    if (supplied === undefined || supplied === null) return params;
    if (typeof supplied !== "string" || !supplied.trim()) throw new TypeError("Codex instructions must contain text.");
    return { ...params, developerInstructions: supplied };
  }

  // A loaded native thread can ignore shell_environment_policy on resume.
  // Detaching alone is insufficient when another subscriber retains it: prove
  // the effective managed environment before recording a new binding.
  async function withThreadContext(threadId, params, operation, settings) {
    const threadGeneration = threadGenerations.get(threadId) || 0;
    const previous = tasks.get(threadId) || Promise.resolve();
    const task = previous.catch(() => null).then(() => host.runRequest(async () => {
      let pausedGoal = null;
      const goalChange = goalChanges.get(threadId);
      const isSamePausedGoal = (goal, original) => goal?.status === "paused" &&
        goal.createdAt === original.createdAt && goal.objective === original.objective;
      async function apply() {
        const client = await host.client();
        const generation = contextGeneration;
        const bound = bindings.get(threadId);
        let requestedSettings;
        if (settings) {
          settings.controller.signal.throwIfAborted();
          settings.client = client;
          if (!settings.prepared) {
            const request = (method, input) => client.request(method, input, {
              signal: AbortSignal.any([settings.controller.signal, AbortSignal.timeout(host.timeoutMs || 10_000)])
            });
            const { goal } = await request("thread/goal/get", { threadId });
            if (goal?.status === "active") {
              settings.goal = goal;
              const result = await request("thread/goal/set", { threadId, status: "paused" });
              pausedGoal = result.goal;
              if (!isSamePausedGoal(pausedGoal, goal)) throw new Error("Codex did not confirm the goal's scheduling pause.");
              settings.goal = pausedGoal;
            }
            for (;;) {
              const { thread } = await request("thread/read", { threadId, includeTurns: false });
              const status = typeof thread?.status === "string" ? thread.status : thread?.status?.type;
              if (["idle", "notLoaded"].includes(status)) break;
              if (status !== "active") throw new Error("Codex's current turn could not be observed before changing settings.");
              if (!settings.deferred) {
                settings.deferred = true;
                try { host.log?.("settings_deferred", {}, { threadId }); } catch { /* Diagnostics do not own scheduling. */ }
                settings.accepted.resolve({ ok: true, pending: true });
              }
              await delay(250, undefined, { signal: settings.controller.signal });
            }
            settings.prepared = true;
          }
          requestedSettings = settings.params;
          params = await host.prepareParameters?.(requestedSettings) || requestedSettings;
        }
        const requestedParams = params;
        const retainInstalledInstructions = bound?.params.developerInstructions != null && !params.ephemeral && !bound.params.ephemeral;
        params = await prepareInstructions(retainInstalledInstructions
          ? { ...params, systemPrompt: undefined, developerInstructions: bound.params.developerInstructions }
          : params, threadId);
        let signal = AbortSignal.timeout(host.timeoutMs || 10_000);
        const controlDeadline = performance.now() + (host.timeoutMs || 10_000);
        const assertRecoveryOpen = () => {
          signal.throwIfAborted();
          settings?.controller.signal.throwIfAborted();
          if (generation !== contextGeneration || threadGeneration !== (threadGenerations.get(threadId) || 0)) {
            throw new Error("The assistant connection closed during recovery.");
          }
        };
        const request = (method, input) => {
          assertRecoveryOpen();
          return client.request(method, input, { signal });
        };
        const fixedPolicy = params.config?.shell_environment_policy ||
          (bound?.managed === false ? bound.params.config.shell_environment_policy : null);
        if (!settings && fixedPolicy && (params.developerInstructions == null || params.ephemeral || bound?.params.ephemeral)) {
          if (bound && params.developerInstructions != null && instructionPrompts.get(threadId) !== params.developerInstructions) {
            throw new Error("Start a new ephemeral conversation to change its instructions.");
          }
          assertRecoveryOpen();
          return operation(threadParameters({ ...bound?.params, ...params }, {}));
        }
        let environment = instructionEnvironment(params, fixedPolicy?.set || await host.prepareEnvironment(
          bound?.params?.config?.shell_environment_policy?.set || host.environment || {}
        ));
        const previousConfig = { ...bound?.params?.config };
        if (params.modelProvider) {
          for (const key of Object.keys(previousConfig)) {
            if (key === "model_providers" || key === "model_catalog_json" || key === "web_search" || key === "openai_base_url" || key.startsWith("model_providers.")) delete previousConfig[key];
          }
        }
        let requestParams = {
          ...bound?.params,
          ...params,
          config: {
            ...previousConfig,
            ...params?.config,
            shell_environment_policy: { ...(fixedPolicy || { inherit: "none" }), set: environment }
          }
        };
        let nativeModelProvider = "";
        let nativeHistoryPath = "";
        const readStatus = async () => {
          const { thread } = await request("thread/read", { threadId, includeTurns: false });
          if (thread?.historyMode !== "paginated") {
            throw Object.assign(new Error("This conversation uses an unsupported Codex history format. Renew the session to keep your files and saved chat and start a fresh conversation. You can write the handover yourself."), {
              code: "assistant_codex_history_unsupported"
            });
          }
          nativeModelProvider = thread?.modelProvider || "";
          nativeHistoryPath = thread?.path || "";
          return typeof thread?.status === "string" ? thread.status : thread?.status?.type;
        };
        let nativeStatus = await readStatus();
        if (settings && nativeStatus === "active") {
          settings.prepared = false;
          return apply();
        }
        if (!bound && !requestParams.modelProvider && nativeModelProvider) {
          // A restored observer has no saved request parameters. Recover the
          // native thread's provider configuration before resuming its controls.
          requestParams = { ...requestParams, modelProvider: nativeModelProvider };
          requestParams = await host.prepareParameters?.(requestParams) || requestParams;
        }
        requestParams = await host.prepareHistory(requestParams, client, { signal, historyPath: nativeHistoryPath });
        const providerChanged = Boolean(requestParams.modelProvider && nativeModelProvider &&
          requestParams.modelProvider !== nativeModelProvider);
        if (providerChanged) {
          if (!["idle", "notLoaded"].includes(nativeStatus)) {
            throw Object.assign(new Error("Stop the current turn before immediately changing model providers."), {
              code: "assistant_codex_provider_switch_busy"
            });
          }
        }
        const executionId = String(host.runtime()?.executionId || "");
        // Refresh project hook trust only for a cold thread in a replacement
        // process. A new socket or a changed command environment is not evidence
        // that the provider process died.
        if (nativeStatus === "notLoaded" && executionId && bound?.executionId !== executionId) {
          requestParams = await host.prepareResume?.(threadId, requestParams, {
            runtime: host.runtime(),
            processChanged: Boolean(bound?.executionId)
          }) || requestParams;
        }
        let bindingMatches = !providerChanged && bound?.client === client &&
          bound.params.developerInstructions === requestParams.developerInstructions &&
          bound.params.config.openai_base_url === requestParams.config.openai_base_url &&
          JSON.stringify(bound.params.config.model_providers) === JSON.stringify(requestParams.config.model_providers) &&
          Object.keys(requestParams.config).filter((key) => key.startsWith("model_providers.")).every((key) =>
            JSON.stringify(bound.params.config[key]) === JSON.stringify(requestParams.config[key])) &&
          JSON.stringify(bound.params.config.shell_environment_policy) === JSON.stringify(requestParams.config.shell_environment_policy);
        const controlBindingMatches = bindingMatches;
        const installedRequestParams = requestParams;
        if (retainInstalledInstructions && (!bindingMatches || nativeStatus !== "active")) {
          // An active healthy turn keeps its installed prompt. Real control
          // recovery and the next idle admission still read current instructions.
          assertRecoveryOpen();
          const remainingControlMs = Math.floor(controlDeadline - performance.now());
          if (remainingControlMs <= 0) {
            throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
          }
          // Instruction composition preceded the control clock originally. Only
          // this deferred host read is excluded; spent native time is retained.
          params = await prepareInstructions(requestedParams, threadId);
          signal = AbortSignal.timeout(remainingControlMs);
          environment = instructionEnvironment(params, environment);
          requestParams = { ...requestParams,
            ...(Object.hasOwn(params, "developerInstructions") ? { developerInstructions: params.developerInstructions } : {}),
            config: { ...requestParams.config, shell_environment_policy: { ...requestParams.config.shell_environment_policy, set: environment } }
          };
          bindingMatches = bindingMatches && bound.params.developerInstructions === requestParams.developerInstructions &&
            JSON.stringify(bound.params.config.shell_environment_policy) === JSON.stringify(requestParams.config.shell_environment_policy);
        }
        const instructionOnly = retainInstalledInstructions && controlBindingMatches && !bindingMatches;
        let instructionsChanged = requestParams.developerInstructions != null &&
          instructionPrompts.get(threadId) !== requestParams.developerInstructions;
        let resumed = null;
        const log = (event, fields = {}) => host.log?.(event, fields, { threadId, environment });
        try {
          assertRecoveryOpen();
          if (instructionOnly) {
            // A native goal can start work while the host reads its prompt.
            nativeStatus = await readStatus();
            if (nativeStatus === "active") {
              requestParams = installedRequestParams;
              environment = requestParams.config.shell_environment_policy.set;
              bindingMatches = true;
              instructionsChanged = false;
            }
          }
          if (!bindingMatches || nativeStatus === "notLoaded") {
            log("reload_started", { reason: bound ? "control-environment-changed" : "unverified-thread-binding", nativeStatus });
            if (nativeStatus !== "notLoaded") {
              const { goal } = await request("thread/goal/get", { threadId });
              if (goal?.status === "active") {
                const result = await request("thread/goal/set", { threadId, status: "paused" });
                pausedGoal = result.goal;
                if (!isSamePausedGoal(pausedGoal, goal)) {
                  throw new Error("Codex did not confirm that the same goal stopped scheduling work.");
                }
              }
              if (await readStatus() !== "idle") {
                if (settings) {
                  settings.prepared = false;
                  return apply();
                } else if (instructionOnly) {
                  // Never interrupt work solely to refresh its instructions.
                  requestParams = installedRequestParams;
                  environment = requestParams.config.shell_environment_policy.set;
                  bindingMatches = true;
                  instructionsChanged = false;
                } else {
                  const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" });
                  const turnId = page.data?.[0]?.id;
                  if (!turnId) throw new Error("Codex's running turn could not be identified for control recovery.");
                  assertRecoveryOpen();
                  host.recordInterruption?.(threadId, turnId);
                  await request("turn/interrupt", { threadId, turnId });
                  while (await readStatus() !== "idle") {
                    signal.throwIfAborted();
                    await new Promise((resolve) => setTimeout(resolve, 25));
                  }
                }
              }
              if (pausedGoal) {
                const { goal } = await request("thread/goal/get", { threadId });
                pausedGoal = isSamePausedGoal(goal, pausedGoal) ? goal : null;
              }
              if (!bindingMatches) {
                const detached = await request("thread/unsubscribe", { threadId });
                if (!["unsubscribed", "notSubscribed", "notLoaded"].includes(detached?.status)) {
                  throw new Error("Codex did not confirm detachment before control recovery.");
                }
              }
            }
            if (!bindingMatches || nativeStatus === "notLoaded") {
              bindings.delete(threadId);
              await host.beforeResume?.(threadId);
              resumed = await request("thread/resume", { excludeTurns: true, ...requestParams, threadId });
              if (requestParams.modelProvider && resumed.modelProvider !== requestParams.modelProvider) {
                throw Object.assign(new Error("Another native subscriber retained the previous model provider. Close the native assistant terminal and retry."), {
                  code: "assistant_codex_provider_binding_retained"
                });
              }
              if (!["idle", "active"].includes(await readStatus())) throw new Error("Codex did not confirm the thread loaded.");
              if (nativeStatus !== "notLoaded") {
                await host.verifyEnvironment(threadId, environment, request, signal, {
                  requiredKeys: requestParams.developerInstructions == null ? [] : [INSTRUCTION_REVISION_ENV]
                });
              }
              const checked = fixedPolicy ? environment : instructionEnvironment(params, await host.prepareEnvironment(environment));
              if (JSON.stringify(checked) !== JSON.stringify(environment)) {
                throw new Error("Managed controls changed again during thread recovery.");
              }
              if (instructionsChanged) {
                // Resume config supplies the next compacted context, but existing
                // history retains its original developer message. A revision in
                // the developer lane makes this change effective before new work.
                // An unknown binding also needs restoration; ordinary turns and
                // socket reconnects with an acknowledged binding do not repeat it.
                await request("thread/inject_items", { threadId, items: [{ type: "message", role: "developer", content: [{
                  type: "input_text", text: "These are the current application instructions. They replace earlier application instructions; other instructions remain in effect.\n\n" + requestParams.developerInstructions
                }] }] });
                assertRecoveryOpen();
                instructionPrompts.set(threadId, requestParams.developerInstructions);
              }
              assertRecoveryOpen();
              bindings.set(threadId, { client, executionId, params: requestParams, managed: !fixedPolicy });
              log("ready");
            }
          }
        } catch (cause) {
          host.onRecoveryFailure?.(threadId);
          bindings.delete(threadId);
          log("recovery_failed", { code: cause?.code || "", reason: cause.message });
          throw Object.assign(new Error(["assistant_agent_control_binding_retained", "assistant_codex_provider_binding_retained"].includes(cause?.code)
            ? `${cause.message} Your conversation and work are preserved.`
            : "The assistant connection could not be verified. Your conversation and files are preserved. Retry the connection, or renew the session to continue in a fresh conversation.", { cause }), {
            code: "assistant_agent_control_recovery_failed", retryable: true
          });
        }
        // A newer settings save supersedes the older choice before scheduling
        // another turn. Ordinary caller operations are never retried.
        assertRecoveryOpen();
        if (settings && settings.params !== requestedSettings) return apply();
        const result = await operation(requestParams, resumed);
        if (settings && settings.params !== requestedSettings) return apply();
        if (pausedGoal && goalChanges.get(threadId) === goalChange) {
          const { goal } = await request("thread/goal/get", { threadId });
          if (settings && settings.params !== requestedSettings) return apply();
          if (goalChanges.get(threadId) === goalChange && isSamePausedGoal(goal, pausedGoal) && goal.updatedAt === pausedGoal.updatedAt) {
            await request("thread/goal/set", { threadId, status: "active" });
          }
        }
        if (settings && settings.params !== requestedSettings) {
          settings.prepared = false;
          return apply();
        }
        // Retire the completed update before yielding to its caller, so a new
        // save cannot attach itself to an operation that has already finished.
        if (settings && settingsUpdates.get(threadId) === settings) settingsUpdates.delete(threadId);
        return result;
      }
      return apply();
    }, "codex-app-server-thread-controls"));
    tasks.set(threadId, task);
    try {
      return await task;
    } finally {
      if (tasks.get(threadId) === task) tasks.delete(threadId);
    }
  }

  function scheduleSettings(threadId, params, operation) {
    const pending = settingsUpdates.get(threadId);
    if (pending) {
      pending.params = params;
      return pending.accepted.promise;
    }
    const accepted = Promise.withResolvers();
    const settings = { params, accepted, controller: new AbortController(),
      goalChange: goalChanges.get(threadId) };
    settingsUpdates.set(threadId, settings);
    const task = withThreadContext(threadId, params, operation, settings);
    void task.then(result => {
      try { host.log?.("settings_applied", { model: settings.params.model, modelProvider: settings.params.modelProvider }, { threadId }); } catch { /* Diagnostics do not own scheduling. */ }
      accepted.resolve(result);
    }, async error => {
      accepted.reject(error);
      try { host.log?.("settings_failed", { code: error.code || "native_settings_failed" }, { threadId }); } catch { /* Logging cannot own native cleanup. */ }
      // If a deferred reload fails, expose the actual paused goal for explicit
      // recovery. Never resume it speculatively or hide a user's later control.
      if (settingsUpdates.get(threadId) === settings) settingsUpdates.delete(threadId);
      if (!settings.controller.signal.aborted && settings.client?.isOpen?.()) {
        try {
          const { goal } = await settings.client.request("thread/goal/get", { threadId }, {
            signal: AbortSignal.timeout(host.timeoutMs || 10_000)
          });
          host.publishGoal?.(threadId, goal);
        } catch { /* Native observation owns disconnect failures. */ }
      }
    }).finally(() => {
      if (settingsUpdates.get(threadId) === settings) settingsUpdates.delete(threadId);
    });
    return accepted.promise;
  }

  function projectGoal(threadId, goal) {
    const pending = settingsUpdates.get(threadId);
    if (goal?.status === "paused" && pending?.goal && pending.goalChange === goalChanges.get(threadId) &&
        goal.createdAt === pending.goal.createdAt && goal.objective === pending.goal.objective &&
        (pending.goal.status === "active" || goal.updatedAt === pending.goal.updatedAt)) return { ...goal, status: "active" };
    return goal;
  }

  return Object.freeze({
    scheduleSettings,
    hasPendingSettings: id => settingsUpdates.has(id),
    projectGoal,
    prepareInstructions,
    threadParameters,
    withThreadContext,
    registerThread(id, binding) {
      bindings.set(id, binding);
      if (binding.params.developerInstructions != null) instructionPrompts.set(id, binding.params.developerInstructions);
    },
    invalidateThread(id) {
      settingsUpdates.get(id)?.controller.abort();
      settingsUpdates.delete(id);
      threadGenerations.set(id, (threadGenerations.get(id) || 0) + 1);
      bindings.delete(id);
    },
    goalChanged: (id) => goalChanges.set(id, (goalChanges.get(id) || 0) + 1),
    get bindingCount() { return bindings.size; },
    get threadEnvironments() { return bindings; },
    get threadEnvironmentTasks() { return tasks; },
    close() {
      contextGeneration += 1;
      for (const pending of settingsUpdates.values()) pending.controller.abort();
      settingsUpdates.clear();
      bindings.clear();
      instructionPrompts.clear();
    }
  });
}
