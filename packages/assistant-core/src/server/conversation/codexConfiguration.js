import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeNullableText } from "./normalize.js";
import { codexDisabledProcessFeatureArguments } from "./codexHomeStorage.js";

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
    ...(typeof systemPrompt === "string" && systemPrompt.trim() ? { systemPrompt: normalizeNullableText(systemPrompt) } : {}),
    ...(hostContext ? { hostContext } : {}),
    model: normalizeNullableText(model) || effectiveSettings.model,
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
    model: normalizeNullableText(model) || effectiveSettings.model,
    sandboxPolicy: externalSandbox ? { networkAccess: "enabled", type: "externalSandbox" } : sandboxPolicy
  };
  if (effectiveSettings.request.reasoning !== false) {
    settings.effort = normalizeNullableText(effort) || effectiveSettings.thinking;
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
    // A remote terminal uses its app-server's features; a local one starts its own.
    ...(remoteEndpoint ? ["--remote", remoteEndpoint] : codexDisabledProcessFeatureArguments()),
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

/** @param {import("./codexProvider.js").CodexAppServerAgentProvider} provider */
export async function codexAppServerProjectHookTrustConfig(provider, cwd = "", {
  persist = false
} = {}) {
  const normalizedCwd = normalizeNullableText(cwd);
  if (!normalizedCwd) {
    return null;
  }
  await provider.trustProject(normalizedCwd);
  const result = await provider.listHooks([normalizedCwd]);
  const record = (Array.isArray(result?.data) ? result.data : [])
    .find((item) => normalizeNullableText(item?.cwd) === normalizedCwd);
  const trustedHooks = (Array.isArray(record?.hooks) ? record.hooks : [])
    // Session flags contain the host's command hook. Trust its exact hash
    // alongside project hooks; unrelated account and plugin hooks stay separate.
    .filter((hook) => hook?.enabled === true && ["project", "sessionFlags"].includes(hook?.source))
    .map((hook) => ({
      currentHash: normalizeNullableText(hook?.currentHash),
      key: normalizeNullableText(hook?.key),
      trustStatus: normalizeNullableText(hook?.trustStatus)
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
    trustedHooks.some(({ trustStatus }) => !["managed", "trusted"].includes(trustStatus))
  ) {
    await provider.writeHookTrustState(state);
  }
  // Native overrides replace the value at each key. Replacing the whole hooks
  // table would erase the PreToolUse hook installed through session flags.
  return { "hooks.state": state };
}

// What an exported catalogue was made from: the Codex binary, the catalogue
// source and added models, and the metadata (never the contents) of the home's
// account and configuration files. A bare command name has no binary identity,
// so its catalogue is exported on every start.
async function codexModelCatalogRevision({ command, codexHome, bundled, additionalModels }) {
  if (!path.isAbsolute(command)) return null;
  const identity = async (file) => {
    const found = await stat(file).catch(() => null);
    return found && [found.dev, found.ino, found.size, found.mtimeMs, found.ctimeMs];
  };
  const binary = await identity(command);
  if (!binary) return null;
  return createHash("sha256").update(JSON.stringify({
    command, binary, bundled, additionalModels,
    auth: await identity(path.join(codexHome, "auth.json")),
    config: await identity(path.join(codexHome, "config.toml"))
  })).digest("hex");
}

// Codex's model manager reads model_catalog_json once, before any threads
// exist. A thread override changes routing, but cannot supply model metadata.
// Export from the installed CLI so native model definitions stay CLI-owned.
// An app-server start reuses the runtime's exported catalogue until its
// revision changes, so reconnects and idle restarts run no exporter.
export async function prepareCodexModelCatalog({ command, runtimeDir, bundled = false, signal, additionalModels = [], codexHome }) {
  if (!codexHome) throw new TypeError("prepareCodexModelCatalog requires the Codex home whose configuration the catalogue reads.");
  const catalogPath = path.join(runtimeDir, "models.json");
  const revisionPath = path.join(runtimeDir, "models.revision");
  const revisionInput = { command, codexHome, bundled, additionalModels };
  const revision = await codexModelCatalogRevision(revisionInput);
  if (revision && await stat(catalogPath).then(() => true, () => false) &&
      await readFile(revisionPath, "utf8").catch(() => "") === revision) {
    return catalogPath;
  }
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
  const temporary = `${catalogPath}.tmp`;
  try {
    signal?.throwIfAborted();
    await rm(revisionPath, { force: true });
    await writeFile(temporary, JSON.stringify({ ...catalog, models: [...models.values()] }), { mode: 0o600 });
    await rename(temporary, catalogPath);
  } finally {
    await rm(temporary, { force: true });
  }
  // The exporter can refresh the account's tokens; record what it left behind.
  const exported = await codexModelCatalogRevision(revisionInput);
  if (exported) await writeFile(revisionPath, exported, { mode: 0o600 });
  return catalogPath;
}

// Read the same catalogue supplied to this runtime's native model manager.
// max_context_window advertises an extended window; it is not the normal budget.
export async function readCodexModelContextWindow({ runtimeDir, model } = {}) {
  if (typeof runtimeDir !== "string" || !path.isAbsolute(runtimeDir) ||
      typeof model !== "string" || !model.trim()) {
    throw new TypeError("A selected Codex runtime and exact model are required.");
  }
  try {
    const catalog = JSON.parse(await readFile(path.join(runtimeDir, "models.json"), "utf8"));
    const matches = catalog.models.filter(row => row?.slug === model);
    if (matches.length !== 1) throw new Error("Unknown model");
    const { context_window: windowTokens, effective_context_window_percent: percent } = matches[0];
    if (!Number.isSafeInteger(windowTokens) || windowTokens < 1 ||
        !Number.isSafeInteger(percent) || percent < 1 || percent > 100) throw new Error("Invalid context limit");
    const effectiveWindowTokens = Math.floor(windowTokens * percent / 100);
    if (effectiveWindowTokens < 1) throw new Error("Invalid effective context limit");
    return { model, windowTokens, effectiveWindowTokens };
  } catch {
    // A native catalogue can contain private provider configuration.
    throw new Error("Codex's normal context window is unavailable for the selected runtime and model.");
  }
}

export function codexAppServerTextHasControlCharacters(value = "") {
  return Array.from(String(value)).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

/** Interpret native catalogue responses without choosing application offerings. */
export function codexCatalogRows(value = null, createError = message => new Error(message)) {
  const rows = Array.isArray(value) ? value : value?.data;
  if (!Array.isArray(rows)) {
    throw createError("Codex did not return a usable live model catalog.");
  }
  return rows;
}

export function codexCatalogReasoningEfforts(model) {
  return new Set((Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [])
    .map((option) => normalizeNullableText(option?.reasoningEffort))
    .filter(Boolean));
}

export function codexCatalogModels(rows) {
  return rows.map((model) => ({
    id: normalizeNullableText(model.model),
    label: normalizeNullableText(model.displayName) || normalizeNullableText(model.model),
    status: "available",
    variants: [...codexCatalogReasoningEfforts(model)]
      .map((variantId) => ({
        id: normalizeNullableText(variantId),
        label: normalizeNullableText(variantId).replace(/^./u, (value) => value.toUpperCase())
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
      truncation_policy: { mode: "tokens", limit: 10000 },
      context_window: model.contextWindow,
      max_context_window: model.contextWindow,
      effective_context_window_percent: 95,
      supports_parallel_tool_calls: model.parallelToolCalls !== false,
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
      requires_openai_auth: false,
      // A custom endpoint may need no key; Codex then sends no Authorization header.
      ...(apiKey ? { experimental_bearer_token: apiKey } : {})
    }
  };
}

/** Where a curated provider home keeps the model catalogue its config.toml names. */
export function codexProviderCatalogPath(codexHome) {
  return path.join(codexHome, "models.json");
}

function codexProviderCatalogSetting(codexHome) {
  return `model_catalog_json = ${JSON.stringify(codexProviderCatalogPath(codexHome))}`;
}

/** Format a private native config file from an already-authorized provider and key. */
export function codexProviderFileConfiguration(provider, key, codexHome) {
  return [
    `model = ${JSON.stringify(provider.models[0].id)}`,
    `model_provider = ${JSON.stringify(provider.id)}`,
    codexProviderCatalogSetting(codexHome),
    ...(provider.models[0].defaultThinking ? [`model_reasoning_effort = ${JSON.stringify(provider.models[0].defaultThinking)}`] : []),
    'model_reasoning_summary = "none"',
    `web_search = "${provider.webSearch ? "live" : "disabled"}"`,
    `[model_providers.${provider.id}]`,
    `name = ${JSON.stringify(provider.label)}`,
    `base_url = ${JSON.stringify(provider.baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    ...(key ? [`experimental_bearer_token = ${JSON.stringify(key)}`] : []),
    ""
  ].join("\n");
}

/**
 * The catalogue rows of a home codexProviderFileConfiguration wrote for a
 * custom endpoint, whose model only its saved connection names; none for any
 * other home.
 */
export async function readCodexCustomModels(codexHome) {
  const config = await readFile(path.join(codexHome, "config.toml"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!/^model_provider = "custom"$/mu.test(config)) return [];
  const catalogue = JSON.parse(await readFile(codexProviderCatalogPath(codexHome), "utf8"));
  if (!Array.isArray(catalogue?.models)) throw new Error("Codex custom endpoint home is incomplete.");
  return catalogue.models;
}

/**
 * Copy a curated provider home's config and catalogue into another home, with
 * the copied config naming the copied catalogue. A config that does not name
 * its own home's catalogue exactly once is refused rather than left pointing
 * at the source home.
 */
export async function copyCodexProviderHome(sourceHome, targetHome) {
  const config = await readFile(path.join(sourceHome, "config.toml"), "utf8");
  const sourceSetting = codexProviderCatalogSetting(sourceHome);
  if (config.split(sourceSetting).length !== 2) {
    throw new Error("Codex provider config does not name its own model catalogue.");
  }
  await writeFile(codexProviderCatalogPath(targetHome),
    await readFile(codexProviderCatalogPath(sourceHome)), { mode: 0o600 });
  await writeFile(path.join(targetHome, "config.toml"),
    config.replace(sourceSetting, codexProviderCatalogSetting(targetHome)), { mode: 0o600 });
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
    // readable-check: allow optional-call - platform object: a fetch Response, whose body may be absent or lack cancel
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
