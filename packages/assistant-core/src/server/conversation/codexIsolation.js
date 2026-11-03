import path from "node:path";
import { isPlainRecord, normalizeNullableText } from "./normalize.js";
import { codexAppServerTextHasControlCharacters } from "./codexConfiguration.js";

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
  const error = new Error(normalizeNullableText(message) || "Codex cannot prove the helper execution policy.");
  error.code = "codex_policy_unenforceable";
  error.details = Object.freeze({ ...details });
  for (const [name, value] of Object.entries(error.details)) {
    if (!["code", "details", "message", "name"].includes(name)) {
      error[name] = value;
    }
  }
  return error;
}

/**
 * Native helper isolation verification; hosts supply their profile policy.
 * @param {object} [policy]
 * @param {string} [policy.clientName]
 * @param {string} [policy.minimumVersion]
 * @param {readonly string[]} [policy.disabledFeatures]
 * @param {Record<string, number>} [policy.limits]
 * @param {(message?: string, details?: Record<string, unknown>) => Error} [policy.createError]
 */
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
    // readable-check: allow method-probe - safety invariant: a provider without a connection generation would let helper policy run on an unverified connection
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
    // readable-check: allow method-probe - safety invariant: only the dedicated helper provider reports an isolated execution context
    if (typeof provider?.currentHelperExecutionContext !== "function") {
      throw createError(
        "Codex helper execution requires its dedicated isolated provider."
      );
    }
    const context = await provider.currentHelperExecutionContext();
    const cwd = normalizeNullableText(context?.cwd);
    const accountIdentitySignature = normalizeNullableText(context?.accountIdentitySignature);
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
    const match = normalizeNullableText(value).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
    if (!match) {
      return null;
    }
    const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
    return parts.every(Number.isSafeInteger) ? parts : null;
  }

  function codexAppServerUserAgentVersionParts(value = "") {
    const userAgent = normalizeNullableText(value);
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
    // readable-check: allow method-probe - safety invariant: a provider that cannot report its app-server version would run helpers on an unchecked version
    if (typeof provider?.currentServerInfo !== "function") {
      throw createError(
        "Codex helper execution cannot verify the app-server version. Update Codex and retry.",
        { minimumVersion }
      );
    }
    const userAgent = normalizeNullableText(provider.currentServerInfo()?.userAgent);
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
      normalizeNullableText(record?.cwd) !== cwd ||
      normalizeNullableText(record?.cwd).length > hookFieldMaxLength ||
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
      const key = normalizeNullableText(hook?.key);
      const currentHash = normalizeNullableText(hook?.currentHash);
      const handlerType = normalizeNullableText(hook?.handlerType);
      const sourcePath = normalizeNullableText(hook?.sourcePath);
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

  function isolationConfigFrom(configResult, hookResult, cwd, { effort = "", summary = "" } = {}) {
    const mcpServerNames = codexAppServerHelperMcpServerNames(configResult);
    const hookState = codexAppServerHelperHookState(hookResult, cwd);
    return {
      mcpServerNames,
      hookState,
      config: codexAppServerHelperIsolationConfig({
        effort,
        summary,
        hookKeys: hookState.hookKeys,
        mcpServerNames
      })
    };
  }

  async function codexAppServerHelperIsolationState(provider, { effort = "", summary = "" } = {}) {
    assertCodexAppServerHelperCompatibility(provider);
    // readable-check: allow method-probe - safety invariant: without configuration and hook inventories the helper surface cannot be proved tool-free
    if (typeof provider?.readConfig !== "function" || typeof provider?.listHooks !== "function") {
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
    const { mcpServerNames, hookState, config } = isolationConfigFrom(configResult, hookResult, executionContext.cwd, {
      effort,
      summary
    });
    return Object.freeze({
      accountIdentitySignature: executionContext.accountIdentitySignature,
      config,
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
    const normalizedThreadId = normalizeNullableText(threadId);
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

  // Re-inspect after the native thread exists; a changed surface retires it.
  async function verifyHelperThread(provider, enforcement, thread, threadId, phase) {
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
          `Codex execution surfaces changed while the helper thread was ${phase}.`
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

  async function startCodexAppServerHelperThread(provider, prepare) {
    // readable-check: allow method-probe - safety invariant: a helper thread that cannot be deleted would outlive a failed policy verification
    if (typeof provider?.startThread !== "function" || typeof provider?.deleteThread !== "function") {
      throw createError(
        "Codex helper execution cannot own and clean up its app-server thread."
      );
    }
    const prepared = await prepare();
    const thread = await provider.startThread(prepared.settings);
    const threadId = normalizeNullableText(thread?.id);
    if (!threadId) {
      throw createError(
        "Codex app-server did not return a helper thread id."
      );
    }
    return verifyHelperThread(provider, prepared.enforcement, thread, threadId, "starting");
  }

  async function resumeCodexAppServerHelperThread(provider, threadId, prepare) {
    // readable-check: allow method-probe - safety invariant: a resumed helper thread that cannot be deleted would outlive a failed policy verification
    if (typeof provider?.resumeThread !== "function" || typeof provider?.deleteThread !== "function") {
      throw createError(
        "Codex helper execution cannot safely resume and clean up its app-server thread."
      );
    }
    const normalizedThreadId = normalizeNullableText(threadId);
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
    return verifyHelperThread(provider, enforcement, thread, normalizedThreadId, "resuming");
  }

  function hasConfiguration(config) {
    return codexAppServerHelperIsolationConfigs.has(config);
  }

  function configuration({ configResult, hookResult, workdir, effort = "", summary = "" }) {
    return isolationConfigFrom(configResult, hookResult, workdir, { effort, summary }).config;
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
    hasConfiguration,
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
  // readable-check: allow method-probe - safety invariant: without these inventories an ephemeral conversation cannot be proved tool-free
  if (typeof provider?.readConfig !== "function" || typeof provider?.listHooks !== "function" || typeof provider?.currentConnectionGeneration !== "function") {
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
