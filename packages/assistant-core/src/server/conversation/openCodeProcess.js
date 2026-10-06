import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenCodeServerClient, readBoundedResponse } from "./openCodeClient.js";
import { createLocalConversationExecution } from "./localExecution.js";
import { DISCOVERY_TOOL_DESCRIPTORS } from "../lib/serviceToolCatalog.js";
export { createOpenCodeSharedRuntime, openCodeServerForDirectory, readOpenCodeEnvironments, openCodeEnvironmentForDirectory,
  openCodeEnvironmentForSession, assertOpenCodeModelProvider, limitOpenCodeModelOutput,
  ensureOpenCodeSession, openCodeModel, sameOpenCodeSelection } from "./openCodeRuntime.js";
export { default as createOpenCodeConversationPlugin } from "./openCodePlugin.js";

export const OPENCODE_EXPECTED_VERSION = "1.18.31";
export const OPENCODE_HOST = "127.0.0.1";
export const OPENCODE_READY_TIMEOUT_MS = 30_000;
export const OPENCODE_STOP_TIMEOUT_MS = 3_000;

const OPENCODE_VERIFY_LIMIT_BYTES = 256 * 1024;
const OPENCODE_VERIFY_OUTPUT_TOKEN_MAX = 16;
const OPENCODE_VERIFY_TIMEOUT_MS = 30_000;
const OPENCODE_ZEN_CATALOG_LIMIT_BYTES = 2 * 1024 * 1024;
const OPENCODE_ZEN_CATALOG_TIMEOUT_MS = 5_000;
const OPENCODE_ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const OPENCODE_ZEN_PROVIDER_ID = "opencode";
const OPENCODE_ZEN_PUBLIC_API_KEY = "public";

function text(value = "") {
  return String(value ?? "").trim();
}

export function openCodeProcessEnvironment(baseEnv = {}, {
  cacheRoot = "", dbPath = "", inlineConfig = "", outputTokenMax = 0, password = ""
} = {}) {
  return {
    // OpenCode installs plugin dependencies through npm, which ignores XDG_CACHE_HOME.
    npm_config_cache: path.join(cacheRoot, "npm"),
    npm_config_prefer_offline: "true",
    NO_PROXY: [text(baseEnv.NO_PROXY), OPENCODE_HOST, "localhost", "::1"]
      .filter(Boolean)
      .join(","),
    OPENCODE_DB: dbPath,
    OPENCODE_CONFIG_CONTENT: inlineConfig,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_SHARE: "1",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
    OPENCODE_PRINT_LOGS: "0",
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: "opencode",
    ...(Number.isSafeInteger(outputTokenMax) && outputTokenMax > 0
      ? { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: String(outputTokenMax) }
      : {})
  };
}

async function availableLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, OPENCODE_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForOpenCodeReady({
  client,
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  processHandle,
  timeoutMs = OPENCODE_READY_TIMEOUT_MS,
  signal
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (processHandle.exited) {
      throw new Error("OpenCode exited before its server became ready.");
    }
    try {
      const probe = AbortSignal.timeout(Math.max(100, Math.min(2_000, deadline - Date.now())));
      const health = await client.health({
        signal: signal ? AbortSignal.any([signal, probe]) : probe
      });
      signal?.throwIfAborted();
      if (health?.healthy === true) {
        if (expectedVersion && text(health.version) !== expectedVersion) {
          const error = new Error(
            `OpenCode ${text(health.version) || "(unknown)"} is installed; this host requires ${expectedVersion}.`
          );
          error.code = "assistant_opencode_version_mismatch";
          throw error;
        }
        return health;
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error?.code === "assistant_opencode_version_mismatch") {
        throw error;
      }
      lastError = error;
    }
    await delay(100, undefined, { signal });
  }
  signal?.throwIfAborted();
  const error = new Error("OpenCode did not become ready before the startup deadline.");
  error.cause = lastError;
  error.code = "assistant_opencode_start_timeout";
  throw error;
}

const actionPermission = Object.fromEntries(DISCOVERY_TOOL_DESCRIPTORS.map(tool => [tool.name, "allow"]));
const nativePermission = { bash: "allow", read: "allow", write: "allow", edit: "allow",
  glob: "allow", grep: "allow", list: "allow", patch: "allow", apply_patch: "allow", todoread: "allow", todowrite: "allow" };
export const openCodeApplicationToolSchemas = DISCOVERY_TOOL_DESCRIPTORS.map(({ name, description, parameters }) => ({
  type: "function", function: { name, description, parameters }
}));

export function openCodeConversationAgent({ nativeTools = false, tools = false } = {}) {
  return `jskit-assistant${nativeTools ? "-coding" : ""}${tools ? "-actions" : ""}`;
}

export function openCodeConversationAgents({ sessionEnvironmentRegistry = "" } = {}) {
  const guarded = Boolean(text(sessionEnvironmentRegistry));
  return Object.fromEntries([false, true].flatMap(nativeTools => [false, true].map(tools => [
    openCodeConversationAgent({ nativeTools, tools }), {
      hidden: true, mode: "primary",
      // Keep native definitions behind approval, as in the original host agents.
      // The registered plugin rejects every ungranted native call before execution.
      permission: nativeTools || tools || guarded ? { "*": !nativeTools && guarded ? "ask" : "deny",
        ...(nativeTools ? nativePermission : {}), ...(tools ? actionPermission : {}) } : "deny"
    }
  ])));
}

/** Shared conversation configuration around the extracted server lifecycle. */
export async function createOpenCodeConversationServer({
  command = "opencode", execution = createLocalConversationExecution(), env = process.env,
  workdir, stateDirectory, databasePath, sessionEnvironmentRegistry, connection, maxOutputTokens,
  onStarted, onFailure, executionLimits, signal
} = {}) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(stateDirectory, "process-"));
  const model = `${connection.providerId}/${connection.model}`;
  const configuration = {
    autoupdate: false, share: "disabled", snapshot: false, permission: "deny",
    model, small_model: model, default_agent: "jskit-assistant",
    enabled_providers: [connection.providerId],
    agent: openCodeConversationAgents({ sessionEnvironmentRegistry }),
    plugin: [new URL("./openCodePlugin.js", import.meta.url).href],
    provider: { [connection.providerId]: {
      npm: connection.sdkPackage,
      ...(connection.modelLimits ? { models: { [connection.model]: {
        // The authorized application catalogue selects this exact model. Do not
        // inherit a native catalogue alias or its availability classification.
        id: connection.model, name: connection.model, status: "active", limit: connection.modelLimits
      } } } : {}),
      options: { ...(connection.baseURL ? { baseURL: connection.baseURL } : {}) }
    } }
  };
  // No inherited account/config variables: only the selected authorized connection
  // is installed into this process's private credential home.
  const environment = Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|LANG|LC_\w+|TZ|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/u.test(key)));
  Object.assign(environment, {
    HOME: path.join(directory, "home"), XDG_CONFIG_HOME: path.join(directory, "config"),
    XDG_DATA_HOME: path.join(directory, "data"), XDG_STATE_HOME: path.join(directory, "state"),
    XDG_CACHE_HOME: path.join(stateDirectory, "cache"),
    ...openCodeProcessEnvironment(env, { cacheRoot: path.join(stateDirectory, "cache"),
      dbPath: databasePath, inlineConfig: JSON.stringify(configuration), outputTokenMax: maxOutputTokens }),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    JSKIT_OPENCODE_ENV_REGISTRY: sessionEnvironmentRegistry,
    JSKIT_OPENCODE_TOOL_SCHEMAS: JSON.stringify(openCodeApplicationToolSchemas)
  });
  return createOpenCodeServerProcess({ command, execution, env: environment, workdir, privateRoot: directory,
    directory: workdir, connections: [connection], onStarted: id => onStarted?.(id, directory),
    onFailure, executionLimits, signal });
}

/** Shared server lifecycle for standalone and managed hosts. */
export async function createOpenCodeServerProcess({
  command = "opencode", execution = createLocalConversationExecution(), env = process.env,
  workdir, privateRoot, directory = "", connections = [], port = 0, fetchImpl = globalThis.fetch,
  allowAttachmentDirectories = false, expectedVersion = OPENCODE_EXPECTED_VERSION, readinessTimeoutMs = OPENCODE_READY_TIMEOUT_MS,
  onStarted, onFailure, executionLimits, signal
} = {}) {
  if (!path.isAbsolute(workdir || "") || !path.isAbsolute(privateRoot || "")) {
    throw new TypeError("OpenCode server processes require absolute working and private roots.");
  }
  const selectedPort = Number(port) || await availableLoopbackPort();
  const baseUrl = `http://${OPENCODE_HOST}:${selectedPort}`;
  const password = randomBytes(32).toString("base64url");
  const environment = { ...env, OPENCODE_SERVER_USERNAME: "opencode", OPENCODE_SERVER_PASSWORD: password };
  const client = createOpenCodeServerClient({ baseUrl, password, directory, fetchImpl, allowAttachmentDirectories });
  let native;
  let executionId;
  let closing = false;
  let stopped = false;
  let stopPromise = null;
  const logPath = path.join(privateRoot, "opencode-server.log");
  const processHandle = {
    get exited() { return stopped || native?.running === false; },
    async stop() {
      const proof = await execution.stop(executionId, {
        allowMissingRecordScopeRecovery: true,
        reason: "opencode-server-stop",
        termTimeoutMs: OPENCODE_STOP_TIMEOUT_MS
      });
      stopped = proof?.scopeEmpty === true;
      return { ...(proof && typeof proof === "object" ? proof : {}), exited: stopped };
    }
  };
  function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    closing = true;
    const stopping = Promise.resolve().then(async () => {
      const exitProof = executionId
        ? await processHandle.stop()
        : { code: null, exited: true, signal: "", scopeEmpty: true };
      if (exitProof.exited === true) {
        await rm(privateRoot, { force: true, recursive: true });
      }
      return exitProof;
    });
    stopPromise = stopping;
    void stopping.then((proof) => {
      if (proof?.exited !== true && stopPromise === stopping) stopPromise = null;
    }, () => {
      if (stopPromise === stopping) stopPromise = null;
    });
    return stopPromise;
  }
  try {
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
      if (environment[name]) await mkdir(environment[name], { recursive: true, mode: 0o700 });
    }
    signal?.throwIfAborted();
    await writeFile(logPath, "", { mode: 0o600 });
    native = await execution.start({ command, cwd: workdir, env: environment, limits: executionLimits,
      logPath, args: ["serve", "--hostname", OPENCODE_HOST, "--port", String(selectedPort), "--mdns=false"] });
    executionId = native.id;
    await onStarted?.(native.id);
    const fail = error => { if (!closing) Promise.resolve().then(() => onFailure?.(error)).catch(() => {}); };
    native.exited.then(() => fail(new Error("The owned OpenCode process exited."))).catch(fail);
    const health = await waitForOpenCodeReady({ client, expectedVersion, processHandle, timeoutMs: readinessTimeoutMs, signal });
    const authenticated = new Set();
    for (const connection of connections) {
      const providerId = text(connection?.providerId);
      const key = String(connection?.apiKey || "");
      if (!providerId || !key || authenticated.has(providerId)) {
        continue;
      }
      await client.authenticateApiKey(providerId, key, { signal });
      authenticated.add(providerId);
    }
    return Object.freeze({ client, executionId: native.id, privateRoot, pid: native.pid, port: selectedPort,
      environment, health: Object.freeze({ ...health }), modelProviderIds: Object.freeze([...authenticated]),
      readLogs: () => native.readLogs?.() || { stderr: "", stdout: "" }, stop,
      attachArguments({ conversationId, directory }) {
        if (!conversationId || !path.isAbsolute(directory || "")) throw new TypeError("An OpenCode terminal requires a conversation and absolute directory.");
        return ["attach", baseUrl, "--dir", directory, "--session", conversationId, "--pure"];
      }
    });
  } catch (error) {
    error.code ||= "assistant_opencode_start_failed";
    executionId ||= error.executionId;
    error.executionId = executionId;
    if (!native && executionId) {
      try { await onStarted?.(executionId); }
      catch (bindingError) { error.bindingError = bindingError; }
    }
    try { error.details = native?.readLogs?.() || { stderr: "", stdout: "" }; }
    catch (logError) { error.logError = logError; }
    try { error.stopProof = await stop(); }
    catch (cleanupError) { error.cleanupError = cleanupError; error.stopProof = { scopeEmpty: false }; }
    if (!error.stopProof.scopeEmpty) {
      error.cleanupFailed = true;
      error.retryCleanup = stop;
    }
    throw error;
  }
}

function openCodeZenCatalogError(cause = null) {
  const error = new Error("OpenCode Zen's current model list could not be read. Try again.", {
    cause
  });
  error.code = "assistant_opencode_zen_catalog_unavailable";
  error.retryable = true;
  error.statusCode = 503;
  return error;
}

export async function readOpenCodeZenModelIds({
  fetchImpl = globalThis.fetch,
  timeoutMs = OPENCODE_ZEN_CATALOG_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("OpenCode Zen catalogue reads require fetch().");
  }
  try {
    const response = await fetchImpl(OPENCODE_ZEN_MODELS_URL, {
      headers: { accept: "application/json" },
      method: "GET",
      signal: AbortSignal.timeout(Math.max(100, Math.min(30_000, Number(timeoutMs) || 0)))
    });
    if (!response?.ok) {
      throw new Error(`OpenCode Zen returned HTTP ${Number(response?.status) || 0}.`);
    }
    const payload = JSON.parse(await readBoundedResponse(
      response,
      OPENCODE_ZEN_CATALOG_LIMIT_BYTES
    ));
    if (!Array.isArray(payload?.data) || payload.data.length === 0) {
      throw new Error("OpenCode Zen returned an empty model list.");
    }
    const ids = payload.data.map((model) => text(model?.id));
    const uniqueIds = new Set(ids);
    if (ids.some((id) => !id) || uniqueIds.size !== ids.length) {
      throw new Error("OpenCode Zen returned an invalid model list.");
    }
    return Object.freeze([...uniqueIds].sort((left, right) => left.localeCompare(right)));
  } catch (error) {
    if (error?.code === "assistant_opencode_zen_catalog_unavailable") {
      throw error;
    }
    throw openCodeZenCatalogError(error);
  }
}

export async function readOpenCodeCatalog({
  createServerProcess,
  privateRoot = "",
  workdir = ""
} = {}) {
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode catalogue reads require private and working roots.");
  }
  const authRoot = path.join(normalizedPrivateRoot, "data", "opencode");
  await mkdir(authRoot, { mode: 0o700, recursive: true });
  await writeFile(
    path.join(authRoot, "auth.json"),
    `${JSON.stringify({
      [OPENCODE_ZEN_PROVIDER_ID]: {
        key: OPENCODE_ZEN_PUBLIC_API_KEY,
        type: "api"
      }
    })}\n`,
    { mode: 0o600 }
  );
  const server = await createServerProcess({
    dbPath: path.join(normalizedPrivateRoot, "opencode.db"),
    privateRoot: normalizedPrivateRoot,
    providerConnections: [],
    workdir: normalizedWorkdir
  });
  let catalog;
  let readError;
  try {
    const [providers, agents] = await Promise.all([
      server.client.providers({ directory: server.workdir }),
      server.client.agents({ directory: server.workdir })
    ]);
    catalog = { agents, providers };
  } catch (error) {
    readError = error;
  }
  const stopped = await server.stop();
  if (stopped?.exited !== true) {
    const error = new Error("The temporary OpenCode catalogue process did not stop cleanly.");
    error.code = "assistant_opencode_catalog_stop_failed";
    throw error;
  }
  if (readError) {
    throw readError;
  }
  return catalog;
}

export async function verifyOpenCodeApiKey({
  apiKey = "",
  agentId = openCodeConversationAgent(),
  prepareCommand,
  modelId = "",
  modelProviderId = "",
  privateRoot = "",
  workdir = ""
} = {}) {
  const key = String(apiKey || "");
  const providerId = text(modelProviderId);
  const selectedModelId = text(modelId);
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!key || !providerId || !selectedModelId || !text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode API-key verification requires a key, provider, model, and isolated roots.");
  }
  try {
    await Promise.all([
      mkdir(path.join(normalizedPrivateRoot, "data", "opencode"), {
        mode: 0o700,
        recursive: true
      }),
      mkdir(normalizedWorkdir, { recursive: true })
    ]);
    await writeFile(
      path.join(normalizedPrivateRoot, "data", "opencode", "auth.json"),
      `${JSON.stringify({ [providerId]: { key, type: "api" } })}\n`,
      { mode: 0o600 }
    );
    const commandRunner = prepareCommand({
      providerId,
      modelId: selectedModelId,
      privateRoot: normalizedPrivateRoot,
      workdir: normalizedWorkdir,
      outputTokenMax: OPENCODE_VERIFY_OUTPUT_TOKEN_MAX
    });
    let result;
    try {
      result = await commandRunner({
        args: [
          "run",
          "--pure",
          "--agent",
          agentId,
          "--model",
          `${providerId}/${selectedModelId}`,
          "--format",
          "json",
          "Reply only OK."
        ],
        maxBuffer: OPENCODE_VERIFY_LIMIT_BYTES,
        mode: "capture",
        timeout: OPENCODE_VERIFY_TIMEOUT_MS
      });
    } catch {
      const error = new Error("OpenCode API-key verification could not run.");
      error.code = "assistant_opencode_key_verification_unavailable";
      error.retryable = true;
      error.statusCode = 503;
      throw error;
    }
    if (result?.ok !== true) {
      const exitCode = Number(result?.exitCode);
      const unavailable = result?.timedOut === true ||
        result?.retryable === true ||
        Boolean(text(result?.code)) ||
        (Number.isSafeInteger(exitCode) && exitCode !== 1);
      const error = new Error(unavailable
        ? "OpenCode API-key verification could not run."
        : "OpenCode rejected the API-key verification request.");
      error.code = unavailable
        ? "assistant_opencode_key_verification_unavailable"
        : "assistant_opencode_key_verification_failed";
      error.retryable = unavailable;
      error.statusCode = unavailable ? 503 : 422;
      throw error;
    }
    return Object.freeze({ ok: true });
  } finally {
    await rm(normalizedPrivateRoot, { force: true, recursive: true });
  }
}
