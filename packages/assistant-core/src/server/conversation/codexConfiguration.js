import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isPlainObject as isRecord, normalizeText } from "./normalize.js";

const execute = promisify(execFile);
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) {
    return "";
  }
  return threadId.toLowerCase();
}

/** Format native requests from the host's already-resolved model and permission policy. */
export function codexAppServerThreadSettings({
  effectiveSettings,
  config = null,
  cwd = "",
  systemPrompt = null,
  hostContext = null,
  model = "",
  approvalPolicy,
  reasoningSummary,
  sandbox
} = {}) {
  return {
    approvalPolicy,
    config: {
      ...(effectiveSettings.request.reasoning !== false
        ? { model_reasoning_effort: effectiveSettings.thinking }
        : {}),
      ...(effectiveSettings.request.summary !== false
        ? { model_reasoning_summary: reasoningSummary }
        : {}),
      ...(config && typeof config === "object" && !Array.isArray(config) ? config : {})
    },
    cwd,
    ...(typeof systemPrompt === "string" && systemPrompt.trim() ? { systemPrompt: normalizeText(systemPrompt) } : {}),
    ...(hostContext ? { hostContext } : {}),
    model: normalizeText(model) || effectiveSettings.model,
    ...(effectiveSettings.modelProviderId ? { modelProvider: effectiveSettings.modelProviderId } : {}),
    sandbox
  };
}

/** Overlay native fields after the host selects a restricted, read-only scope. */
export function codexAppServerReadOnlyThreadSettings(settings) {
  return {
    ...settings,
    dynamicTools: [],
    environments: [],
    runtimeWorkspaceRoots: [],
    sandbox: "read-only",
    selectedCapabilityRoots: []
  };
}

export function codexAppServerTurnSettings({
  effectiveSettings,
  cwd = "",
  effort = "",
  model = "",
  approvalPolicy,
  reasoningSummary,
  sandboxPolicy,
  externalSandbox = false
} = {}) {
  const settings = {
    approvalPolicy,
    cwd,
    model: normalizeText(model) || effectiveSettings.model,
    sandboxPolicy: externalSandbox ? { networkAccess: "enabled", type: "externalSandbox" } : sandboxPolicy
  };
  if (effectiveSettings.request.reasoning !== false) {
    settings.effort = normalizeText(effort) || effectiveSettings.thinking;
  }
  if (effectiveSettings.request.summary !== false) {
    settings.summary = reasoningSummary;
  }
  return settings;
}

/** Interactive CLI spelling; executable selection and shell setup belong to the host. */
export function codexInteractiveArguments({
  command,
  threadId = "",
  remoteEndpoint = "",
  model,
  effort,
  disableStartupUpdates = false,
  bypassApprovalsAndSandbox = false,
  bypassHookTrust = false
} = {}) {
  const codexReasoningConfig = `model_reasoning_effort="${effort}"`;
  return [
    command,
    ...(disableStartupUpdates ? ["-c", "check_for_update_on_startup=false"] : []),
    ...(remoteEndpoint ? ["--remote", remoteEndpoint] : []),
    "--model",
    model,
    "-c",
    codexReasoningConfig,
    // Remote resume inherits saved server permissions and rejects CLI overrides.
    ...(bypassApprovalsAndSandbox && !(remoteEndpoint && threadId) ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
    ...(bypassHookTrust ? ["--dangerously-bypass-hook-trust"] : []),
    ...(threadId ? ["resume", threadId] : [])
  ];
}

export async function codexAppServerProjectHookTrustConfig(provider, cwd = "", {
  persist = false
} = {}) {
  const normalizedCwd = normalizeText(cwd);
  if (!normalizedCwd || typeof provider?.listHooks !== "function") {
    return null;
  }
  await provider.trustProject(normalizedCwd);
  const result = await provider.listHooks([normalizedCwd]);
  const record = (Array.isArray(result?.data) ? result.data : [])
    .find((item) => normalizeText(item?.cwd) === normalizedCwd);
  const trustedHooks = (Array.isArray(record?.hooks) ? record.hooks : [])
    // Session flags contain the host's command hook. Trust its exact hash
    // alongside project hooks; unrelated account and plugin hooks stay separate.
    .filter((hook) => hook?.enabled === true && ["project", "sessionFlags"].includes(hook?.source))
    .map((hook) => ({
      currentHash: normalizeText(hook?.currentHash),
      key: normalizeText(hook?.key),
      trustStatus: normalizeText(hook?.trustStatus)
    }))
    .filter(({ currentHash, key }) => key && currentHash);
  if (trustedHooks.length === 0) {
    return null;
  }
  const state = Object.fromEntries(trustedHooks.map(({ currentHash, key }) => [
    key,
    {
      trusted_hash: currentHash
    }
  ]));
  if (
    persist &&
    trustedHooks.some(({ trustStatus }) => !["managed", "trusted"].includes(trustStatus)) &&
    typeof provider?.writeHookTrustState === "function"
  ) {
    await provider.writeHookTrustState(state);
  }
  // Native overrides replace the value at each key. Replacing the whole hooks
  // table would erase the PreToolUse hook installed through session flags.
  return { "hooks.state": state };
}

// Codex's model manager reads model_catalog_json once, before any threads
// exist. A thread override changes routing, but cannot supply model metadata.
// Export from the installed CLI so native model definitions stay CLI-owned.
export async function prepareCodexModelCatalog({ command, runtimeDir, bundled = false, signal, additionalModels = [] }) {
  let catalog;
  const models = new Map();
  try {
    const { stdout } = await execute(command, [
      "debug", "models", ...(bundled ? ["--bundled"] : []),
      "-c", "check_for_update_on_startup=false"
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20_000, signal });
    catalog = JSON.parse(stdout);
    if (!Array.isArray(catalog?.models) || !catalog.models.length) {
      throw new Error("Invalid native model catalogue");
    }
    for (const model of catalog.models) {
      if (!model || typeof model.slug !== "string" || !model.slug.trim() || models.has(model.slug)) {
        throw new Error("Invalid native model catalogue");
      }
      models.set(model.slug, model);
    }
  } catch {
    // CLI output can contain provider configuration. Never include it here.
    throw new Error("Codex could not load its model catalogue. Restart the assistant service after checking the Codex installation and connection.");
  }
  // Adding foreign metadata must not change the native default model.
  let priority = catalog.models.reduce((maximum, model) => Math.max(maximum, model.priority || 0), 0);
  for (const model of additionalModels) {
    models.set(model.slug, { ...model, priority: ++priority });
  }
  const catalogPath = path.join(runtimeDir, "models.json");
  const temporary = `${catalogPath}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, JSON.stringify({ ...catalog, models: [...models.values()] }), { mode: 0o600 });
    await rename(temporary, catalogPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return catalogPath;
}

const DISABLED_FEATURES = Object.freeze([
  "apps",
  "artifact",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode",
  "code_mode_host",
  "computer_use",
  "default_mode_request_user_input",
  "deferred_executor",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "psp",
  "recommended_plugins",
  "request_permissions_tool",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "unified_exec_zsh_fork",
  "view_image"
]);

export function codexAppServerTextHasControlCharacters(value = "") {
  return Array.from(String(value)).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreezeCodexAppServerHelperConfig(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreezeCodexAppServerHelperConfig(nested);
  }
  return Object.freeze(value);
}

function codexAppServerIsolationPolicyError(message = "", details = {}) {
  const error = new Error(normalizeText(message) || "Codex cannot prove the helper execution policy.");
  error.code = "codex_policy_unenforceable";
  error.details = Object.freeze({ ...details });
  for (const [name, value] of Object.entries(error.details)) {
    if (!["code", "details", "message", "name"].includes(name)) {
      error[name] = value;
    }
  }
  return error;
}

/** Original native helper policy verification; hosts supply their profile policy. */
export function createCodexAppServerIsolation({
  clientName = "jskit",
  minimumVersion = "0.151.0",
  disabledFeatures = DISABLED_FEATURES,
  limits: {
    userAgentMaxLength = 512,
    mcpServerMaxCount = 128,
    mcpServerNameMaxLength = 256,
    configResponseMaxBytes = 256 * 1024,
    hookMaxCount = 256,
    hookErrorMaxCount = 256,
    hookFieldMaxLength = 2048,
    hookFingerprintMaxLength = 256 * 1024,
    hookResponseMaxBytes = 512 * 1024
  } = {},
  createError = codexAppServerIsolationPolicyError
} = {}) {
  const codexAppServerHelperIsolationConfigs = new WeakSet();

  function assertCodexAppServerHelperResponseBounded(value, maxBytes, label) {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      throw createError(
        `Codex helper execution received an invalid ${label}.`
      );
    }
    if (bytes > maxBytes) {
      throw createError(
        `Codex helper execution received an oversized ${label}.`
      );
    }
  }

  function codexAppServerHelperConnectionGeneration(provider) {
    if (typeof provider?.currentConnectionGeneration !== "function") {
      throw createError(
        "Codex helper execution cannot verify the app-server connection generation."
      );
    }
    const generation = provider.currentConnectionGeneration();
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      throw createError(
        "Codex helper execution found no active app-server connection."
      );
    }
    return generation;
  }

  async function codexAppServerHelperExecutionContext(provider) {
    if (typeof provider?.currentHelperExecutionContext !== "function") {
      throw createError(
        "Codex helper execution requires its dedicated isolated provider."
      );
    }
    const context = await provider.currentHelperExecutionContext();
    const cwd = normalizeText(context?.cwd);
    const accountIdentitySignature = normalizeText(context?.accountIdentitySignature);
    if (
      context?.executionMode !== "helper" ||
      !cwd ||
      !path.isAbsolute(cwd) ||
      !/^sha256:[a-f0-9]{64}$/u.test(accountIdentitySignature)
    ) {
      throw createError(
        "Codex helper runtime isolation could not be verified."
      );
    }
    return Object.freeze({
      accountIdentitySignature,
      cwd,
      executionMode: "helper"
    });
  }

  function codexAppServerSemanticVersionParts(value = "") {
    const match = normalizeText(value).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
    if (!match) {
      return null;
    }
    const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
    return parts.every(Number.isSafeInteger) ? parts : null;
  }

  function codexAppServerUserAgentVersionParts(value = "") {
    const userAgent = normalizeText(value);
    if (
      !userAgent ||
      userAgent.length > userAgentMaxLength ||
      codexAppServerTextHasControlCharacters(userAgent)
    ) {
      return null;
    }
    const prefix = `${clientName}/`;
    if (!userAgent.startsWith(prefix)) {
      return null;
    }
    const match = userAgent.slice(prefix.length).match(/^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:$|[ \t].*$)/u);
    return match ? codexAppServerSemanticVersionParts(match[1]) : null;
  }

  function assertCodexAppServerHelperCompatibility(provider) {
    if (typeof provider?.currentServerInfo !== "function") {
      throw createError(
        "Codex helper execution cannot verify the app-server version. Update Codex and retry.",
        { minimumVersion }
      );
    }
    const userAgent = normalizeText(provider.currentServerInfo()?.userAgent);
    const actualParts = codexAppServerUserAgentVersionParts(userAgent);
    if (!actualParts) {
      throw createError(
        "Codex helper execution received an unrecognised app-server version. Update Codex and retry.",
        {
          minimumVersion
        }
      );
    }
    const actualVersion = actualParts.join(".");
    const minimumParts = codexAppServerSemanticVersionParts(minimumVersion);
    const differingPart = actualParts.findIndex((part, index) => part !== minimumParts[index]);
    if (differingPart !== -1 && actualParts[differingPart] < minimumParts[differingPart]) {
      throw createError(
        `Codex helper execution requires app-server ${minimumVersion} or newer; current version is ${actualVersion}. Update Codex and retry.`,
        {
          actualVersion,
          minimumVersion
        }
      );
    }
    return Object.freeze({
      minimumVersion,
      version: actualVersion
    });
  }

  function codexAppServerHelperMcpServerNames(configResult = null) {
    if (!isPlainRecord(configResult?.config)) {
      throw createError(
        "Codex helper execution could not read the effective app-server configuration."
      );
    }
    const servers = configResult.config.mcp_servers;
    if (servers === undefined || servers === null) {
      return [];
    }
    // Only the MCP inventory participates in this isolation check. The native
    // response can also contain large model catalogues and configuration layers.
    assertCodexAppServerHelperResponseBounded(
      servers,
      configResponseMaxBytes,
      "MCP configuration"
    );
    if (!isPlainRecord(servers)) {
      throw createError(
        "Codex helper execution received an invalid MCP server configuration."
      );
    }
    const names = Object.keys(servers);
    if (
      names.length > mcpServerMaxCount ||
      names.some((name) => (
        !name ||
        name.length > mcpServerNameMaxLength ||
        codexAppServerTextHasControlCharacters(name)
      ))
    ) {
      throw createError(
        "Codex helper execution received an oversized or invalid MCP server inventory."
      );
    }
    return names.sort();
  }

  function codexAppServerHelperHookState(result = null, cwd = "") {
    assertCodexAppServerHelperResponseBounded(
      result,
      hookResponseMaxBytes,
      "hook inventory"
    );
    if (!Array.isArray(result?.data)) {
      throw createError(
        "Codex helper execution could not enumerate app-server hooks."
      );
    }
    if (result.data.length !== 1) {
      throw createError(
        "Codex helper execution received an unexpected hook inventory."
      );
    }
    const record = result.data[0];
    if (
      normalizeText(record?.cwd) !== cwd ||
      normalizeText(record?.cwd).length > hookFieldMaxLength ||
      !Array.isArray(record.hooks) ||
      !Array.isArray(record.errors) ||
      record.hooks.length > hookMaxCount ||
      record.errors.length > hookErrorMaxCount
    ) {
      throw createError(
        "Codex helper execution received an incomplete hook inventory."
      );
    }
    if (record.errors.length > 0) {
      throw createError(
        "Codex helper execution cannot continue while hook discovery has errors.",
        { hookErrorCount: record.errors.length }
      );
    }
    const hooks = record.hooks.map((hook) => {
      const key = normalizeText(hook?.key);
      const currentHash = normalizeText(hook?.currentHash);
      const handlerType = normalizeText(hook?.handlerType);
      const sourcePath = normalizeText(hook?.sourcePath);
      if (
        !key ||
        [key, currentHash, handlerType, sourcePath].some((field) => (
          field.length > hookFieldMaxLength ||
          codexAppServerTextHasControlCharacters(field)
        ))
      ) {
        throw createError(
          "Codex helper execution found an invalid hook inventory entry."
        );
      }
      if (hook?.isManaged === true && hook?.enabled === true) {
        throw createError(
          "Codex helper execution cannot disable a managed hook."
        );
      }
      return {
        currentHash,
        enabled: hook?.enabled === true,
        handlerType,
        isManaged: hook?.isManaged === true,
        key,
        sourcePath
      };
    }).sort((left, right) => left.key.localeCompare(right.key));
    const fingerprint = JSON.stringify(hooks);
    if (fingerprint.length > hookFingerprintMaxLength) {
      throw createError(
        "Codex helper execution received an oversized hook inventory."
      );
    }
    return {
      fingerprint,
      hookKeys: hooks.filter((hook) => !hook.isManaged).map((hook) => hook.key)
    };
  }

  function codexAppServerHelperIsolationConfig({
    effort = "",
    summary = "",
    hookKeys = [],
    mcpServerNames = []
  } = {}) {
    const config = {
      features: Object.fromEntries(
        disabledFeatures.map((feature) => [feature, false])
      ),
      hooks: {
        state: Object.fromEntries(hookKeys.map((key) => [key, { enabled: false }]))
      },
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      include_environment_context: false,
      include_permissions_instructions: false,
      ...(effort ? { model_reasoning_effort: effort } : {}),
      ...(summary ? { model_reasoning_summary: summary } : {}),
      mcp_servers: Object.fromEntries(
        mcpServerNames.map((name) => [name, { enabled: false }])
      ),
      memories: {
        dedicated_tools: false,
        generate_memories: false,
        use_memories: false
      },
      notify: [],
      orchestrator: {
        mcp: {
          enabled: false
        },
        skills: {
          enabled: false
        }
      },
      project_doc_max_bytes: 0,
      shell_environment_policy: {
        inherit: "none",
        set: {}
      },
      skills: {
        include_instructions: false
      },
      tools: {
        experimental_request_user_input: {
          enabled: false
        },
        update_plan: {
          enabled: false
        }
      },
      web_search: "disabled"
    };
    const frozenConfig = deepFreezeCodexAppServerHelperConfig(config);
    codexAppServerHelperIsolationConfigs.add(frozenConfig);
    return frozenConfig;
  }

  async function codexAppServerHelperIsolationState(provider, { effort = "", summary = "" } = {}) {
    assertCodexAppServerHelperCompatibility(provider);
    if (
      typeof provider?.readConfig !== "function" ||
      typeof provider?.listHooks !== "function"
    ) {
      throw createError(
        "Codex helper execution cannot inventory configuration and hooks."
      );
    }
    const executionContext = await codexAppServerHelperExecutionContext(provider);
    const generation = codexAppServerHelperConnectionGeneration(provider);
    const configResult = await provider.readConfig({
      cwd: executionContext.cwd,
      includeLayers: false
    });
    if (codexAppServerHelperConnectionGeneration(provider) !== generation) {
      throw createError(
        "Codex app-server reconnected during helper policy verification."
      );
    }
    const hookResult = await provider.listHooks([executionContext.cwd]);
    if (codexAppServerHelperConnectionGeneration(provider) !== generation) {
      throw createError(
        "Codex app-server reconnected during helper policy verification."
      );
    }
    const mcpServerNames = codexAppServerHelperMcpServerNames(configResult);
    const hookState = codexAppServerHelperHookState(hookResult, executionContext.cwd);
    return Object.freeze({
      accountIdentitySignature: executionContext.accountIdentitySignature,
      config: codexAppServerHelperIsolationConfig({
        effort,
        summary,
        hookKeys: hookState.hookKeys,
        mcpServerNames
      }),
      connectionGeneration: generation,
      executionCwd: executionContext.cwd,
      hookFingerprint: hookState.fingerprint,
      hookKeys: Object.freeze([...hookState.hookKeys]),
      mcpServerNames: Object.freeze([...mcpServerNames])
    });
  }

  function codexAppServerHelperIsolationMatches(left = null, right = null) {
    return left?.accountIdentitySignature === right?.accountIdentitySignature &&
      left?.connectionGeneration === right?.connectionGeneration &&
      left?.executionCwd === right?.executionCwd &&
      left?.hookFingerprint === right?.hookFingerprint &&
      JSON.stringify(left?.mcpServerNames || []) === JSON.stringify(right?.mcpServerNames || []);
  }

  function codexAppServerHelperVerificationFailure(error, cleanupError, threadId = "") {
    const normalizedThreadId = normalizeText(threadId);
    if (!cleanupError) {
      error.codexAppServerHelperThreadId = normalizedThreadId;
      error.codexAppServerHelperThreadRetired = true;
      return error;
    }
    const failure = createError(
      "Codex could not retire a helper thread after policy verification failed.",
      {
        cleanupFailed: true,
        threadId: normalizedThreadId
      }
    );
    failure.codexAppServerHelperThreadCleanupRequired = true;
    failure.codexAppServerHelperThreadId = normalizedThreadId;
    return failure;
  }

  async function throwAfterCodexAppServerHelperVerificationFailure({
    error = null,
    provider = null,
    threadId = ""
  } = {}) {
    let cleanupError = null;
    try {
      await provider.deleteThread(threadId);
    } catch (caught) {
      cleanupError = caught;
    }
    throw codexAppServerHelperVerificationFailure(error, cleanupError, threadId);
  }

  async function startCodexAppServerHelperThread(provider, prepare) {
    if (
      typeof provider?.startThread !== "function" ||
      typeof provider?.deleteThread !== "function"
    ) {
      throw createError(
        "Codex helper execution cannot own and clean up its app-server thread."
      );
    }
    const prepared = await prepare();
    const thread = await provider.startThread(prepared.settings);
    const threadId = normalizeText(thread?.id);
    if (!threadId) {
      throw createError(
        "Codex app-server did not return a helper thread id."
      );
    }
    try {
      const verified = await codexAppServerHelperIsolationState(
        provider,
        {
          effort: prepared.enforcement.config.model_reasoning_effort,
          summary: prepared.enforcement.config.model_reasoning_summary
        }
      );
      if (!codexAppServerHelperIsolationMatches(prepared.enforcement, verified)) {
        throw createError(
          "Codex execution surfaces changed while the helper thread was starting."
        );
      }
      return Object.freeze({
        enforcement: verified,
        thread,
        threadId
      });
    } catch (error) {
      await throwAfterCodexAppServerHelperVerificationFailure({
        error,
        provider,
        threadId
      });
    }
  }

  async function resumeCodexAppServerHelperThread(provider, threadId, prepare) {
    if (
      typeof provider?.resumeThread !== "function" ||
      typeof provider?.deleteThread !== "function"
    ) {
      throw createError(
        "Codex helper execution cannot safely resume and clean up its app-server thread."
      );
    }
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      throw createError(
        "Codex helper resume requires a controller-owned thread id."
      );
    }
    const prepared = await prepare();
    const enforcement = prepared.enforcement;
    const thread = await provider.resumeThread(
      normalizedThreadId,
      prepared.settings
    );
    try {
      const verified = await codexAppServerHelperIsolationState(
        provider,
        {
          effort: enforcement.config.model_reasoning_effort,
          summary: enforcement.config.model_reasoning_summary
        }
      );
      if (!codexAppServerHelperIsolationMatches(enforcement, verified)) {
        throw createError(
          "Codex execution surfaces changed while the helper thread was resuming."
        );
      }
      return Object.freeze({
        enforcement: verified,
        thread,
        threadId: normalizedThreadId
      });
    } catch (error) {
      await throwAfterCodexAppServerHelperVerificationFailure({
        error,
        provider,
        threadId: normalizedThreadId
      });
    }
  }

  function configuration({ configResult, hookResult, workdir, effort = "", summary = "" }) {
    const mcpServerNames = codexAppServerHelperMcpServerNames(configResult);
    const hookState = codexAppServerHelperHookState(hookResult, workdir);
    return codexAppServerHelperIsolationConfig({
      effort,
      summary,
      hookKeys: hookState.hookKeys,
      mcpServerNames
    });
  }

  // Native Helper requests retain their verified configuration object and the
  // distinct Start/Resume field sets. Profile policy is validated by the host.
  function codexAppServerHelperThreadSettings({
    approvalPolicy,
    baseInstructions,
    config,
    cwd,
    effectiveSettings,
    sandbox,
    systemPrompt
  }) {
    return {
      allowProviderModelFallback: false,
      approvalPolicy,
      baseInstructions,
      config,
      cwd,
      systemPrompt: systemPrompt || null,
      dynamicTools: [],
      environments: [],
      model: effectiveSettings.model,
      runtimeWorkspaceRoots: [],
      sandbox,
      selectedCapabilityRoots: []
    };
  }

  function codexAppServerHelperThreadStartSettings(settings, threadSource) {
    return {
      ...settings,
      sessionStartSource: "startup",
      threadSource
    };
  }

  function codexAppServerHelperThreadResumeSettings(settings) {
    return {
      approvalPolicy: settings.approvalPolicy,
      baseInstructions: settings.baseInstructions,
      config: settings.config,
      cwd: settings.cwd,
      systemPrompt: settings.systemPrompt,
      model: settings.model,
      runtimeWorkspaceRoots: settings.runtimeWorkspaceRoots,
      sandbox: settings.sandbox
    };
  }

  function codexAppServerHelperTurnSettings({
    approvalPolicy,
    cwd,
    effectiveSettings,
    outputSchema
  }) {
    const settings = {
      approvalPolicy,
      cwd,
      environments: [],
      model: effectiveSettings.model,
      outputSchema,
      runtimeWorkspaceRoots: [],
      sandboxPolicy: {
        networkAccess: false,
        type: "readOnly"
      },
      summary: "none"
    };
    if (effectiveSettings.request.reasoning) {
      settings.effort = effectiveSettings.thinking;
    }
    return settings;
  }

  return Object.freeze({
    assertCompatibility: assertCodexAppServerHelperCompatibility,
    executionContext: codexAppServerHelperExecutionContext,
    inspect: codexAppServerHelperIsolationState,
    configuration,
    hasConfiguration: (config) => codexAppServerHelperIsolationConfigs.has(config),
    threadSettings: codexAppServerHelperThreadSettings,
    threadStartSettings: codexAppServerHelperThreadStartSettings,
    threadResumeSettings: codexAppServerHelperThreadResumeSettings,
    turnSettings: codexAppServerHelperTurnSettings,
    start: startCodexAppServerHelperThread,
    resume: resumeCodexAppServerHelperThread
  });
}

const codexConversationIsolation = createCodexAppServerIsolation();

/** Disable ambient tools while allowing the caller to add its authorized tools. */
export function codexToolFreeConfiguration(options) {
  return structuredClone(codexConversationIsolation.configuration(options));
}

export async function readCodexToolFreeConfiguration(
  provider = null,
  workdir = "",
  assertCompatibility = codexConversationIsolation.assertCompatibility
) {
  assertCompatibility(provider);
  if (
    typeof provider?.readConfig !== "function" ||
    typeof provider?.listHooks !== "function" ||
    typeof provider?.currentConnectionGeneration !== "function"
  ) {
    throw new Error("Codex cannot verify tool isolation for this ephemeral conversation.");
  }
  const connectionGeneration = provider.currentConnectionGeneration();
  if (!Number.isSafeInteger(connectionGeneration) || connectionGeneration <= 0) {
    throw new Error("Codex has no active connection for this ephemeral conversation.");
  }
  const [configResult, hookResult] = await Promise.all([
    provider.readConfig({ cwd: workdir, includeLayers: false }),
    provider.listHooks([workdir])
  ]);
  if (provider.currentConnectionGeneration() !== connectionGeneration) {
    throw new Error("Codex reconnected while verifying this ephemeral conversation.");
  }
  return codexToolFreeConfiguration({ configResult, hookResult, workdir });
}

/** Interpret native catalogue responses without choosing application offerings. */
export function codexCatalogRows(value = null, createError = message => new Error(message)) {
  const rows = Array.isArray(value) ? value : value?.data;
  if (!Array.isArray(rows)) {
    throw createError("Codex did not return a usable live model catalog.");
  }
  return rows;
}

export function codexCatalogReasoningEfforts(model = {}) {
  return new Set((Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [])
    .map((option) => normalizeText(option?.reasoningEffort))
    .filter(Boolean));
}

export function codexCatalogModels(rows) {
  return rows.map((model) => ({
    id: normalizeText(model.model),
    label: normalizeText(model.displayName) || normalizeText(model.model),
    status: "available",
    variants: [...codexCatalogReasoningEfforts(model)]
      .map((variantId) => ({
        id: normalizeText(variantId),
        label: normalizeText(variantId).replace(/^./u, (value) => value.toUpperCase())
      }))
  }));
}

export function codexConfiguredModelCatalog(includeModel, model, reasoningEffort) {
  return { data: includeModel ? [{
    model,
    defaultReasoningEffort: reasoningEffort,
    supportedReasoningEfforts: [{ reasoningEffort }]
  }] : [] };
}

/** Native catalogue fields for the exact models selected by the application. */
export function codexProviderModelCatalog({ models }) {
  return {
    models: models.map((model, priority) => ({
      slug: model.id,
      display_name: model.label,
      description: model.label,
      default_reasoning_level: model.defaultThinking,
      supported_reasoning_levels: model.variants.map((effort) => ({ effort, description: effort })),
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority,
      base_instructions: "You are a coding assistant. Complete the user's task in the workspace, use the available tools, preserve unrelated work, and verify your changes.",
      supports_reasoning_summaries: false,
      default_reasoning_summary: "none",
      support_verbosity: false,
      truncation_policy: { mode: "bytes", limit: 10000 },
      context_window: model.contextWindow,
      max_context_window: model.contextWindow,
      effective_context_window_percent: 95,
      supports_parallel_tool_calls: true,
      experimental_supported_tools: [],
      input_modalities: model.images ? ["text", "image"] : ["text"],
      prefer_websockets: false,
      ...(model.freeformPatch ? { apply_patch_tool_type: "freeform" } : {})
    }))
  };
}

/** Private native configuration; credentials must never enter browser responses. */
export function codexProviderConfiguration(provider, apiKey) {
  return {
    model_reasoning_summary: "none",
    web_search: provider.webSearch ? "live" : "disabled",
    [`model_providers.${provider.id}`]: {
      name: provider.label || provider.id, base_url: provider.baseUrl, wire_api: "responses",
      requires_openai_auth: false, experimental_bearer_token: apiKey
    }
  };
}

/** Format a private native config file from an already-authorized provider and key. */
export function codexProviderFileConfiguration(provider, key, codexHome) {
  return [
    `model = ${JSON.stringify(provider.models[0].id)}`,
    `model_provider = ${JSON.stringify(provider.id)}`,
    `model_catalog_json = ${JSON.stringify(path.join(codexHome, "models.json"))}`,
    `model_reasoning_effort = ${JSON.stringify(provider.models[0].defaultThinking)}`,
    'model_reasoning_summary = "none"',
    `web_search = "${provider.webSearch ? "live" : "disabled"}"`,
    `[model_providers.${provider.id}]`,
    `name = ${JSON.stringify(provider.label)}`,
    `base_url = ${JSON.stringify(provider.baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    `experimental_bearer_token = ${JSON.stringify(key)}`,
    ""
  ].join("\n");
}

export async function verifyCodexProviderKey(provider, apiKey, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${provider.baseUrl.replace(/\/$/u, "")}/responses`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.models[0].id,
        input: "Reply with OK.",
        reasoning: { effort: "low" },
        max_output_tokens: 64,
        store: false
      })
    });
  } catch {
    throw new Error(`${provider.label} could not be reached. Your previous connection is unchanged; try again.`);
  }
  // Never expose a provider's raw response, which can contain request details.
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(response.status === 401 || response.status === 403
      ? `${provider.label} rejected this key. Check the key and the required account plan.`
      : `${provider.label} could not complete a test request (HTTP ${response.status}). Check your plan or API credit.`);
  }
  const result = await response.json().catch(() => null);
  if (!result?.id || result.error || !Array.isArray(result.output) ||
      !["completed", "incomplete"].includes(result.status)) {
    throw new Error(`${provider.label} did not return a usable Responses API result. The key was not saved.`);
  }
}

const CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES = 1024 * 1024;
const CODEX_APP_SERVER_CHATGPT_ACCESS_TOKEN_MAX_LENGTH = 256 * 1024;
export const CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH = 512;
const CODEX_APP_SERVER_PLAN_TYPE_MAX_LENGTH = 128;
const CODEX_APP_SERVER_API_KEY_MAX_LENGTH = 16 * 1024;

/** Native account records and secret-change detection. Hosts select the credential home. */
export function createCodexAccountReader({
  errorPrefix = "",
  identityNamespace = "codex-account-v1",
  secretNamespace = "codex-auth-secret-v1"
} = {}) {
  function codexAppServerHelperAuthError(code = "", message = "") {
    const error = new Error(
      normalizeText(message) || "Codex helper authentication is unavailable. Reconnect Codex and retry."
    );
    error.code = normalizeText(code) || `${errorPrefix}codex_helper_auth_unavailable`;
    return error;
  }

  function boundedCodexAuthText(value, {
    label = "Codex authentication value",
    maxLength = 0
  } = {}) {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
      throw codexAppServerHelperAuthError(
        `${errorPrefix}codex_helper_auth_invalid`,
        `${label} is missing or invalid. Reconnect Codex and retry.`
      );
    }
    return value;
  }

  function codexAccountIdentitySignature(authMode = "", identity = "") {
    return `sha256:${createHash("sha256")
      .update(`${identityNamespace}\0`, "utf8")
      .update(normalizeText(authMode), "utf8")
      .update("\0", "utf8")
      .update(String(identity || ""), "utf8")
      .digest("hex")}`;
  }

  function codexAuthSecretSignature(secret = "") {
    return createHash("sha256")
      .update(`${secretNamespace}\0`, "utf8")
      .update(String(secret || ""), "utf8")
      .digest("hex");
  }

  async function readBoundedCodexAuthJson(filePath = "") {
    let handle = null;
    try {
      handle = await open(filePath, "r");
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size > CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES) {
        throw codexAppServerHelperAuthError(
          `${errorPrefix}codex_helper_auth_invalid`,
          "The selected Codex authentication record is invalid. Reconnect Codex and retry."
        );
      }
      const buffer = Buffer.alloc(CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (bytesRead === 0) {
          break;
        }
        offset += bytesRead;
      }
      if (offset > CODEX_APP_SERVER_SELECTED_AUTH_MAX_BYTES) {
        throw codexAppServerHelperAuthError(
          `${errorPrefix}codex_helper_auth_invalid`,
          "The selected Codex authentication record is too large. Reconnect Codex and retry."
        );
      }
      const parsed = JSON.parse(buffer.subarray(0, offset).toString("utf8"));
      if (!isRecord(parsed)) {
        throw new Error("invalid authentication record");
      }
      return parsed;
    } catch (error) {
      if (error?.code?.startsWith?.(`${errorPrefix}codex_helper_auth_`)) {
        throw error;
      }
      throw codexAppServerHelperAuthError(
        `${errorPrefix}codex_helper_auth_unavailable`,
        "The selected Codex authentication record could not be read. Reconnect Codex and retry."
      );
    } finally {
      await handle?.close?.().catch(() => null);
    }
  }

  async function readCodexSelectedAccountAuth(options = {}) {
    const toolHomeSource = normalizeText(options.toolHomeSource);
    if (!toolHomeSource || !path.isAbsolute(toolHomeSource)) {
      throw codexAppServerHelperAuthError(
        `${errorPrefix}codex_helper_auth_unavailable`,
        "The selected Codex account is unavailable. Reconnect Codex and retry."
      );
    }
    const auth = await readBoundedCodexAuthJson(path.join(toolHomeSource, ".codex", "auth.json"));
    const storedMode = normalizeText(auth.auth_mode).toLowerCase();
    if (storedMode === "chatgpt") {
      const tokens = isRecord(auth.tokens) ? auth.tokens : {};
      const accountId = boundedCodexAuthText(tokens.account_id, {
        label: "Codex account identity",
        maxLength: CODEX_APP_SERVER_ACCOUNT_ID_MAX_LENGTH
      });
      const accessToken = boundedCodexAuthText(tokens.access_token, {
        label: "Codex access token",
        maxLength: CODEX_APP_SERVER_CHATGPT_ACCESS_TOKEN_MAX_LENGTH
      });
      const planTypeValue = tokens.chatgpt_plan_type ?? tokens.plan_type;
      const planType = planTypeValue === undefined || planTypeValue === null || planTypeValue === ""
        ? ""
        : boundedCodexAuthText(planTypeValue, {
            label: "Codex plan type",
            maxLength: CODEX_APP_SERVER_PLAN_TYPE_MAX_LENGTH
          });
      return Object.freeze({
        accessToken,
        accountId,
        authMode: "chatgpt",
        identitySignature: codexAccountIdentitySignature("chatgpt", accountId),
        planType,
        secretSignature: codexAuthSecretSignature(accessToken)
      });
    }
    if (["apikey", "api_key"].includes(storedMode)) {
      const apiKey = boundedCodexAuthText(auth.OPENAI_API_KEY, {
        label: "Codex API key",
        maxLength: CODEX_APP_SERVER_API_KEY_MAX_LENGTH
      });
      return Object.freeze({
        apiKey,
        authMode: "apiKey",
        identitySignature: codexAccountIdentitySignature("apiKey", apiKey),
        secretSignature: codexAuthSecretSignature(apiKey)
      });
    }
    throw codexAppServerHelperAuthError(
      `${errorPrefix}codex_helper_auth_invalid`,
      "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
    );
  }

  return {
    error: codexAppServerHelperAuthError,
    identitySignature: codexAccountIdentitySignature,
    readRecord: readBoundedCodexAuthJson,
    readSelected: readCodexSelectedAccountAuth
  };
}

const CODEX_AUTH_INVALIDATED_PATTERN =
  /\b(?:token_invalidated|refresh_token_invalidated)\b|authentication token has been invalidated|HTTP error:\s*401 Unauthorized|401 Unauthorized/iu;

export function codexAuthOutputRequiresReconnect(output = "") {
  return CODEX_AUTH_INVALIDATED_PATTERN.test(String(output || ""));
}
