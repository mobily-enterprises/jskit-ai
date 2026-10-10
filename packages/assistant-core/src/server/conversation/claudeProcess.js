import { createHash } from "node:crypto";
import { nativeAiProvider } from "../../shared/nativeProviders.js";
import { Duplex } from "node:stream";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createClaudeJsonClient } from "./claudeClient.js";
import { createLocalConversationExecution } from "./localExecution.js";
import { CLAUDE_APPLICATION_TOOL_SERVER } from "./claudeTools.js";
import { nativeCommandHook, validateCommandWrapper } from "./commandWrapper.js";

const statusReads = new WeakMap();

export async function readClaudeCodeAuthStatus({
  env = process.env, credentialHome = { home: env.HOME || homedir() }, command = "claude", commandRunner, signal
} = {}) {
  if (credentialHome?.ok === false) return { loggedIn: false, error: credentialHome.error };
  if (typeof commandRunner !== "function") throw new TypeError("Claude account status requires its host capture runner.");
  const configRoot = env.CLAUDE_CONFIG_DIR || path.join(credentialHome.home, ".claude");
  // Inspect file metadata only. Claude still owns reading and validating credentials.
  const revisions = await Promise.all([
    path.join(configRoot, ".credentials.json"), path.join(configRoot, ".claude.json"),
    path.join(credentialHome.home, ".claude.json")
  ].map(async (file) => {
    try {
      const value = await stat(file, { bigint: true });
      return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }));
  let reads = statusReads.get(commandRunner);
  if (!reads) statusReads.set(commandRunner, reads = new Map());
  const key = JSON.stringify([command, env, credentialHome]);
  const revision = JSON.stringify(revisions);
  const previous = reads.get(key);
  if (previous?.revision === revision && (previous.pending || previous.expiresAt > Date.now())) return previous.value;
  const entry = { revision, pending: true, expiresAt: 0 };
  reads.set(key, entry);
  entry.value = readNativeClaudeCodeAuthStatus({ env, credentialHome, command, commandRunner, signal }).then((status) => {
    // Keychain changes cannot be observed with file metadata on macOS.
    if (!status.error && process.platform !== "darwin") entry.expiresAt = Date.now() + 30_000;
    return Object.freeze(status);
  }).finally(() => { entry.pending = false; });
  return entry.value;
}

async function readNativeClaudeCodeAuthStatus({ env, credentialHome, command, commandRunner, signal }) {
  const result = await commandRunner({
    command, args: ["auth", "status", "--json"], baseEnv: env,
    credentialHome, cwd: credentialHome.home, mode: "capture",
    timeout: 30_000, maxBuffer: 64 * 1024, ...(signal ? { signal } : {})
  });
  const failure = { loggedIn: false, error: result.error || "Claude Code is not connected." };
  if (!result.ok && (result.exitCode !== 1 || result.timedOut || result.signal)) return failure;
  try {
    const status = JSON.parse(result.stdout || result.output);
    // Native auth status exits 1 for a normal signed-out JSON response.
    if (!result.ok && status?.loggedIn !== false) return failure;
    if (typeof status?.loggedIn !== "boolean") throw new Error("Invalid account status.");
    return { loggedIn: status.loggedIn === true, email: String(status.email || ""),
      authMethod: String(status.authMethod || ""), subscriptionType: String(status.subscriptionType || "") };
  } catch {
    return result.ok ? { loggedIn: false, error: "Claude Code returned an invalid account status." } : failure;
  }
}

/** Exact existing native connection pin, shared with stopped metadata conversion. */
export function claudeConnectionIdentity(configRoot, providerId, baseUrl, apiKey) {
  return createHash("sha256").update(JSON.stringify([configRoot, providerId, baseUrl, apiKey])).digest("hex");
}

/** Native provider routing; the application supplies only its authorized selection. */
export function claudeModelConfiguration({ providerId, model: modelId }, connection) {
  const provider = nativeAiProvider(providerId);
  const definition = provider?.models.find(({ id }) => id === modelId);
  if (provider && (!definition || !connection?.apiKey)) throw new Error("Choose a connected Claude Code model.");
  const model = definition?.contextWindow >= 1000000 ? `${definition.id}[1m]` : modelId;
  const externalModel = provider ? model : "";
  // Reset every provider override when returning to the native subscription.
  // Background calls and subagents must stay on the selected provider too.
  const env = {
    ANTHROPIC_BASE_URL: connection?.baseUrl || "https://api.anthropic.com",
    ANTHROPIC_AUTH_TOKEN: connection?.apiKey || "", ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "",
    ANTHROPIC_MODEL: externalModel, ANTHROPIC_DEFAULT_MODEL: externalModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: externalModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: externalModel,
    ANTHROPIC_DEFAULT_FABLE_MODEL: externalModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: definition?.id || "",
    CLAUDE_CODE_SUBAGENT_MODEL: definition?.id || "",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: provider ? String(provider.claudeAutoCompactWindow) : "",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: provider ? "1" : "",
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1"
  };
  return { model, env };
}

export async function verifyClaudeProviderKey(provider, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${provider.claudeBaseUrl}/v1/messages`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: provider.models[0].id, max_tokens: 64,
        messages: [{ role: "user", content: "Reply with OK." }] })
    });
  } catch {
    throw new Error(`${provider.label} could not be reached through Claude Code. Your previous connection is unchanged; try again.`);
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(response.status === 401 || response.status === 403
      ? `${provider.label} rejected this key. Check the key and the required account plan.`
      : `${provider.label} could not complete a Claude Code test request (HTTP ${response.status}). Check your plan or API credit.`);
  }
  const result = await response.json().catch(() => null);
  if (!result?.id || result.type !== "message" || result.error || !Array.isArray(result.content)) {
    throw new Error(`${provider.label} did not return a usable Messages API result. The key was not saved.`);
  }
}

export function claudeFlagSettings({ effort = "", providerEnv, hooks, commandHook } = {}) {
  const nativeHooks = commandHook ? {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", timeout: commandHook.timeout, command: commandHook.command }] }]
  } : hooks;
  return { fallbackModel: [], effortLevel: effort || null,
    ...(nativeHooks ? { hooks: nativeHooks } : {}),
    ...(providerEnv ? { env: providerEnv } : {}) };
}

export function claudeCodeArguments({
  sessionId, resume = false, model = "", effort = "", toolFree = false, applicationTools = false,
  outputSchema, terminal = false, instructionArguments = [], permissionMode, isolated = false,
  settings = { fallbackModel: [] }
} = {}) {
  const args = terminal ? [] : ["--print", "--input-format", "stream-json", "--output-format", "stream-json",
    "--verbose", "--include-partial-messages", "--replay-user-messages", "--thinking-display", "summarized"];
  if (sessionId) args.push(resume ? "--resume" : "--session-id", sessionId);
  args.push(...instructionArguments);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (toolFree) {
    args.push("--restricted", "--tools", "", "--settings", '{"fallbackModel":[]}');
    if (applicationTools) args.push("--allowedTools", `mcp__${CLAUDE_APPLICATION_TOOL_SERVER}__*`, "--permission-mode", "dontAsk");
  } else {
    if (permissionMode) args.push("--permission-mode", permissionMode);
    args.push("--settings", JSON.stringify(settings));
  }
  if (toolFree || isolated) {
    args.push("--safe-mode", "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: applicationTools ? {
      [CLAUDE_APPLICATION_TOOL_SERVER]: { type: "sdk", name: CLAUDE_APPLICATION_TOOL_SERVER }
    } : {} }));
    if (!applicationTools) args.push("--disallowedTools", "mcp__*");
    if (!toolFree) args.push("--tools", "Bash,Read,Edit,Write,Glob,Grep,NotebookEdit");
  } else if (applicationTools) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: {
      [CLAUDE_APPLICATION_TOOL_SERVER]: { type: "sdk", name: CLAUDE_APPLICATION_TOOL_SERVER }
    } }));
  }
  if (outputSchema) args.push("--json-schema", JSON.stringify(outputSchema));
  return args;
}

export async function stopClaudeCodeProcess({ process: native, executionId, stopExecution }) {
  let proof = { scopeEmpty: true };
  if (native) {
    proof = await native.stop();
  } else if (executionId) {
    proof = await stopExecution(executionId, {
      allowMissingRecordScopeRecovery: true,
      reason: "claude-code-stop"
    });
  }
  if (proof.scopeEmpty !== true && proof.exited !== true) {
    throw Object.assign(new Error("Claude process cleanup could not be confirmed. Restore its execution host before continuing."), {
      code: "claude_stop_unconfirmed", stopProof: proof
    });
  }
  return { ...proof, exited: true };
}

export async function bindClaudeConversationAccount(entry, { identity, providerId, stop, save }) {
  entry.accountIdentities ||= {};
  if (!nativeAiProvider(providerId) && entry.accountIdentities[providerId] && entry.accountIdentities[providerId] !== identity) {
    await stop(entry, "The signed-in Claude account changed.");
    throw Object.assign(new Error("This conversation belongs to another Claude account. Reconnect that account or start a new session."), {
      code: "claude_account_changed"
    });
  }
  if (entry.accountIdentity !== identity) {
    entry.accountIdentity = identity;
    entry.accountIdentities[providerId] = identity;
    await save(entry);
  }
}

export function claudePlanUsage(value) {
  const windows = Object.entries(value.rate_limits || {}).flatMap(([id, window]) => {
    if (!window || !Number.isFinite(window.utilization) || !/^(five_hour|seven_day(?:_.*)?)$/u.test(id)) return [];
    const reset = window.resets_at ? Date.parse(window.resets_at) / 1000 : null;
    if (reset !== null && (!Number.isFinite(reset) || reset * 1000 <= Date.now())) return [];
    return [{ id, remainingPercent: Math.max(0, Math.min(100, 100 - window.utilization)),
      windowDurationMins: id === "five_hour" ? 300 : 10080, resetsAt: reset }];
  });
  return { status: !value.rate_limits_available ? "unsupported" : windows.length ? "available" : "unavailable",
    windows, checkedAt: Date.now() };
}

export function claudeCatalogueModels(initialization) {
  return (initialization.models || []).map((model) => ({
    id: model.value, label: model.displayName || model.value, description: model.description || "",
    status: "available", variants: (model.supportedEffortLevels || []).map((id) => ({
      id, label: id[0].toUpperCase() + id.slice(1)
    }))
  }));
}

/** Native account queries share process reuse, caches and retryable cleanup. */
export function createClaudeAccountQueries({ createProcess, accountIdentity, processes = () => [], isClosing = () => false }) {
  const error = message => Object.assign(new Error(message), { code: "claude_account_query_failed" });
  const accountProcessStops = new Set();
  let catalog;
  let catalogStart;
  let planUsage;
  let planUsagePending;

  async function stopAccountProcess(native) {
    accountProcessStops.add(native);
    if (!(await native.stop()).scopeEmpty) throw error("Claude account query process cleanup could not be confirmed.");
    accountProcessStops.delete(native);
  }

  async function readAccountProcess(identity, read) {
    if (isClosing()) throw error("Claude is reconnecting.");
    for (const native of accountProcessStops) await stopAccountProcess(native);
    const owned = [...processes()].find((entry) =>
      entry.process && !entry.stopping && entry.accountIdentity === identity);
    if (owned) return read(owned.process);
    const native = await createProcess();
    try {
      return await read(native);
    } finally {
      await stopAccountProcess(native);
    }
  }

  return Object.freeze({
    async readCatalogue(context) {
      if (isClosing()) throw error("Claude is reconnecting.");
      const identity = await accountIdentity(context);
      if (!catalog || catalog.identity !== identity || Date.now() - catalog.at > 600_000) {
        catalogStart ||= (async () => {
          const value = await readAccountProcess(identity, (native) => native.initialization);
          if (identity !== await accountIdentity(context)) throw error("The signed-in Claude account changed. Refresh the model list.");
          catalog = { at: Date.now(), identity, value };
        })().finally(() => { catalogStart = null; });
        await catalogStart;
      }
      return catalog.value;
    },
    async readPlanUsage(context) {
      const identity = await accountIdentity(context);
      if (planUsage?.identity === identity && Date.now() - planUsage.checkedAt < 60_000) return planUsage;
      if (planUsagePending) return planUsagePending;
      planUsagePending = (async () => {
        const value = await readAccountProcess(identity, (native) => native.client.request(
          { subtype: "get_usage", skip_behaviors: true }));
        if (identity !== await accountIdentity(context)) return { status: "unavailable", windows: [] };
        planUsage = { ...claudePlanUsage(value), identity };
        return planUsage;
      })().finally(() => { planUsagePending = null; });
      return planUsagePending;
    },
    invalidateUsage() { planUsage = null; },
    async invalidate() {
      await Promise.allSettled([catalogStart, planUsagePending]);
      catalog = null;
      planUsage = null;
      for (const native of accountProcessStops) await stopAccountProcess(native);
    }
  });
}

/** Native startup and handshake; an execution host owns processes and their identity. */
export async function createClaudeCodeProcess({
  command = "claude", execution = createLocalConversationExecution(), env = process.env,
  workdir, onEvent, onControlRequest, onFailure, onStarted, executionLimits, signal, commandWrapper, ...options
} = {}) {
  if (commandWrapper !== undefined) validateCommandWrapper(commandWrapper);
  const environment = { ...env, DISABLE_AUTOUPDATER: "1" };
  for (const name of ["DBUS_SESSION_BUS_ADDRESS", "DBUS_STARTER_ADDRESS", "DBUS_STARTER_BUS_TYPE",
    "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete environment[name];
  let native;
  let client;
  let stopped = false;
  let stopping;
  const abort = () => { void stop().catch(() => {}); };
  async function stop() {
    if (stopped) return { exited: true, scopeEmpty: true };
    if (stopping) return stopping;
    stopping = (async () => {
      client?.close();
      const proof = native ? await execution.stop(native.id) : { scopeEmpty: true };
      stopped = proof?.scopeEmpty === true;
      return { ...proof, exited: stopped };
    })().finally(() => { stopping = null; });
    return stopping;
  }
  try {
    signal?.throwIfAborted();
    native = await execution.start({ command, args: claudeCodeArguments(options), cwd: workdir,
      env: environment, stream: true, limits: executionLimits });
    await onStarted?.(native.id, stop);
    signal?.throwIfAborted();
    client = createClaudeJsonClient({ stream: Duplex.from({ readable: native.stdout, writable: native.stdin }), onEvent, onFailure,
      onControlRequest(request, context) {
        if (request.subtype === "hook_callback" && commandWrapper && request.callback_id === "jskit-command-wrapper") {
          return nativeCommandHook(commandWrapper, request.input);
        }
        if (!onControlRequest) throw new Error("This Claude control request has no owner.");
        return onControlRequest(request, context);
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    const initialization = await client.initialize(commandWrapper ? { hooks: {
      PreToolUse: [{ matcher: "^Bash$", hookCallbackIds: ["jskit-command-wrapper"], timeout: 30 }]
    } } : {});
    return { client, initialization, executionId: native.id, stop };
  } catch (error) {
    // A rejected start may already own an execution and its cleanup proof.
    // Only a returned native handle transfers that cleanup to this owner.
    if (native) {
      error.executionId = native.id;
      try { error.stopProof = await stop(); }
      catch (cleanupError) { error.cleanupError = cleanupError; error.stopProof = { scopeEmpty: false }; }
      if (error.stopProof?.scopeEmpty !== true) error.cleanupFailed = true;
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
