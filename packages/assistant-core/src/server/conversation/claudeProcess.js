import { jsonHash } from "./normalize.js";
import { nativeAiProvider } from "../../shared/nativeProviders.js";
import { Duplex } from "node:stream";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createClaudeJsonClient } from "./claudeClient.js";
import { createLocalConversationExecution } from "./localExecution.js";
import { CLAUDE_APPLICATION_TOOL_SERVER } from "./claudeTools.js";
import { nativeCommandHook, validateCommandWrapper } from "./commandWrapper.js";

const statusReads = new Map();
const STATUS_RETRY_MS = 30_000;
const CLAUDE_EXIT_WAIT_MS = 5_000;

/** Person-facing cause for a Claude process that ended without being stopped. */
export function claudeUnexpectedExitMessage(processExit = {}) {
  const resume = "The conversation so far is saved; send a message to continue.";
  if (Number(processExit?.taskLimit?.count) > 0) {
    return "Claude stopped unexpectedly: the server refused to create more processes or threads for it " +
      `(process/thread limit reached). ${resume}`;
  }
  if (processExit?.signal) return `Claude stopped unexpectedly: it was terminated by ${processExit.signal}. ${resume}`;
  if (Number.isInteger(processExit?.code)) {
    return `Claude stopped unexpectedly with exit code ${processExit.code}. ${resume}`;
  }
  return `Claude stopped unexpectedly. ${resume}`;
}

// A file's metadata, following links, or null when it is absent.
async function fileRevision(file) {
  try {
    const value = await stat(file, { bigint: true });
    return [value.dev, value.ino, value.size, value.mtimeNs].join(":");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readClaudeCodeAuthStatus({
  env = process.env, credentialHome = { home: env.HOME || homedir() }, command = "claude", commandRunner, signal
} = {}) {
  if (credentialHome?.ok === false) return { loggedIn: false, error: credentialHome.error };
  if (typeof commandRunner !== "function") throw new TypeError("Claude account status requires its host capture runner.");
  const configRoot = env.CLAUDE_CONFIG_DIR || path.join(credentialHome.home, ".claude");
  // Inspect file metadata only. Claude still owns reading and validating credentials.
  // Sign-in writes .credentials.json and sign-out removes it. Claude Code also
  // rewrites .claude.json during turns and after every status read, so that
  // file is not watched.
  const revision = await fileRevision(path.join(configRoot, ".credentials.json"));
  // One entry per account, whichever command path or host runner reads it: only
  // the account's location and its identity variables count.
  const key = jsonHash([configRoot, credentialHome.home, Object.entries(env).filter(([name, value]) =>
    value && (name === "CLAUDE_CODE_OAUTH_TOKEN" || name.startsWith("ANTHROPIC_"))).sort()]);
  const previous = statusReads.get(key);
  if (previous?.revision === revision && (previous.pending || previous.expiresAt > Date.now())) return previous.value;
  const entry = { revision, pending: true, expiresAt: 0 };
  statusReads.set(key, entry);
  entry.value = readNativeClaudeCodeAuthStatus({ env, credentialHome, command, commandRunner, signal }).then(({ status, unfinished }) => {
    // Keychain changes cannot be observed with file metadata on macOS.
    if (process.platform !== "darwin") {
      // Claude's answer holds until its credentials change. A read the host timed
      // out or refused for now backs off, so a busy host is not probed again by
      // every caller; a read that ran and failed is asked again next time.
      if (!status.error) entry.expiresAt = Infinity;
      else if (unfinished) entry.expiresAt = Date.now() + STATUS_RETRY_MS;
    }
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
  const status = claudeCodeAuthStatus(result);
  return { status, unfinished: Boolean(status.error) && result.ok !== true &&
    (result.timedOut === true || result.retryable === true) };
}

function claudeCodeAuthStatus(result) {
  const failure = result.error ? { loggedIn: false, error: result.error }
    : { loggedIn: false, error: "Claude Code is not connected.", messageCode: "assistant.claude.notConnected", messageParams: {} };
  if (!result.ok && (result.exitCode !== 1 || result.timedOut || result.signal)) return failure;
  try {
    const status = JSON.parse(result.stdout || result.output);
    // Native auth status exits 1 for a normal signed-out JSON response.
    if (!result.ok && status?.loggedIn !== false) return failure;
    if (typeof status?.loggedIn !== "boolean") throw new Error("Invalid account status.");
    return { loggedIn: status.loggedIn === true, email: String(status.email || ""),
      authMethod: String(status.authMethod || ""), subscriptionType: String(status.subscriptionType || "") };
  } catch {
    return result.ok ? { loggedIn: false, error: "Claude Code returned an invalid account status.",
      messageCode: "assistant.claude.accountStatusInvalid", messageParams: {} } : failure;
  }
}

/** Exact existing native connection pin, shared with stopped metadata conversion. */
export function claudeConnectionIdentity(configRoot, providerId, baseUrl, apiKey) {
  return jsonHash([configRoot, providerId, baseUrl, apiKey]);
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

export async function bindClaudeConversationAccount(entry, { identity, providerId, allowAccountChange = false, stop, save }) {
  entry.accountIdentities ||= {};
  if (!nativeAiProvider(providerId) && entry.accountIdentities[providerId] && entry.accountIdentities[providerId] !== identity) {
    await stop(entry, "The signed-in Claude account changed.");
    if (!allowAccountChange) {
      throw Object.assign(new Error("This conversation belongs to another Claude account. Reconnect that account or start a new session."), {
        code: "claude_account_changed"
      });
    }
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

// Plan usage is read through a conversation's live process at most this often,
// and otherwise through a one-shot Claude started only for the read.
const PLAN_USAGE_LIVE_READ_MS = 60_000;
const PLAN_USAGE_IDLE_READ_MS = 300_000;
// A verified reading stays current until the next idle read, one client poll and
// its read deadline could have replaced it.
const PLAN_USAGE_CURRENT_MS = 420_000;
// One plan-usage reading per Claude account in this server process, with its read
// times and the read in flight. Every account-query owner, page and session asking
// for the account shares it, so however many ask, the account's one-shot Claude
// starts at most once per idle interval.
const planUsageReads = new Map();

/**
 * Claude Code answers `get_usage` from the usage endpoint, or from its saved copy
 * of that answer while under a minute old, including the endpoint's `limits` list.
 * While that read fails or is held after a 429, it answers from the rate-limit
 * headers of the answering process's last API response, which can be hours old,
 * and omits `limits`. The answer has no age, so only one with `limits` is current.
 */
function claudePlanUsageVerified(value) {
  return !value.rate_limits_available || Array.isArray(value.rate_limits?.limits);
}

function presentPlanUsage(reading) {
  if (!reading) return { status: "unavailable", windows: [] };
  if (reading.status !== "available") return reading;
  const currentForMs = PLAN_USAGE_CURRENT_MS - (Date.now() - reading.checkedAt);
  return currentForMs > 0 ? { ...reading, currentForMs } : { ...reading, status: "stale" };
}

export function claudeCatalogueModels(initialization) {
  return (initialization.models || []).map((model) => ({
    id: model.value, label: model.displayName || model.value, description: model.description || "",
    status: "available", variants: (model.supportedEffortLevels || []).map((id) => ({
      id, label: id[0].toUpperCase() + id.slice(1)
    }))
  }));
}

/**
 * Native account queries share process reuse, caches and retryable cleanup. Plan
 * usage is shared by `accountIdentity` with every other owner in the process, so
 * that identity names exactly one Claude account. `configRoot` is the account's
 * Claude configuration directory, whose credentials the model list follows.
 */
export function createClaudeAccountQueries({ createProcess, accountIdentity, configRoot, processes = () => [], isClosing = () => false }) {
  const error = message => Object.assign(new Error(message), { code: "claude_account_query_failed" });
  const accountProcessStops = new Set();
  const accountReads = new Set();
  let catalog;
  const catalogStarts = new Map();
  // Accounts whose shared plan-usage reading this owner used, and the reads it started.
  const usageAccounts = new Set();
  const usageReads = new Set();
  let revision = 0;

  function assertCurrent(expectedRevision) {
    if (expectedRevision !== revision) throw error("Claude account query was cancelled for reconnection.");
    if (isClosing()) throw error("Claude is reconnecting.");
  }

  async function stopAccountProcess(native) {
    accountProcessStops.add(native);
    if (!(await native.stop()).scopeEmpty) throw error("Claude account query process cleanup could not be confirmed.");
    accountProcessStops.delete(native);
  }

  function ownedProcess(identity) {
    return [...processes()].find((entry) =>
      entry.process && !entry.stopping && entry.accountIdentity === identity);
  }

  async function readAccountProcess(identity, expectedRevision, purpose, read, { borrow = false } = {}) {
    assertCurrent(expectedRevision);
    for (const native of accountProcessStops) await stopAccountProcess(native);
    assertCurrent(expectedRevision);
    const owned = borrow ? ownedProcess(identity) : null;
    const controller = new AbortController();
    accountReads.add(controller);
    const cancelled = Promise.withResolvers();
    const abort = () => cancelled.reject(controller.signal.reason);
    controller.signal.addEventListener("abort", abort, { once: true });
    // Startup owns its abort and exit proof before it can return a process.
    // Observe cancellation while awaiting that factory as well.
    cancelled.promise.catch(() => {});
    let native;
    try {
      native = owned?.process || await createProcess({ signal: controller.signal, purpose });
      controller.signal.throwIfAborted();
      return await Promise.race([read(native), cancelled.promise]);
    } finally {
      accountReads.delete(controller);
      controller.signal.removeEventListener("abort", abort);
      if (native && !owned) await stopAccountProcess(native);
    }
  }

  // The model list belongs to the account and the Claude Code version that gave
  // it: the account's credentials file changes with sign-in, sign-out and each
  // token refresh (which carries a plan change), and the executable with each
  // Claude Code update. An executable given as a bare name has no metadata.
  async function catalogueRevision(command) {
    return JSON.stringify(await Promise.all([fileRevision(path.join(configRoot, ".credentials.json")),
      fileRevision(command)]));
  }

  return Object.freeze({
    async readCatalogue(context) {
      const expectedRevision = revision;
      assertCurrent(expectedRevision);
      const identity = await accountIdentity(context);
      assertCurrent(expectedRevision);
      // An answer is kept until its account, credentials or executable change, so
      // reading it again starts no Claude.
      const kept = catalog?.identity === identity ? catalog : null;
      if (kept && kept.revision === await catalogueRevision(kept.command)) {
        assertCurrent(expectedRevision);
        return kept.value;
      }
      if (!catalogStarts.has(identity)) catalogStarts.set(identity, (async () => {
        // A conversation's process answers with what it knew when it started, so
        // the list comes from a Claude started for this read.
        const { value, command } = await readAccountProcess(identity, expectedRevision, "catalogue",
          async (native) => ({ value: await native.initialization, command: native.command }));
        const answered = await catalogueRevision(command);
        if (identity !== await accountIdentity(context)) throw error("The signed-in Claude account changed. Refresh the model list.");
        assertCurrent(expectedRevision);
        catalog = { identity, command, revision: answered, value };
        return value;
      })().finally(() => { catalogStarts.delete(identity); }));
      return catalogStarts.get(identity);
    },
    async readPlanUsage(context) {
      const expectedRevision = revision;
      assertCurrent(expectedRevision);
      const identity = await accountIdentity(context);
      assertCurrent(expectedRevision);
      // One reading per account, whichever owner asks; a started process is stopped after its read.
      let usage = planUsageReads.get(identity);
      if (!usage) {
        usage = { liveReadAt: -Infinity, temporaryReadAt: -Infinity, reading: null, pending: null };
        planUsageReads.set(identity, usage);
      }
      usageAccounts.add(identity);
      if (usage.pending) return usage.pending;
      const live = Boolean(ownedProcess(identity));
      const liveDue = live && Date.now() - usage.liveReadAt >= PLAN_USAGE_LIVE_READ_MS;
      // A one-shot Claude starts only when neither a verified reading nor a one-shot
      // read is from the last idle interval.
      const temporaryDue = () => Date.now() - Math.max(usage.temporaryReadAt, usage.reading?.checkedAt ?? -Infinity) >=
        PLAN_USAGE_IDLE_READ_MS;
      if (!liveDue && (live || !temporaryDue())) return presentPlanUsage(usage.reading);
      const pending = (async () => {
        // A live process's held endpoint read is its own, so a fresh one-shot Claude
        // may still reach the endpoint when the live answer cannot prove it is current.
        for (const borrow of liveDue ? [true, false] : [false]) {
          if (!borrow && !temporaryDue()) break;
          usage[borrow ? "liveReadAt" : "temporaryReadAt"] = Date.now();
          let value;
          try {
            value = await readAccountProcess(identity, expectedRevision, "usage", (native) => native.client.request(
              { subtype: "get_usage", skip_behaviors: true }), { borrow });
          } catch (cause) {
            if (borrow || !liveDue) throw cause;
            assertCurrent(expectedRevision);
            break;
          }
          if (identity !== await accountIdentity(context)) return { status: "unavailable", windows: [] };
          assertCurrent(expectedRevision);
          // An answer that cannot prove it is current keeps the last verified reading.
          if (claudePlanUsageVerified(value)) {
            usage.reading = { ...claudePlanUsage(value), identity };
            break;
          }
        }
        return presentPlanUsage(usage.reading);
      })().finally(() => {
        usageReads.delete(pending);
        if (usage.pending === pending) usage.pending = null;
      });
      // Requests that arrive while the account is read share that read.
      usage.pending = pending;
      usageReads.add(pending);
      return pending;
    },
    // A native usage change lets the next request read again without hiding the last reading.
    invalidateUsage() {
      for (const identity of usageAccounts) {
        const usage = planUsageReads.get(identity);
        if (usage) usage.liveReadAt = -Infinity;
      }
    },
    async invalidate() {
      revision++;
      // Dropped at once: a read started before this cannot store its answer.
      catalog = null;
      for (const controller of accountReads) controller.abort(error("Claude account query was cancelled for reconnection."));
      await Promise.allSettled([...catalogStarts.values(), ...usageReads]);
      // The account changed: the next request for an account this owner used reads again.
      for (const identity of usageAccounts) planUsageReads.delete(identity);
      usageAccounts.clear();
      for (const native of accountProcessStops) await stopAccountProcess(native);
    }
  });
}

/** Native startup and handshake; an execution host owns processes and their identity. */
export async function createClaudeCodeProcess({
  command = "claude", execution = createLocalConversationExecution(), env = process.env,
  workdir, onEvent, onControlRequest, onFailure, onStarted, executionLimits, signal, commandWrapper,
  initializationTimeoutMs = 30_000, onInitializationProgress, ...options
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
    const stream = Duplex.from({ readable: native.stdout, writable: native.stdin });
    // A lost stream usually means the process ended. Its exit details arrive
    // separately, so wait briefly for them before reporting the cause.
    const exited = native.exited;
    const describeFailure = async (failure) => {
      if (failure?.code === "assistant_claude_observation_lost" && exited && !stopped && !stopping) {
        const processExit = failure.processExit || await Promise.race([
          exited.catch(() => null),
          new Promise((resolve) => setTimeout(resolve, CLAUDE_EXIT_WAIT_MS, null).unref?.())
        ]);
        if (processExit) Object.assign(failure, { processExit, message: claudeUnexpectedExitMessage(processExit) });
      }
      return onFailure?.(failure);
    };
    client = createClaudeJsonClient({ stream, onEvent, onFailure: describeFailure,
      onControlRequest(request, context) {
        if (request.subtype === "hook_callback" && commandWrapper && request.callback_id === "jskit-command-wrapper") {
          return nativeCommandHook(commandWrapper, request.input);
        }
        if (!onControlRequest) throw new Error("This Claude control request has no owner.");
        return onControlRequest(request, context);
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    const initializing = client.initialize(commandWrapper ? { hooks: {
      PreToolUse: [{ matcher: "^Bash$", hookCallbackIds: ["jskit-command-wrapper"], timeout: 30 }]
    } } : {}, { timeoutMs: initializationTimeoutMs, onProgress: onInitializationProgress });
    const initialization = await (native.exited ? Promise.race([
      initializing,
      native.exited.then(processExit => {
        throw Object.assign(new Error("Claude exited before initialization completed."), {
          code: "assistant_claude_startup_exited", processExit
        });
      })
    ]) : initializing);
    // Children can retain stdout after the parent exits. Keep observing the
    // execution receipt after startup instead of waiting forever for pipe EOF.
    if (native.exited) void native.exited.then(processExit => {
      if (!stopped && !stopping) stream.destroy(Object.assign(new Error("Claude exited unexpectedly."), {
        code: "assistant_claude_observation_lost", processExit
      }));
    }, error => {
      if (!stopped && !stopping) stream.destroy(error);
    });
    return { client, initialization, executionId: native.id, command, stop };
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
