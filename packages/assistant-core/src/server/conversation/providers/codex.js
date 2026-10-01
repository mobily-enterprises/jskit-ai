import { createHash } from "node:crypto";

const INSTRUCTION_REVISION_ENV = "JSKIT_CONVERSATION_INSTRUCTIONS";

/** Codex native context restoration; host callbacks own resources and access. */
export function createCodexConversationAdapter(host) {
  const bindings = new Map();
  // Losing a control binding does not erase an acknowledged prompt. Keeping
  // that acknowledgement avoids reinjecting it after unrelated control failures.
  const instructionPrompts = new Map();
  const tasks = new Map();
  const goalChanges = new Map();
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
  async function withThreadContext(threadId, params, operation) {
    const previous = tasks.get(threadId) || Promise.resolve();
    const task = previous.catch(() => null).then(() => host.runRequest(async () => {
      const client = await host.client();
      params = await prepareInstructions(params, threadId);
      const generation = contextGeneration;
      const signal = AbortSignal.timeout(host.timeoutMs || 10_000);
      const assertRecoveryOpen = () => {
        signal.throwIfAborted();
        if (generation !== contextGeneration) {
          throw new Error("The assistant connection closed during recovery.");
        }
      };
      const request = (method, input) => {
        assertRecoveryOpen();
        return client.request(method, input, { signal });
      };
      const bound = bindings.get(threadId);
      const fixedPolicy = params.config?.shell_environment_policy ||
        (bound?.managed === false ? bound.params.config.shell_environment_policy : null);
      if (fixedPolicy && (params.developerInstructions == null || params.ephemeral || bound?.params.ephemeral)) {
        if (bound && params.developerInstructions != null && instructionPrompts.get(threadId) !== params.developerInstructions) {
          throw new Error("Start a new ephemeral conversation to change its instructions.");
        }
        return operation(threadParameters({ ...bound?.params, ...params }, {}));
      }
      const environment = instructionEnvironment(params, fixedPolicy?.set || await host.prepareEnvironment(
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
      const nativeStatus = await readStatus();
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
        const { goal } = await request("thread/goal/get", { threadId });
        if (!["idle", "notLoaded"].includes(nativeStatus) || goal && !["complete", "completed"].includes(goal.status)) {
          throw Object.assign(new Error("Stop the current turn and finish or clear its goal before changing model providers."), {
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
      const bindingMatches = !providerChanged && bound?.client === client &&
        bound.params.developerInstructions === requestParams.developerInstructions &&
        bound.params.config.openai_base_url === requestParams.config.openai_base_url &&
        JSON.stringify(bound.params.config.model_providers) === JSON.stringify(requestParams.config.model_providers) &&
        Object.keys(requestParams.config).filter((key) => key.startsWith("model_providers.")).every((key) =>
          JSON.stringify(bound.params.config[key]) === JSON.stringify(requestParams.config[key])) &&
        JSON.stringify(bound.params.config.shell_environment_policy) === JSON.stringify(requestParams.config.shell_environment_policy);
      const instructionsChanged = requestParams.developerInstructions != null &&
        instructionPrompts.get(threadId) !== requestParams.developerInstructions;
      let pausedGoal = null;
      let resumed = null;
      const goalChange = goalChanges.get(threadId);
      const isSamePausedGoal = (goal, original) => goal?.status === "paused" &&
        goal.createdAt === original.createdAt && goal.objective === original.objective;
      const log = (event, fields = {}) => host.log?.(event, fields, { threadId, environment });
      try {
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
              const page = await request("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "summary" });
              const turnId = page.data?.[0]?.id;
              if (!turnId) throw new Error("Codex's running turn could not be identified for control recovery.");
              await request("turn/interrupt", { threadId, turnId });
              while (await readStatus() !== "idle") {
                signal.throwIfAborted();
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
            }
            if (pausedGoal) {
              const { goal } = await request("thread/goal/get", { threadId });
              pausedGoal = isSamePausedGoal(goal, pausedGoal) ? goal : null;
            }
            const detached = await request("thread/unsubscribe", { threadId });
            if (!["unsubscribed", "notSubscribed", "notLoaded"].includes(detached?.status)) {
              throw new Error("Codex did not confirm detachment before control recovery.");
            }
          }
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
      // Never retry the caller's operation: its outcome may already be durable.
      assertRecoveryOpen();
      const result = await operation(requestParams, resumed);
      if (pausedGoal && goalChanges.get(threadId) === goalChange) {
        const { goal } = await request("thread/goal/get", { threadId });
        if (isSamePausedGoal(goal, pausedGoal) && goal.updatedAt === pausedGoal.updatedAt) {
          await request("thread/goal/set", { threadId, status: "active" });
        }
      }
      return result;
    }, "codex-app-server-thread-controls"));
    tasks.set(threadId, task);
    try {
      return await task;
    } finally {
      if (tasks.get(threadId) === task) tasks.delete(threadId);
    }
  }

  return Object.freeze({
    prepareInstructions,
    threadParameters,
    withThreadContext,
    registerThread(id, binding) {
      bindings.set(id, binding);
      if (binding.params.developerInstructions != null) instructionPrompts.set(id, binding.params.developerInstructions);
    },
    goalChanged: (id) => goalChanges.set(id, (goalChanges.get(id) || 0) + 1),
    get bindingCount() { return bindings.size; },
    close() { contextGeneration += 1; bindings.clear(); instructionPrompts.clear(); }
  });
}
