import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { bindClaudeConversationAccount, claudeFlagSettings, claudeModelConfiguration, readClaudeCodeAuthStatus } from "../claudeProcess.js";
import { nativeAiModel, nativeAiProvider } from "../../../shared/nativeProviders.js";
import { requireClaudeSessionId, listClaudeConversationStorage } from "../claudeHistory.js";
import { createClaudeConversationOwner, claudeNativeMessageId } from "../claudeTurn.js";
import { createLocalConversationExecution } from "../localExecution.js";
import { validateConversationConfiguration, validateConnectionModel } from "../configuration.js";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nativeInput = input => input.content?.length ? [...(input.text ? [{ type: "text", text: input.text }] : []),
  ...input.content.map(part => part.type === "text" ? part : { type: "image",
    source: { type: "base64", media_type: part.mediaType, data: part.image.toString("base64") } })] : input.text;
const claudeGoalValue = (goal, conversationId) => goal ? { ...goal,
  id: hash([conversationId, goal.createdAt, goal.objective]),
  ...(Number.isFinite(goal.createdAt) ? { createdAt: new Date(goal.createdAt * 1000).toISOString() } : {}),
  ...(Number.isFinite(goal.updatedAt) ? { updatedAt: new Date(goal.updatedAt * 1000).toISOString() } : {})
} : null;
const goalCapabilities = Object.freeze({ goals: true, goalBudgets: false,
  goalCommands: Object.freeze({
    set: Object.freeze({ delivery: "message", interruptsTurn: false }),
    resume: Object.freeze({ delivery: "message", interruptsTurn: false }),
    pause: Object.freeze({ delivery: "control", interruptsTurn: true }),
    cancel: Object.freeze({ delivery: "message", interruptsTurn: true })
  }) });

/** The ordinary native host uses the CLI's own login; no application launch callbacks. */
export function createClaudeConversationDriver({ connections, host = {}, limits = {} } = {}) {
  const env = { ...(host.env || process.env) };
  const workdir = path.resolve(host.workdir || process.cwd());
  const configRoot = path.resolve(workdir, env.CLAUDE_CONFIG_DIR || path.join(env.HOME || homedir(), ".claude"));
  if (env.CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = configRoot;
  const command = host.commands?.claude || "claude";
  const execution = host.execution || createLocalConversationExecution();
  const nativeTools = host.nativeTools === true;
  const pendingAccountStops = new Set();
  const maximumOutput = limits.maxOutputCharacters ?? 64_000;
  if (!Number.isSafeInteger(maximumOutput) || maximumOutput < 1) throw new TypeError("Invalid Claude output limit.");

  async function stopAccount(id) {
    pendingAccountStops.add(id);
    try {
      const proof = await execution.stop(id);
      if (!proof?.scopeEmpty) throw new Error("Claude account process cleanup could not be confirmed.");
      pendingAccountStops.delete(id);
    } catch (error) { error.cleanupFailed = true; throw error; }
  }

  async function captureAccountStatus({ command, args, cwd, baseEnv, signal, timeout, maxBuffer }) {
    signal.throwIfAborted();
    if (typeof host.execution?.run === "function") {
      return host.execution.run({ command, args, cwd, baseEnv, signal, timeout, maxBuffer,
        mode: "capture", limits: host.limits });
    }
    const native = await execution.start({ command, args, cwd, env: baseEnv, stream: true, limits: host.limits });
    const cancelled = Promise.withResolvers();
    const abort = () => cancelled.reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const result = (async () => {
      native.stdin.end();
      const chunks = [];
      let bytes = 0;
      for await (const chunk of native.stdout) {
        bytes += chunk.length;
        if (bytes > maxBuffer) throw new Error("Claude account status exceeded its size limit.");
        chunks.push(chunk);
      }
      const exit = await native.exited;
      return { ok: !exit.signal && exit.code === 0, exitCode: exit.code,
        signal: exit.signal, stdout: Buffer.concat(chunks).toString("utf8") };
    })();
    let timer;
    try {
      return await Promise.race([result, cancelled.promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Claude account status timed out.")), timeout);
      })]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      await stopAccount(native.id);
    }
  }

  async function accountIdentity(signal) {
    signal.throwIfAborted();
    for (const id of pendingAccountStops) await stopAccount(id);
    // Native API credentials already have an explicit identity. Never persist
    // credentials or include them in configuration returned to the browser.
    const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
    if (key) return hash([configRoot, env.ANTHROPIC_BASE_URL || "https://api.anthropic.com", key]);
    const account = await readClaudeCodeAuthStatus({ command, env,
      credentialHome: { home: env.HOME || homedir() }, commandRunner: captureAccountStatus, signal });
    signal.throwIfAborted();
    if (!account.loggedIn || !account.email) {
      throw new Error(account.error || "Sign in with claude auth login before using this conversation.");
    }
    return hash([configRoot, account.authMethod, account.email.toLowerCase()]);
  }

  let standalone;
  function standaloneOwner() {
    if (standalone) return standalone;
    const store = {
      read(context) { return JSON.stringify({ executionId: context.binding.executionId, sent: context.binding.sent }); },
      async save(entry, { execution = false } = {}) {
        if (execution) await entry.context.updateBinding({ executionId: entry.executionId });
      },
      async releaseExecution(entry) {
        await entry.context.updateBinding({ executionId: "" });
        entry.executionId = "";
      }
    };
    standalone = createClaudeConversationOwner({ configRoot, store,
      preparation: {
        async configuration(entry, { configuration, context, signal, tools }) {
          const { selected, identity } = await bindAccount(entry, configuration, context, signal);
          const settings = claudeFlagSettings({ effort: configuration.effort, providerEnv: selected.env });
          return { systemPrompt: configuration.systemPrompt, instructionMode: "replace",
            model: selected.model, settings, external: Boolean(configuration.integrationId),
            contextIdentity: JSON.stringify([configuration, identity, Boolean(tools)]),
            liveUpdateIdentity: JSON.stringify([Boolean(tools), configuration.outputSchema ?? null]),
            outputSchema: configuration.outputSchema };
        },
        message: (_entry, input) => nativeInput(input)
      },
      process: {
        stopExecution: (id, options) => execution.stop(id, options),
        configure(entry, { instructionArguments, model, settings, external, outputSchema }) {
          return { execution, command, env, model: external ? "" : model,
            settings: claudeFlagSettings(), effort: settings.effortLevel || "", instructionArguments,
            toolFree: !nativeTools, isolated: true, permissionMode: nativeTools ? "bypassPermissions" : undefined, outputSchema,
            commandWrapper: host.commandWrapper, applicationTools: Boolean(entry.command.tools),
            executionLimits: host.limits, signal: entry.command.signal };
        }
      },
      async onEvent(entry, event) {
        if (event.type === "save") return store.save(entry);
        if (event.type === "binding-admitted") {
          await entry.context.updateBinding({ sent: true });
          entry.sent = true;
          return;
        }
        const current = entry.command;
        if (!current) return;
        if (event.type === "message") await current.onMessage({ ...event.message, transient: !event.message.complete });
        else if (event.type === "message-complete") await current.onEvent(event);
        else if ((event.type === "admitted" && current.goal) || event.type === "settled") {
          await current.onEvent({ type: "goal", goal: claudeGoalValue(await entry.goals.read(), entry.id) });
        } else if (event.type === "phase") await current.onEvent({ type: "phase", phase: event.phase === "compacting" ? "compacting" : "working" });
      }
    });
    return standalone;
  }

  async function bindAccount(entry, configuration, context, signal = AbortSignal.timeout(30_000), requireBound = false, receiptBinding) {
    const accountBinding = requireBound ? receiptBinding : entry.context.binding;
    let selected;
    let providerId;
    let identity;
    if (configuration.integrationId) {
      const connection = await connections.resolve({ context, integrationId: configuration.integrationId });
      signal.throwIfAborted();
      providerId = connection.providerId;
      if (requireBound && !accountBinding?.connectionIdentities?.[providerId]) {
        throw new Error("The completed Claude response has no saved provider account fingerprint.");
      }
      const provider = nativeAiProvider(providerId);
      const model = nativeAiModel(connection.model, providerId);
      if (providerId !== "anthropic" && (!provider || !model)) throw new Error("This exact provider/model is not supported by the Claude integration. Choose a supported model without renaming it.");
      validateConnectionModel(configuration, connection);
      if (model && configuration.effort && !model.variants.includes(configuration.effort)) throw new Error("The selected Claude model does not support this reasoning effort.");
      selected = claudeModelConfiguration({ providerId, model: connection.model }, {
        apiKey: connection.apiKey, baseUrl: provider?.claudeBaseUrl || connection.baseURL || "https://api.anthropic.com"
      });
      identity = hash([configRoot, providerId, selected.env.ANTHROPIC_BASE_URL, connection.apiKey]);
    } else {
      if (requireBound && !accountBinding?.accountIdentity) {
        throw new Error("The completed Claude response has no saved native account fingerprint.");
      }
      identity = await accountIdentity(signal);
      selected = claudeModelConfiguration({ providerId: "anthropic", model: configuration.model || "default" });
      // Returning to the native host clears connection overrides, while
      // retaining explicitly supplied standalone host credentials/routing.
      for (const name of Object.keys(selected.env)) if (Object.hasOwn(env, name)) selected.env[name] = env[name];
    }
    signal.throwIfAborted();
    const previous = providerId ? accountBinding.connectionIdentities?.[providerId] : accountBinding.accountIdentity;
    const cached = providerId ? entry.context.binding.connectionIdentities?.[providerId] : entry.context.binding.accountIdentity;
    if (requireBound && previous !== cached) {
      throw new Error("The completed Claude response no longer matches its saved account fingerprint.");
    }
    if (requireBound && identity !== previous) {
      throw new Error("The completed Claude response belongs to a different account or provider connection.");
    }
    await bindClaudeConversationAccount({ accountIdentity: previous,
      accountIdentities: { [providerId || "anthropic"]: previous }
    }, { identity, providerId: providerId || "anthropic",
      stop: (_entry, reason) => entry.nativeTurn.stopProcess(reason),
      save: account => entry.context.updateBinding(providerId
        ? { connectionIdentities: { ...entry.context.binding.connectionIdentities, [providerId]: account.accountIdentity } }
        : { accountIdentity: account.accountIdentity })
    });
    return { selected, identity };
  }

  async function disposeNative({ native, options }) {
    const prepared = native.preparation.cleanup(options);
    return native.owner.closeSession(prepared.context, prepared.application);
  }

  return Object.freeze({
    admissionBeforeDispatch: false,
    toolDiscovery: true,
    attachmentTypes: ["text", "image"],
    capabilities: Object.freeze({ streaming: true, cancellation: true, instructions: true,
      configuration: true, history: true, steering: true, ...goalCapabilities,
      attachments: true, tools: true, nativeTools, structuredOutput: true }),
    validateConfiguration(configuration) {
      validateConversationConfiguration(configuration, { engine: "Claude", connections, efforts: ["low", "medium", "high", "xhigh", "max"],
        structuredOutput: true, maxOutputCharacters: maximumOutput });
    },
    async readState({ conversation, context, representation }) {
      let nativeResult = null;
      if (representation === "native" || context) {
        const { owner } = conversation.native;
        const entry = await owner.acquire(context);
        nativeResult = { ok: true, thread: { id: entry.id }, turn: owner.snapshot(entry), workdir: entry.context.workdir };
      }
      return conversation.read(context, representation, nativeResult);
    },
    inspectTemporaryActivity({ native, context }) {
      return native.owner.hasActiveTemporaryConversation(context, { acquire: native.owner.acquire });
    },
    releaseRenewalPredecessorProcessExitProof({ native, context }) {
      return native.owner.closeSession(context, native.application);
    },
    releaseRenewalSuccessorProcessExitProof({ native, context }) {
      return native.owner.closeSession(context, native.application);
    },
    async generateRenewalHandover({ native, input, context }) {
      const prepared = native.preparation.handover(input, context);
      const entry = await native.owner.acquire(context);
      const result = await native.owner.renewal(entry, prepared.input, prepared.options, { context, acquire: native.owner.acquire });
      return prepared.completeResult(result);
    },
    async seedRenewalHandover({ native, input, context }) {
      const prepared = native.preparation.seed(input, context);
      const entry = await native.owner.acquire(context);
      const result = await native.owner.renewal(entry, prepared.input, prepared.options, { context, acquire: native.owner.acquire });
      return prepared.completeResult(result);
    },
    async ensureConversation({ native, context }) {
      const entry = await native.owner.acquire(context);
      return native.owner.ensureReady(entry);
    },
    disposeNative,
    async interruptDetachedConversation({ native, input, context }) {
      const entry = await native.owner.acquire(context, input.conversationId || input.threadId,
        { cleanupExecutionId: input.cleanupExecutionId });
      return native.owner.stopConversation(entry);
    },
    async deleteDetachedConversation({ native, input, context }) {
      const entry = await native.owner.acquire(context, input.conversationId || input.threadId,
        { operation: "delete", input, cleanupExecutionId: input.cleanupExecutionId });
      return native.owner.deleteConversation(entry);
    },
    listConversationStorage({ native, binding }) {
      return listClaudeConversationStorage({ configRoot: native.configRoot, binding });
    },
    retireConversationHistory({ native, binding, context }) {
      return native.owner.retireConversationHistory(native.preparation.retirement(binding, context));
    },
    closeProject({ native, input }) {
      return native.owner.closeProject(input, native.application);
    },
    invalidateRuntimes({ native, input }) {
      return native.owner.invalidateRuntimes(input, native.application, native.account);
    },
    reconcileSessions({ native, sessions, options }) {
      return native.owner.reconcileSessions(sessions, options, native.application);
    },
    async createConversation({ native, input, context }) {
      return native.owner.createConversation(input, { context, acquire: native.owner.acquire });
    },
    async runDetachedConversation({ native, input, context }) {
      const conversationId = input.conversationId || input.threadId || randomUUID();
      const created = !input.conversationId && !input.threadId;
      const { owner } = native;
      const entry = await owner.acquire(context, conversationId, { create: created });
      const executionProfile = native.executionProfile;
      if (created && context.assistantScope) entry.profile = executionProfile;
      if (executionProfile) await context.onEvent?.({ type: "execution-profile", executionProfile });
      const request = { ...input, conversationId };
      await owner.startTurn(await owner.acquire(context, conversationId, { operation: "start", input: request }), request);
      const result = await owner.wait(await owner.acquire(context, conversationId), request, { context, acquire: owner.acquire });
      return executionProfile ? { ...result, executionProfile } : result;
    },
    async createBinding() {
      return { conversationId: randomUUID(), workdir: await realpath(workdir), configRoot, executionId: "", sent: false };
    },
    async open({ binding, writeBinding, onFailure: reportFailure, conversation }) {
      const supplied = conversation?.native;
      const scoped = supplied?.scoped;
      let owner = supplied?.owner;
      let entry;
      if (!supplied) {
        requireClaudeSessionId(binding?.conversationId);
        const scopeWorkdir = await realpath(workdir);
        // Original scoped conversations keep native history in the credential
        // home. Both paths must still come from the current authorized host.
        const nativeWorkdir = Object.hasOwn(binding, "scopeWorkdir")
          ? await realpath(env.HOME || homedir()) : scopeWorkdir;
        if (binding.workdir !== nativeWorkdir || binding.configRoot !== configRoot ||
          (Object.hasOwn(binding, "scopeWorkdir") && binding.scopeWorkdir !== scopeWorkdir)) {
          throw new Error("This Claude conversation belongs to another working directory or credential home. Restore its original host configuration.");
        }
        owner = standaloneOwner();
        const context = { key: scopeWorkdir, workdir: binding.workdir, binding, reportFailure,
          async updateBinding(patch) {
            const next = { ...context.binding, ...patch };
            await writeBinding(next);
            context.binding = next;
          }
        };
        entry = await owner.open(context, { conversationId: binding.conversationId, mainId: binding.conversationId, create: true });
        // An unknown execution is never reclaimed by PID or silently abandoned.
        // Managed hosts can prove cleanup using their durable execution identity.
        if (binding.executionId) await entry.nativeTurn.stopProcess("The application reconnected to this conversation.");
      }
      const acquire = supplied ? owner.acquire : (() => entry);
      const control = { current: null, disposed: false, cleanupFailure: null };
      const commandOptions = { acquire, reportFailure, entry,
        maximumOutput, maximumToolCalls: limits.maxToolCalls ?? 32, timeoutMs: limits.admissionTimeoutMs };
      const scopedInput = (input = {}) => {
        if (input.conversationId && String(input.conversationId).trim() !== scoped.conversationId) {
          throw new TypeError("This operation belongs to a different scoped conversation.");
        }
        return { ...input, conversationId: scoped.conversationId };
      };
      const unsupported = () => { throw Object.assign(new Error("This original scoped conversation has no canonical message or goal receipt."), {
        code: "conversation_unsupported"
      }); };
      return Object.freeze({
        ...(scoped ? { capabilities: Object.freeze({ streaming: false, instructions: false, configuration: false,
          goals: false, goalBudgets: false, goalCommands: Object.freeze({}), attachments: false, tools: false, nativeTools: false }),
          async sendNative({ input, context }) {
            input = scopedInput(input);
            return owner.startTurn(await acquire(context, input.conversationId, { operation: "start", input }), input);
          },
          async readNative({ input, context }) {
            input = scopedInput(input);
            return owner.read(await acquire(context, input.conversationId), input);
          },
          async waitNative({ input, context }) {
            input = scopedInput(input);
            return owner.wait(await acquire(context, input.conversationId), input, { context, acquire });
          }
        } : {}),
        ...(supplied && !scoped ? {
          publishNative: event => conversation.publish({ ...event, goalChanged: event.reason === "claude-goal" })
        } : {}),
        async readGoal({ configuration, context }) {
          if (scoped) return unsupported();
          if (supplied) {
            await acquire(context);
            const completeResult = supplied.completeResult?.(context);
            const nativeResult = await owner.readGoal(await acquire(context));
            await completeResult?.(nativeResult, {
              segmentId: nativeResult.threadId ? `claude:${nativeResult.threadId}` : null, capabilities: goalCapabilities
            });
            return { nativeResult, goal: claudeGoalValue(nativeResult.goal, nativeResult.threadId) };
          }
          await bindAccount(entry, configuration, context);
          return claudeGoalValue(await entry.goals.read(), entry.id);
        },
        async updateGoal({ configuration, context, input, representation, interrupt, send }) {
          if (scoped) return unsupported();
          if (supplied) {
            await acquire(context);
            const completeResult = supplied.completeResult?.(context);
            let command = input;
            let facilities;
            if (representation !== "native") {
              const current = await owner.readGoal(await acquire(context));
              if (input.action !== "set" && claudeGoalValue(current.goal, current.threadId)?.id !== input.expectedGoalId) {
                throw new Error("The Claude goal changed. Refresh before trying again.");
              }
              command = { ...input, threadId: current.threadId,
                ...(input.action !== "set" ? { createdAt: current.goal.createdAt, objective: current.goal.objective } : {}) };
              facilities = { interrupt, send: command => send(command, { threadId: current.threadId }) };
            }
            const nativeResult = await owner.updateGoal(await acquire(context), command, facilities);
            await completeResult?.(nativeResult);
            return { nativeResult, goal: claudeGoalValue(nativeResult.goal, nativeResult.threadId) };
          }
          await bindAccount(entry, configuration, context);
          const goal = await entry.goals.read();
          if (input.action !== "set" && claudeGoalValue(goal, entry.id)?.id !== input.expectedGoalId) {
            throw new Error("The Claude goal changed. Refresh before trying again.");
          }
          await entry.goals.update({ ...input, threadId: entry.id,
            ...(input.action !== "set" ? { createdAt: goal?.createdAt, objective: goal?.objective } : {}) }, { interrupt, send });
          return claudeGoalValue(await entry.goals.read(), entry.id);
        },
        async inspectAdmission({ context, representation, verifyAccount = false, ...input }) {
          if (scoped) return unsupported();
          if (supplied) {
            await acquire(context);
            const result = await owner.inspectAdmission(await acquire(context), input);
            return representation === "native" ? result : { accepted: result.admission === "accepted" };
          }
          if (verifyAccount === true) {
            const binding = input.receiptBinding;
            if (input.threadId !== entry.id || binding?.conversationId !== entry.id ||
                binding.workdir !== entry.context.binding.workdir || binding.configRoot !== configRoot ||
                Object.hasOwn(binding, "scopeWorkdir") !== Object.hasOwn(entry.context.binding, "scopeWorkdir") ||
                binding.scopeWorkdir !== entry.context.binding.scopeWorkdir) {
              throw new Error("The completed Claude response belongs to a different native conversation or host scope.");
            }
            await bindAccount(entry, input.configuration, context, AbortSignal.timeout(30_000), true, binding);
          }
          const history = await owner.readHistory(entry);
          const nativeId = claudeNativeMessageId(input.messageId);
          return { accepted: history.userIds.includes(nativeId),
            messages: history.messages.filter(message => message.userId === nativeId) };
        },
        steer: command => owner.steer(control, command, commandOptions),
        async run(command) {
          if (entry && (entry.disposed || entry.command)) throw new Error("This Claude conversation is closed or already working.");
          return owner.run(control, command, commandOptions);
        },
        async cancel({ input, context, representation } = {}) {
          if (scoped) {
            input = scopedInput(input);
            return owner.stopConversation(await acquire(context, input.conversationId, { cleanupExecutionId: input.cleanupExecutionId }));
          }
          if (!supplied) for (const id of pendingAccountStops) await stopAccount(id);
          const value = await owner.cancel(control, { context, acquire, reportFailure, entry });
          return supplied && representation === "native" ? { value } : value;
        },
        async dispose(options) {
          try {
            let result;
            if (scoped && options) {
              const input = scopedInput(options.input);
              result = await owner.deleteConversation(await acquire(options.context, input.conversationId, {
                operation: "delete", input, cleanupExecutionId: input.cleanupExecutionId }));
            } else if (supplied) {
              result = await disposeNative({ native: supplied, options: scoped ? scoped.context : options });
              if (result?.ok === false) throw Object.assign(new Error(result.error || (scoped ? "Scoped cleanup could not be confirmed." : "Claude cleanup could not be confirmed.")), result);
            } else {
              await entry.nativeTurn.whenIdle().catch(() => {});
              for (const id of pendingAccountStops) await stopAccount(id);
              await owner.close(entry);
            }
            control.disposed = true;
            return result;
          } catch (error) {
            if (supplied && !scoped) {
              error.cleanupFailed = true;
              control.current?.failure.reject(error);
            }
            throw error;
          }
        }
      });
    }
  });
}
