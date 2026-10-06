import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CodexAppServerJsonRpcClient, socketPathFromCodexAppServerEndpoint } from "./codexClient.js";
import { createConversationProcessIdentity } from "./localExecution.js";
import { isPlainObject, normalizeText } from "./normalize.js";
import { prepareCodexModelCatalog } from "./codexConfiguration.js";
import { startCodexHistoryAdapter } from "./codexHistoryAdapter.js";

const CODEX_APP_SERVER_METADATA_FILE = "runtime.json";
const CODEX_APP_SERVER_LOCK_DIR = "runtime.lock";
const CODEX_APP_SERVER_LOCK_TIMEOUT_MS = 10000;
const CODEX_APP_SERVER_LOCK_STALE_MS = 120000;
const CODEX_APP_SERVER_EXECUTION_MODES = Object.freeze({ HELPER: "helper", INTERACTIVE: "interactive" });
const runtimeProcessIdentity = createConversationProcessIdentity();

// Run in the host-owned execution's leader, independently of subscribers.
export async function runCodexAppServerProcess({
  runtimeDir, command, args = [], runtimeToken: token, bundled = false, additionalModels = []
}) {
  const descriptor = path.join(runtimeDir, "history-adapter.json");
  const startup = new AbortController();
  const abortStartup = () => startup.abort();
  process.once("SIGTERM", abortStartup);
  process.once("SIGINT", abortStartup);
  const catalogPath = await prepareCodexModelCatalog({
    command,
    runtimeDir,
    bundled,
    additionalModels,
    signal: startup.signal
  });
  const adapter = await startCodexHistoryAdapter({ token, codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex") });
  await writeFile(`${descriptor}.tmp`, JSON.stringify({ baseUrl: adapter.baseUrl, runtimeToken: token }), { mode: 0o600 });
  await rename(`${descriptor}.tmp`, descriptor);
  const child = spawn(command, [...args, "-c", `model_catalog_json=${JSON.stringify(catalogPath)}`], { stdio: "inherit" });
  let stopping = false;
  let forceExit;
  function stop(signal = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    void adapter.close();
    child.kill(signal);
    forceExit = setTimeout(() => child.kill("SIGKILL"), 5000);
    forceExit.unref();
  }
  process.on("SIGTERM", () => stop());
  process.on("SIGINT", () => stop("SIGINT"));
  process.removeListener("SIGTERM", abortStartup);
  process.removeListener("SIGINT", abortStartup);
  if (startup.signal.aborted) stop();
  adapter.server.on("error", () => { process.exitCode = 1; stop(); });
  const result = await new Promise((resolve) => {
    child.once("error", () => resolve({ code: 1 }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(forceExit);
  await adapter.close();
  await rm(descriptor, { force: true });
  process.exitCode ||= result.code ?? (stopping ? 0 : 1);
}

async function ensurePrivateDirectory(dirPath = "") {
  await mkdir(dirPath, {
    mode: 0o700,
    recursive: true
  });
  await chmod(dirPath, 0o700).catch(() => null);
}

export async function ensureWritablePrivateDirectory(dirPath = "") {
  await ensurePrivateDirectory(dirPath);
  const probePath = path.join(dirPath, `.jskit-write-check-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(probePath, "", {
      mode: 0o600
    });
  } catch (error) {
    throw new Error(
      `Codex app-server runtime directory is not writable: ${dirPath}. ${String(error?.message || error)}`
    );
  } finally {
    await rm(probePath, {
      force: true
    }).catch(() => null);
  }
}

export function codexAppServerMetadataPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_METADATA_FILE);
}

function codexAppServerLockDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOCK_DIR);
}

export function normalizeCodexAppServerMetadata(metadata = {}) {
  const normalized = isPlainObject(metadata) ? metadata : {};
  const endpoint = normalizeText(normalized.endpoint);
  return {
    accountIdentitySignature: normalizeText(normalized.accountIdentitySignature),
    attachmentHostRoot: normalizeText(normalized.attachmentHostRoot),
    authStateSignature: normalizeText(normalized.authStateSignature),
    endpoint,
    executionId: normalizeText(normalized.executionId),
    executionMode: normalizeText(normalized.executionMode) || CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
    executionContextHash: normalizeText(normalized.executionContextHash),
    healthz: normalizeText(normalized.healthz),
    historyAdapterBaseUrl: normalizeText(normalized.historyAdapterBaseUrl),
    logPath: normalizeText(normalized.logPath),
    pid: Number.isSafeInteger(Number(normalized.pid)) ? Number(normalized.pid) : null,
    processCwd: normalizeText(normalized.processCwd),
    processExitVerifiedAt: normalizeText(normalized.processExitVerifiedAt),
    processIdentity: runtimeProcessIdentity.normalize(normalized.processIdentity),
    processState: normalizeText(normalized.processState),
    provider: normalizeText(normalized.provider),
    readyz: normalizeText(normalized.readyz),
    runtimeDir: normalizeText(normalized.runtimeDir),
    runtimesHash: normalizeText(normalized.runtimesHash),
    schemaVersion: Number(normalized.schemaVersion || 0),
    socketPath: normalizeText(normalized.socketPath),
    startedAt: normalizeText(normalized.startedAt),
    terminalEnvHash: normalizeText(normalized.terminalEnvHash),
    toolHomeSource: normalizeText(normalized.toolHomeSource),
    transport: normalizeText(normalized.transport)
  };
}

export async function readCodexAppServerMetadata(runtimeDir = "") {
  try {
    const metadata = JSON.parse(await readFile(codexAppServerMetadataPath(runtimeDir), "utf8"));
    return normalizeCodexAppServerMetadata(metadata);
  } catch {
    return null;
  }
}

export async function writeCodexAppServerMetadata(runtimeDir = "", metadata = {}) {
  await ensureWritablePrivateDirectory(runtimeDir);
  const metadataPath = codexAppServerMetadataPath(runtimeDir);
  const tempPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600
  });
  await chmod(tempPath, 0o600).catch(() => null);
  await rename(tempPath, metadataPath);
  await chmod(metadataPath, 0o600).catch(() => null);
}

export async function fileExists(filePath = "") {
  try {
    const entry = await stat(filePath);
    return entry.isSocket() || entry.isFile();
  } catch {
    return false;
  }
}

export async function tailTextFile(filePath = "", maxBytes = 4096) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.slice(-maxBytes);
  } catch {
    return "";
  }
}

async function readLockOwner(lockDir = "") {
  try {
    return JSON.parse(await readFile(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    return {};
  }
}

async function lockIsStale(lockDir = "") {
  const owner = await readLockOwner(lockDir);
  if (owner.pid && runtimeProcessIdentity.isProcessAlive(owner.pid)) {
    const createdAtMs = Date.parse(owner.createdAt || "");
    return Number.isFinite(createdAtMs) && Date.now() - createdAtMs > CODEX_APP_SERVER_LOCK_STALE_MS;
  }
  return true;
}

export async function acquireCodexRuntimeLock(runtimeDir = "", {
  busyCode = "codex_runtime_busy",
  timeoutMs = CODEX_APP_SERVER_LOCK_TIMEOUT_MS
} = {}) {
  await ensureWritablePrivateDirectory(runtimeDir);
  const lockDir = codexAppServerLockDir(runtimeDir);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await mkdir(lockDir, {
        mode: 0o700
      });
      await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid
      })}\n`, {
        mode: 0o600
      });
      return async () => {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await lockIsStale(lockDir)) {
        await rm(lockDir, {
          force: true,
          recursive: true
        });
        continue;
      }
      await delay(100);
    }
  }
  const error = new Error("Codex is still reconnecting: its shared runtime is busy starting or stopping. Please try again shortly.");
  error.code = busyCode;
  error.retryable = true;
  throw error;
}

export const CODEX_APP_SERVER_METADATA_SCHEMA_VERSION = 19;

const CODEX_APP_SERVER_PROVIDER_ID = "codex_app_server";

export const CODEX_APP_SERVER_TRANSPORT = Object.freeze({
  UNIX: "unix"
});

export const CODEX_APP_SERVER_RUNTIME_DIR_NAME = "codex-app-server";

const CODEX_APP_SERVER_LOG_FILE = "app-server.log";

const CODEX_APP_SERVER_SOCKET_FILE = "app-server.sock";

const CODEX_APP_SERVER_READY_TIMEOUT_MS = 60000;

const CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS = 2000;

const CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_STARTER_ADDRESS",
  "DBUS_STARTER_BUS_TYPE"
]);

const CODEX_APP_SERVER_HELPER_HOME_DIR = "codex-home";

const CODEX_APP_SERVER_HELPER_WORKSPACE_DIR = "workspace";

const CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES = process.platform === "linux" ? 107 : 103;

const CODEX_APP_SERVER_ENDPOINT_STATUS = Object.freeze({
  MISSING: "missing",
  RESPONSIVE: "responsive",
  TIMEOUT: "timeout",
  UNREACHABLE: "unreachable"
});

const CODEX_APP_SERVER_RUNTIME_STATUS = Object.freeze({
  EXITED: "exited",
  INCOMPATIBLE: "incompatible",
  LIVE: "live",
  MISSING: "missing",
  SUSPECT: "suspect"
});

export const CODEX_APP_SERVER_PROCESS_STATE = Object.freeze({
  RUNNING: "running",
  STOPPED: "stopped"
});

const CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS = Object.freeze({
  ABSENT: "absent",
  AMBIGUOUS: "ambiguous",
  EXACT: "exact",
  INVALID: "invalid",
  MISMATCH: "mismatch"
});

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function stableHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

export function codexAppServerExecutionMode(options = {}) {
  return normalizeText(options.executionMode) === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
    ? CODEX_APP_SERVER_EXECUTION_MODES.HELPER
    : CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE;
}

export function codexAppServerIsHelper(options = {}) {
  return codexAppServerExecutionMode(options) === CODEX_APP_SERVER_EXECUTION_MODES.HELPER;
}

export async function assertExistingDirectory(dirPath = "", label = "directory") {
  const normalizedPath = normalizeText(dirPath);
  if (!normalizedPath) {
    return;
  }
  const stats = await stat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${normalizedPath}`);
  }
}

export function codexAppServerHelperHomeDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_HELPER_HOME_DIR);
}

export function codexAppServerHelperWorkspaceDir(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_HELPER_WORKSPACE_DIR);
}

function codexAppServerHelperCommandBaseEnv(env = process.env, codexHome = "") {
  const source = isPlainObject(env) ? env : {};
  const cleared = Object.fromEntries(Object.keys({
    ...process.env,
    ...source
  }).map((name) => [name, ""]));
  const allowedNames = [
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TERM",
    "TMPDIR",
    "TZ"
  ];
  return {
    ...cleared,
    ...Object.fromEntries(allowedNames
      .filter((name) => typeof source[name] === "string" && source[name])
      .map((name) => [name, source[name]])),
    CODEX_HOME: codexHome
  };
}

function codexAppServerLogPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOG_FILE);
}

function codexAppServerSocketPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_SOCKET_FILE);
}

function codexAppServerSocketPathBytes(socketPath = "") {
  return Buffer.byteLength(String(socketPath || ""), "utf8");
}

function codexAppServerSocketPathTooLong(socketPath = "") {
  return codexAppServerSocketPathBytes(socketPath) > CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES;
}

function codexAppServerUnixEndpoint(socketPath = "") {
  return `unix://${socketPath}`;
}

function codexAppServerProjectTrustOverride(workdir = "") {
  const normalizedWorkdir = normalizeText(workdir);
  if (!normalizedWorkdir) {
    return "";
  }
  const projectRoot = path.resolve(normalizedWorkdir);
  return `projects={${JSON.stringify(projectRoot)}={trust_level="trusted"}}`;
}

export function codexAppServerProcessCwd({
  executionRoot = "",
  runtimeDir = "",
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeText(workdir) ? path.resolve(workdir) : "";
  if (normalizedWorkdir) {
    return normalizedWorkdir;
  }
  const normalizedExecutionRoot = normalizeText(executionRoot) ? path.resolve(executionRoot) : "";
  if (normalizedExecutionRoot) {
    return normalizedExecutionRoot;
  }
  return normalizeText(runtimeDir) ? path.resolve(runtimeDir) : "";
}

function codexAppServerRuntimeDirIsManaged(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeText(runtimeDir);
  if (!normalizedRuntimeDir) {
    return false;
  }
  const basename = path.basename(path.resolve(normalizedRuntimeDir));
  return basename === CODEX_APP_SERVER_RUNTIME_DIR_NAME ||
    basename.startsWith(`${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-`);
}

async function removeCodexAppServerRuntimeDir(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeText(runtimeDir);
  if (!codexAppServerRuntimeDirIsManaged(normalizedRuntimeDir)) {
    return false;
  }
  await rm(normalizedRuntimeDir, {
    force: true,
    recursive: true
  });
  return true;
}

async function removeCodexAppServerMetadataTemps(runtimeDir = "") {
  let names = [];
  try {
    names = await readdir(runtimeDir);
  } catch {
    return;
  }
  await Promise.all(names
    .filter((name) => name.startsWith(`${CODEX_APP_SERVER_METADATA_FILE}.`) && name.endsWith(".tmp"))
    .map((name) => rm(path.join(runtimeDir, name), { force: true })));
}

function codexAppServerRuntimeCleanupCanSkip(error) {
  return ["EACCES", "EPERM", "ENOENT"].includes(String(error?.code || ""));
}

export function codexAppServerRuntimeIdentity(runtime = {}) {
  return [
    normalizeText(runtime.accountIdentitySignature),
    normalizeText(runtime.authStateSignature),
    normalizeText(runtime.endpoint),
    normalizeText(runtime.executionId),
    normalizeText(runtime.executionMode),
    normalizeText(runtime.runtimesHash),
    normalizeText(runtime.terminalEnvHash),
    normalizeText(runtime.socketPath),
    normalizeText(runtime.startedAt),
    normalizeText(runtime.pid)
  ].join("\0");
}

export function normalizeCodexAppServerTerminalEnv(terminalEnv = {}) {
  if (!isPlainObject(terminalEnv)) {
    return {};
  }
  return Object.fromEntries(Object.entries(terminalEnv)
    .map(([name, value]) => [
      normalizeText(name),
      String(value ?? "")
    ])
    .filter(([name, value]) => (
      name &&
      String(value || "") &&
      !CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES.has(name)
    )));
}

export function codexAppServerCommandBaseEnv({
  env = process.env,
  terminalEnv = {}
} = {}) {
  const baseEnv = {
    ...env,
    ...normalizeCodexAppServerTerminalEnv(terminalEnv)
  };
  for (const name of CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES) {
    delete baseEnv[name];
  }
  return baseEnv;
}

export function codexAppServerCredentialHome(toolHomeSource = "", baseEnv = {}) {
  const home = normalizeText(toolHomeSource);
  if (!home) {
    return {};
  }
  return {
    home,
    username: normalizeText(baseEnv.USER || baseEnv.LOGNAME)
  };
}

export function codexAppServerTerminalEnvHash(terminalEnv = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeCodexAppServerTerminalEnv(terminalEnv))
    .sort(([left], [right]) => left.localeCompare(right))));
}

function codexHistoryAdapterUrlIsValid(baseUrl, token) {
  // The previous adapter cannot serve thread-bound compaction recovery. Keep
  // its process identity readable, but retire it through normal owned cleanup.
  const match = typeof baseUrl === "string" && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/[0-9a-f-]{36}\/v2$/iu.exec(baseUrl);
  return Boolean(match && Number(match[1]) <= 65535 && baseUrl.endsWith(`/${token}/v2`));
}

function codexAppServerLivenessTimeoutMs(options = {}) {
  return normalizePositiveInteger(
    options.livenessTimeoutMs,
    normalizePositiveInteger(options.timeoutMs, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS)
  );
}

function codexAppServerProcessCommandHash({
  codexArgs = [],
  codexCommand = "",
  executionMode = "",
  processCwd = "",
  runtimeDir = ""
} = {}) {
  return stableHash(JSON.stringify({
    codexArgs,
    codexCommand: normalizeText(codexCommand),
    executionMode: codexAppServerExecutionMode({ executionMode }),
    processCwd: normalizeText(processCwd),
    runtimeDir: normalizeText(runtimeDir)
  }));
}

const codexAppServerRuntimePreparations = new Map();

/** The production shared runtime: one process owner per stable runtime directory.
 * Execution and credential facilities retain host policy; threads do not own this process.
 */
export function createCodexAppServerRuntime({ execution, credentials, configuration = {} }) {
  const {
    clientInfo = { name: "jskit", title: "JSKIT", version: "0.1.0" },
    commandHookCommand,
    errorPrefix = "",
    modelCatalogEnvironmentName = "JSKIT_CODEX_MODEL_CATALOG_SOURCE",
    processLabel = "jskit-codex-app-server",
    processPath = fileURLToPath(new URL("./codexProcessLeader.js", import.meta.url)),
    runtimeTokenEnvironmentName = "JSKIT_EXECUTION_RUNTIME_TOKEN",
    commandHashEnvironmentName = "JSKIT_EXECUTION_COMMAND_HASH",
    socketPathHelp = "Configure a shorter host runtime directory.",
    umask = "0007"
  } = configuration;
  const CODEX_APP_SERVER_PROCESS_PATH = processPath;
  const CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV = runtimeTokenEnvironmentName;
  const CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV = commandHashEnvironmentName;
  const codexProcessIdentity = createConversationProcessIdentity({
    runtimeTokenEnvironmentName, commandHashEnvironmentName,
    label: "Codex app-server",
    unavailableCode: `${errorPrefix}codex_app_server_process_identity_unavailable`
  });
  const codexAppServerProcessIdentityIsWellFormed = codexProcessIdentity.isValid;
  const captureCodexAppServerProcessIdentity = codexProcessIdentity.capture;
  const currentCodexAccountIdentitySignature = credentials.identity;
  const currentCodexAuthStateSignature = credentials.generation;
  const assertCodexAuthGenerationCurrent = credentials.assertCurrent;

  function codexAppServerSessionCommandHookConfig() {
    const command = commandHookCommand;
    return `hooks.PreToolUse=[{matcher="^Bash$",hooks=[{type="command",command=${JSON.stringify(command)},timeout=30}]}]`;
  }

  async function acquireRuntimeLock(runtimeDir = "", options = {}) {
    await execution.prepare?.();
    return acquireCodexRuntimeLock(runtimeDir, { ...options, busyCode: `${errorPrefix}codex_app_server_runtime_busy` });
  }

  const CODEX_APP_SERVER_MANAGED_UMASK = umask;

  const CODEX_APP_SERVER_MANAGED_SHELL = "/bin/sh";

  const CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT = [
    `umask ${CODEX_APP_SERVER_MANAGED_UMASK}`,
    `unset ${[...CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES].join(" ")}`,
    'exec "$@"'
  ].join("\n");

  const CODEX_APP_SERVER_HELPER_STARTUP_SCRIPT = [
    `umask ${CODEX_APP_SERVER_MANAGED_UMASK}`,
    "exec /usr/bin/env -i \\",
    '  HOME="$HOME" LOGNAME="$LOGNAME" USER="$USER" PATH="$PATH" \\',
    '  CODEX_HOME="$CODEX_HOME" LANG="$LANG" LC_ALL="$LC_ALL" LC_CTYPE="$LC_CTYPE" \\',
    `  ${CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV}="$${CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV}" ${CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV}="$${CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV}" \\`,
    '  SSL_CERT_DIR="$SSL_CERT_DIR" SSL_CERT_FILE="$SSL_CERT_FILE" TERM="$TERM" TMPDIR="$TMPDIR" TZ="$TZ" \\',
    '  "$@"'
  ].join("\n");

  function codexAppServerProcessMetadataIsIdentifiable(metadata = {}, runtimeDir = "") {
    const normalizedRuntimeDir = normalizeText(runtimeDir);
    return Boolean(
      Number(metadata.schemaVersion) === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
      metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
      Number.isSafeInteger(Number(metadata.pid)) && Number(metadata.pid) > 0 &&
      (!normalizedRuntimeDir || metadata.runtimeDir === normalizedRuntimeDir) &&
      codexAppServerProcessIdentityIsWellFormed(metadata.processIdentity) &&
      [
        CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
        CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      ].includes(metadata.processState)
    );
  }

  async function inspectCodexAppServerProcessIdentity(metadata = {}, options = {}) {
    if (typeof options.processIdentityInspector === "function") {
      return codexProcessIdentity.normalizeInspection(await options.processIdentityInspector(metadata));
    }
    if (!codexAppServerProcessMetadataIsIdentifiable(metadata)) {
      return { processGroupIds: [], status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID };
    }
    return codexProcessIdentity.inspect(metadata);
  }

  async function stopCodexAppServerProcessGroup(metadata = {}, options = {}) {
    if (!codexAppServerProcessMetadataIsIdentifiable(metadata)) {
      return {
        identityStatus: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID,
        processExitVerified: false,
        stopped: false
      };
    }
    return codexProcessIdentity.stop(metadata, {
      ...options,
      processIdentityInspector: (current) => inspectCodexAppServerProcessIdentity(current, options)
    });
  }

  function assertCodexAppServerSocketPathSupported(socketPath = "") {
    if (!codexAppServerSocketPathTooLong(socketPath)) {
      return;
    }
    throw new Error(
      `Codex app-server Unix socket path is too long for this OS: ${socketPath} ` +
      `(${codexAppServerSocketPathBytes(socketPath)} bytes, max ${CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES}). ` +
      socketPathHelp
    );
  }

  async function stopOwnedCodexAppServerExecution(metadata = {}, options = {}) {
    if (
      metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED &&
      metadata.processExitVerifiedAt
    ) {
      return stopCodexAppServerProcessGroup(metadata, options);
    }
    const executionId = normalizeText(metadata.executionId);
    if (executionId) {
      const stopExecution = typeof options.stopExecution === "function"
        ? options.stopExecution
        : execution.stop;
      let executionStop;
      try {
        executionStop = await stopExecution(executionId, {
          allowMissingRecordScopeRecovery: true,
          killTimeoutMs: options.killTimeoutMs,
          reason: options.reason || "codex-app-server-stop",
          termTimeoutMs: options.termTimeoutMs
        });
      } catch (error) {
        return {
          error: String(error?.message || error || "The owned execution could not be stopped."),
          executionId,
          processExitVerified: false,
          scopeEmpty: false,
          stopped: false
        };
      }
      if (executionStop?.ok === true && executionStop?.scopeEmpty === true) {
        return {
          ...executionStop,
          executionId,
          processExitVerified: true,
          stopped: executionStop.stopped === true
        };
      }
      if (typeof options.stopExecution === "function" || execution.authoritative) {
        return {
          ...(executionStop && typeof executionStop === "object" ? executionStop : {}),
          executionId,
          processExitVerified: false,
          scopeEmpty: false,
          stopped: false
        };
      }
    }
    return stopCodexAppServerProcessGroup(metadata, options);
  }

  async function stopCodexAppServerProcess(runtimeDir = "", options = {}) {
    const normalizedRuntimeDir = normalizeText(runtimeDir);
    if (!normalizedRuntimeDir) {
      return {
        processExitVerified: false,
        stopped: false
      };
    }
    const metadata = await readCodexAppServerMetadata(normalizedRuntimeDir);
    if (!codexAppServerProcessMetadataIsIdentifiable(metadata, normalizedRuntimeDir)) {
      return {
        identityStatus: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID,
        processExitVerified: false,
        stopped: false
      };
    }
    return stopOwnedCodexAppServerExecution(metadata, options);
  }

  async function cleanupFailedCodexAppServerStart(runtimeDir = "", {
    helper = false,
    executionId = "",
    neverStarted = false,
    pid = null,
    processIdentity = null
  } = {}, options = {}) {
    let processStop = {
      processExitVerified: neverStarted === true,
      scopeEmpty: neverStarted === true,
      stopped: false
    };
    let processCleanupFailed = false;
    if (!neverStarted) {
      try {
        processStop = await stopOwnedCodexAppServerExecution({
          executionId: normalizeText(executionId),
          pid: Number(pid),
          processIdentity,
          processState: CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
          provider: CODEX_APP_SERVER_PROVIDER_ID,
          runtimeDir: normalizeText(runtimeDir),
          schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION
        }, options);
      } catch {
        processCleanupFailed = true;
      }
    }
    if (processCleanupFailed || processStop.processExitVerified !== true) {
      return {
        ...processStop,
        cleanupFailed: true
      };
    }
    const helperRemovals = helper
      ? [
          rm(codexAppServerHelperHomeDir(runtimeDir), { force: true, recursive: true }),
          rm(codexAppServerHelperWorkspaceDir(runtimeDir), { force: true, recursive: true }),
          rm(codexAppServerLogPath(runtimeDir), { force: true })
        ]
      : [];
    const removals = await Promise.allSettled([
      ...helperRemovals,
      rm(codexAppServerSocketPath(runtimeDir), { force: true }),
      rm(codexAppServerMetadataPath(runtimeDir), { force: true }),
      removeCodexAppServerMetadataTemps(runtimeDir)
    ]);
    return {
      ...processStop,
      cleanupFailed: removals.some(({ status }) => status === "rejected")
    };
  }

  async function stopCodexAppServerRuntime(options = {}) {
    const runtimeDir = normalizeText(options.runtimeDir);
    const preserveProcessExitProof = options.preserveProcessExitProof === true;
    if (!runtimeDir || !codexAppServerRuntimeDirIsManaged(runtimeDir)) {
      return {
        processExitVerified: false,
        runtimeDirPreserved: false,
        runtimeDirRemoved: false,
        stopped: false
      };
    }
    let releaseLock;
    try {
      releaseLock = await acquireRuntimeLock(runtimeDir, options);
    } catch (error) {
      if (!codexAppServerRuntimeCleanupCanSkip(error)) {
        throw error;
      }
      return {
        processExitVerified: false,
        runtimeDirCleanupError: String(error?.message || error || ""),
        runtimeDirCleanupSkipped: String(error?.code || "") !== "ENOENT",
        runtimeDirPreserved: false,
        runtimeDirRemoved: false,
        stopped: false
      };
    }
    let runtimeDirRemoved = false;
    let runtimeDirCleanupSkipped = false;
    let runtimeDirCleanupError = "";
    let runtimeDirPreserved = false;
    let processStop = {
      processExitVerified: false,
      stopped: false
    };
    try {
      const existing = await readCodexAppServerMetadata(runtimeDir);
      const expectedAccount = normalizeText(options.expectedAccountIdentitySignature);
      const ownedRuntime = options.ownedRuntime;
      if (
        ownedRuntime &&
        codexAppServerProcessMetadataIsIdentifiable(ownedRuntime, runtimeDir) &&
        (!expectedAccount || ownedRuntime.accountIdentitySignature === expectedAccount) &&
        (!existing || codexAppServerRuntimeIdentity(existing) !== codexAppServerRuntimeIdentity(ownedRuntime))
      ) {
        // Another owner may already have removed or replaced the shared runtime.
        // Prove this provider's exact execution stopped without touching its successor.
        return {
          ...await stopOwnedCodexAppServerExecution(ownedRuntime, options),
          runtimeDirPreserved: Boolean(existing),
          runtimeDirRemoved: false
        };
      }
      if (!existing) {
        // Changeover after a server restart may have no runtime.json left. The
        // managed execution owner can still drain and prove its exact scope empty.
        // A missing file alone is never process-exit proof, and account-specific
        // cleanup must keep using its retained execution identity above.
        const owned = options.verifyOwnerScope === true && !expectedAccount
          ? await execution.stopOwned({
            kind: "assistant",
            operationId: "codex-app-server",
            ownerId: normalizeText(options.ownerId) || stableHash(runtimeDir)
          }, { reason: "codex-app-server-changeover" })
          : null;
        const ownerExitVerified = owned?.supported === true && owned?.ok === true && owned?.scopeEmpty === true;
        return {
          processExitVerified: ownerExitVerified,
          runtimeDirPreserved: false,
          runtimeDirRemoved: false,
          stopped: ownerExitVerified && Number(owned?.closed) > 0
        };
      }
      if (expectedAccount) {
        // A replacement runtime is installed only after the previous process has
        // drained under this same lock. Never stop that replacement for stale
        // ephemeral-thread cleanup.
        if (!codexAppServerProcessMetadataIsIdentifiable(existing, runtimeDir) ||
            !/^sha256:[a-f0-9]{64}$/u.test(existing.accountIdentitySignature)) {
          return { processExitVerified: false, runtimeDirRemoved: false, stopped: false };
        }
        if (existing.accountIdentitySignature !== expectedAccount) {
          return { ownershipSuperseded: true, processExitVerified: false, runtimeDirRemoved: false, stopped: false };
        }
      }
      processStop = await stopCodexAppServerProcess(runtimeDir, options);
      if (processStop.processExitVerified === true && preserveProcessExitProof) {
        const metadata = await readCodexAppServerMetadata(runtimeDir);
        if (!codexAppServerProcessMetadataIsIdentifiable(metadata, runtimeDir)) {
          return {
            ...processStop,
            processExitVerified: false,
            runtimeDirPreserved: false,
            runtimeDirRemoved: false
          };
        }
        await writeCodexAppServerMetadata(runtimeDir, {
          ...metadata,
          processExitVerifiedAt: metadata.processExitVerifiedAt || new Date().toISOString(),
          processState: CODEX_APP_SERVER_PROCESS_STATE.STOPPED
        });
        runtimeDirPreserved = true;
      } else if (processStop.processExitVerified === true) {
        try {
          runtimeDirRemoved = await removeCodexAppServerRuntimeDir(runtimeDir);
        } catch (error) {
          if (!codexAppServerRuntimeCleanupCanSkip(error)) {
            throw error;
          }
          runtimeDirCleanupSkipped = true;
          runtimeDirCleanupError = String(error?.message || error || "");
        }
      }
    } finally {
      await releaseLock();
    }
    return {
      ...processStop,
      runtimeDirCleanupError,
      runtimeDirCleanupSkipped,
      runtimeDirPreserved,
      runtimeDirRemoved
    };
  }

  function codexAppServerMetadataIsWellFormed(metadata = {}, options = {}) {
    const expectedAttachmentHostRoot = options.compatibility.attachmentHostRoot;
    const expectedAccountIdentitySignature = normalizeText(options.accountIdentitySignature);
    const expectedExecutionMode = codexAppServerExecutionMode(options);
    const expectedToolHomeSource = codexAppServerIsHelper(options) ? "" : normalizeText(options.toolHomeSource);
    const expectedTerminalEnvHash = codexAppServerTerminalEnvHash(codexAppServerIsHelper(options) ? {} : options.terminalEnv);
    const expectedRuntimesHash = options.compatibility.runtimesHash;
    const expectedExecutionContextHash = options.compatibility.executionContextHash;
    const expectedHelperProcessCwd = expectedExecutionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
      ? codexAppServerHelperWorkspaceDir(metadata.runtimeDir)
      : "";
    return Boolean(
      metadata.schemaVersion === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
      metadata.accountIdentitySignature === expectedAccountIdentitySignature &&
      metadata.attachmentHostRoot === expectedAttachmentHostRoot &&
      metadata.authStateSignature &&
      metadata.executionId &&
      metadata.executionContextHash === expectedExecutionContextHash &&
      metadata.executionMode === expectedExecutionMode &&
      metadata.processCwd &&
      codexAppServerProcessMetadataIsIdentifiable(metadata) &&
      metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.RUNNING &&
      (expectedExecutionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER ||
        codexHistoryAdapterUrlIsValid(metadata.historyAdapterBaseUrl, metadata.processIdentity.runtimeToken)) &&
      (!expectedHelperProcessCwd || metadata.processCwd === expectedHelperProcessCwd) &&
      metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
      metadata.runtimesHash === expectedRuntimesHash &&
      metadata.terminalEnvHash === expectedTerminalEnvHash &&
      metadata.toolHomeSource === expectedToolHomeSource &&
      metadata.transport === CODEX_APP_SERVER_TRANSPORT.UNIX &&
      metadata.endpoint &&
      metadata.socketPath
    );
  }

  async function codexAppServerEndpointStatus(endpoint = "", {
    timeoutMs = CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
    WebSocketImpl = WebSocket
  } = {}) {
    const normalizedEndpoint = normalizeText(endpoint);
    const socketPath = socketPathFromCodexAppServerEndpoint(normalizedEndpoint);
    if (!socketPath || !await fileExists(socketPath)) {
      return {
        status: CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING
      };
    }
    const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS);
    const client = new CodexAppServerJsonRpcClient({
      endpoint: normalizedEndpoint,
      requestTimeoutMs: normalizedTimeoutMs,
      WebSocketImpl
    });
    let timeout = null;
    const probe = (async () => {
      await client.connect();
      await client.initialize({ clientInfo: clientInfo });
      return CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE;
    })();
    probe.catch(() => null);
    try {
      const status = await Promise.race([
        probe,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT), normalizedTimeoutMs);
          timeout.unref?.();
        })
      ]);
      return {
        status
      };
    } catch {
      return {
        status: CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE
      };
    } finally {
      clearTimeout(timeout);
      client.close();
    }
  }

  async function codexAppServerMetadataIsLive(metadata = {}, options = {}) {
    return (await codexAppServerRuntimeStatus(metadata, options)).status === CODEX_APP_SERVER_RUNTIME_STATUS.LIVE;
  }

  async function codexAppServerRuntimeStatus(metadata = {}, options = {}) {
    const normalized = normalizeCodexAppServerMetadata(metadata);
    if (
      codexAppServerProcessMetadataIsIdentifiable(normalized) &&
      normalized.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED &&
      normalized.processExitVerifiedAt
    ) {
      return {
        metadata: normalized,
        replace: true,
        reusable: false,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.EXITED
      };
    }
    if (!codexAppServerMetadataIsWellFormed(normalized, options)) {
      return {
        metadata: normalized,
        replace: true,
        reusable: false,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.INCOMPATIBLE
      };
    }
    const authStateSignature = await currentCodexAuthStateSignature(options);
    if (normalized.authStateSignature !== authStateSignature) {
      return {
        metadata: normalized,
        replace: true,
        reusable: false,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.INCOMPATIBLE
      };
    }
    let processIdentity = null;
    if (typeof options.processGroupIsAlive === "function") {
      const alive = options.processGroupIsAlive(normalized.pid);
      processIdentity = {
        processGroupIds: alive ? [normalized.pid] : [],
        status: alive
          ? CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT
          : CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT
      };
    } else {
      processIdentity = await inspectCodexAppServerProcessIdentity(normalized, options);
    }
    if (
      processIdentity.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.ABSENT ||
      processIdentity.status === CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.MISMATCH
    ) {
      return {
        metadata: normalized,
        replace: true,
        reusable: false,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.EXITED
      };
    }
    if (processIdentity.status !== CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.EXACT) {
      return {
        metadata: normalized,
        replace: false,
        reusable: true,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.SUSPECT
      };
    }
    const endpoint = await codexAppServerEndpointStatus(normalized.endpoint, {
      timeoutMs: codexAppServerLivenessTimeoutMs(options),
      WebSocketImpl: options.WebSocketImpl
    });
    if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE) {
      return {
        metadata: normalized,
        replace: false,
        reusable: true,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.LIVE
      };
    }
    if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING) {
      return {
        metadata: normalized,
        replace: true,
        reusable: false,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.MISSING
      };
    }
    if (endpoint.status === CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT) {
      return {
        metadata: normalized,
        replace: false,
        reusable: true,
        status: CODEX_APP_SERVER_RUNTIME_STATUS.SUSPECT
      };
    }
    return {
      metadata: normalized,
      replace: true,
      reusable: false,
      status: CODEX_APP_SERVER_RUNTIME_STATUS.MISSING
    };
  }

  async function waitForCodexAppServer(endpoint = "", {
    timeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
    WebSocketImpl = WebSocket
  } = {}) {
    const socketPath = socketPathFromCodexAppServerEndpoint(endpoint);
    if (!socketPath) {
      return false;
    }
    const startedAt = Date.now();
    while (!await fileExists(socketPath) && Date.now() - startedAt <= timeoutMs) {
      await delay(100);
    }
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    if (!await fileExists(socketPath) || remainingMs <= 0) {
      return false;
    }
    const client = new CodexAppServerJsonRpcClient({
      endpoint,
      requestTimeoutMs: remainingMs,
      WebSocketImpl
    });
    let timeout = null;
    const handshake = (async () => {
      await client.connect();
      await client.initialize({ clientInfo: clientInfo });
      return true;
    })();
    handshake.catch(() => null);
    try {
      return await Promise.race([
        handshake,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), remainingMs);
          timeout.unref?.();
        })
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      client.close();
    }
  }

  async function startCodexAppServerProcess({
    providerHome = false,
    accountIdentitySignature = "",
    authStateSignature = "",
    codexCommand = "codex",
    env = process.env,
    executionRoot = "",
    executionMode = CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
    killTimeoutMs = 0,
    processIdentityInspector = null,
    readyTimeoutMs = CODEX_APP_SERVER_READY_TIMEOUT_MS,
    signalProcessGroup: signalProcessGroupOverride = null,
    stopExecution = null,
    terminalEnv = {},
    termTimeoutMs = 0,
    toolHomeSource = "",
    WebSocketImpl = WebSocket,
    workdir = "",
    socketOwnerDrained = false,
    runtimeDir,
    ownerId = "",
    compatibility
  } = {}) {
    const processLifecycleOptions = {
      killTimeoutMs,
      processIdentityInspector,
      signalProcessGroup: signalProcessGroupOverride,
      stopExecution,
      termTimeoutMs
    };
    await ensureWritablePrivateDirectory(runtimeDir);
    const helper = codexAppServerExecutionMode({ executionMode }) ===
      CODEX_APP_SERVER_EXECUTION_MODES.HELPER;
    const normalizedToolHomeSource = normalizeText(toolHomeSource);
    if (normalizedToolHomeSource) {
      await assertExistingDirectory(normalizedToolHomeSource, "Codex credential home");
    }
    const resolvedAuthStateSignature = await currentCodexAuthStateSignature({ authStateSignature });
    await assertCodexAuthGenerationCurrent(resolvedAuthStateSignature);
    const socketPath = codexAppServerSocketPath(runtimeDir);
    assertCodexAppServerSocketPathSupported(socketPath);
    const endpoint = codexAppServerUnixEndpoint(socketPath);
    const logPath = codexAppServerLogPath(runtimeDir);
    const helperHome = helper ? codexAppServerHelperHomeDir(runtimeDir) : "";
    const helperWorkspace = helper ? codexAppServerHelperWorkspaceDir(runtimeDir) : "";
    if (helper) {
      await Promise.all([
        rm(helperHome, { force: true, recursive: true }),
        rm(helperWorkspace, { force: true, recursive: true })
      ]);
      await Promise.all([
        ensureWritablePrivateDirectory(helperHome),
        ensureWritablePrivateDirectory(helperWorkspace)
      ]);
      if (providerHome) {
        // The canonical home contains only our curated provider projection. Copy
        // it into the existing isolated helper home; never load OpenAI auth here.
        const sourceHome = path.join(normalizedToolHomeSource, ".codex");
        const catalogPath = path.join(helperHome, "models.json");
        const config = await readFile(path.join(sourceHome, "config.toml"), "utf8");
        await writeFile(catalogPath, await readFile(path.join(sourceHome, "models.json")), { mode: 0o600 });
        await writeFile(path.join(helperHome, "config.toml"), config.replace(
          JSON.stringify(path.join(sourceHome, "models.json")), JSON.stringify(catalogPath)
        ), { mode: 0o600 });
      }
    }
    const processCwd = helper
      ? helperWorkspace
      : codexAppServerProcessCwd({
          executionRoot,
          runtimeDir,
          workdir
        });
    const projectTrustOverride = helper ? "" : codexAppServerProjectTrustOverride(workdir);
    const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(helper ? {} : terminalEnv);
    const commandBaseEnv = helper
      ? codexAppServerHelperCommandBaseEnv(env, helperHome)
      : codexAppServerCommandBaseEnv({
          env,
          terminalEnv: normalizedTerminalEnv
        });
    if (await fileExists(socketPath) && !socketOwnerDrained) {
      const endpointStatus = await codexAppServerEndpointStatus(endpoint, {
        timeoutMs: CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
        WebSocketImpl
      });
      if (![CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING, CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE]
        .includes(endpointStatus.status)) {
        const error = new Error("The existing Codex app-server socket still has an unretired owner.");
        error.code = `${errorPrefix}codex_app_server_socket_owner_unverified`;
        error.retryable = false;
        throw error;
      }
    }
    await rm(socketPath, {
      force: true
    });
    const codexArgs = [
      // Keep every override after app-server: a trailing -c (including the model
      // catalogue) otherwise drops the earlier ones. See openai/codex#39012.
      "app-server",
      "--listen",
      endpoint,
      // App-server uses config overrides, not the top-level sandbox bypass flag.
      ...(helper ? [] : [
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="danger-full-access"',
        "-c",
        `features.hooks=${Boolean(commandHookCommand)}`,
        ...(commandHookCommand ? ["-c", codexAppServerSessionCommandHookConfig()] : [])
      ]),
      "-c",
      "check_for_update_on_startup=false",
      ...(projectTrustOverride
        ? [
            "-c",
            projectTrustOverride
          ]
        : [])
    ];
    const runtimeToken = randomUUID();
    const commandHash = codexAppServerProcessCommandHash({
      codexArgs,
      codexCommand,
      executionMode,
      processCwd,
      runtimeDir
    });
    const baseEnv = {
      ...commandBaseEnv,
      // A curated provider home contains a provider-only static catalogue. Use
      // the binary's native definitions as the base for its shared runtime.
      [modelCatalogEnvironmentName]: providerHome ? "bundled" : "native",
      [CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV]: commandHash,
      [CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV]: runtimeToken
    };
    const profileBinary = path.isAbsolute(codexCommand) ? await stat(codexCommand).catch(() => null) : null;
    const startResult = await execution.run({
      args: [
        "-c",
        helper ? CODEX_APP_SERVER_HELPER_STARTUP_SCRIPT : CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT,
        processLabel,
        ...(helper ? [] : [process.execPath, CODEX_APP_SERVER_PROCESS_PATH, runtimeDir]),
        codexCommand,
        ...codexArgs
      ],
      baseEnv,
      command: CODEX_APP_SERVER_MANAGED_SHELL,
      credentialHome: codexAppServerCredentialHome(
        helper ? helperHome : normalizedToolHomeSource,
        baseEnv
      ),
      cwd: processCwd || process.cwd(),
      execution: {
        kind: "assistant",
        label: "Codex assistant",
        lifecycle: "service",
        operationId: "codex-app-server",
        ownerId: normalizeText(ownerId) || stableHash(runtimeDir)
      },
      processProfile: profileBinary?.isFile() ? {
        command: codexCommand, helper, executionMode,
        binary: [profileBinary.dev, profileBinary.ino, profileBinary.size, profileBinary.mtimeMs, profileBinary.ctimeMs],
        platform: process.platform, architecture: process.arch,
        startup: helper ? CODEX_APP_SERVER_HELPER_STARTUP_SCRIPT : CODEX_APP_SERVER_MANAGED_STARTUP_SCRIPT,
        historyAdapter: !helper
      } : null,
      logPath,
      inheritProcessEnv: false,
      mode: "detached",
      timeout: readyTimeoutMs
    });
    if (!startResult.ok) {
      const failedProcessIdentity = await captureCodexAppServerProcessIdentity({
        commandHash,
        pid: startResult.pid,
        reportedIdentity: startResult.processIdentity,
        runtimeToken
      }).catch(() => null);
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        neverStarted: !Number.isSafeInteger(Number(startResult.pid)),
        pid: startResult.pid,
        processIdentity: failedProcessIdentity
      }, processLifecycleOptions);
      const error = new Error(
        startResult.output || startResult.error ||
        (helper ? "Codex isolated helper runtime failed to start." : "Codex app-server failed to start.")
      );
      error.code = cleanup.cleanupFailed
        ? (helper
            ? `${errorPrefix}codex_helper_runtime_cleanup_required`
            : `${errorPrefix}codex_app_server_cleanup_required`)
        : (startResult.code || (helper
            ? `${errorPrefix}codex_helper_runtime_start_failed`
            : `${errorPrefix}codex_app_server_start_failed`));
      error.cleanupRequired = cleanup.cleanupFailed;
      error.execution = startResult.execution;
      error.retryable = cleanup.cleanupFailed ? false : startResult.retryable === true;
      throw error;
    }

    let processIdentity;
    try {
      processIdentity = await captureCodexAppServerProcessIdentity({
        commandHash,
        pid: startResult.pid,
        reportedIdentity: startResult.processIdentity,
        runtimeToken
      });
    } catch (cause) {
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        pid: startResult.pid,
        processIdentity: startResult.processIdentity
      }, processLifecycleOptions);
      const error = new Error("Codex app-server process ownership could not be recorded.", {
        cause
      });
      error.code = cleanup.cleanupFailed
        ? `${errorPrefix}codex_app_server_cleanup_required`
        : `${errorPrefix}codex_app_server_process_identity_unavailable`;
      error.cleanupRequired = cleanup.cleanupFailed;
      throw error;
    }

    const ready = await waitForCodexAppServer(endpoint, {
      timeoutMs: readyTimeoutMs,
      WebSocketImpl
    });
    if (!ready) {
      const logTail = await tailTextFile(logPath);
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        pid: startResult.pid,
        processIdentity
      }, processLifecycleOptions);
      if (!cleanup.cleanupFailed && !helper) {
        await credentials.observeFailure(logTail);
      }
      const error = new Error([
        helper
          ? "Codex isolated helper runtime did not become ready."
          : `Codex app-server did not become ready at ${endpoint}.`,
        logTail ? `Recent log output:\n${logTail}` : ""
      ].filter(Boolean).join("\n"));
      error.code = cleanup.cleanupFailed
        ? (helper
            ? `${errorPrefix}codex_helper_runtime_cleanup_required`
            : `${errorPrefix}codex_app_server_cleanup_required`)
        : (helper
            ? `${errorPrefix}codex_helper_runtime_start_failed`
            : `${errorPrefix}codex_app_server_ready_timeout`);
      error.cleanupRequired = cleanup.cleanupFailed;
      error.retryable = false;
      throw error;
    }

    let historyAdapterBaseUrl = "";
    try {
      if (!helper) {
        const descriptor = JSON.parse(await readFile(path.join(runtimeDir, "history-adapter.json"), "utf8"));
        if (descriptor.runtimeToken !== runtimeToken || !codexHistoryAdapterUrlIsValid(descriptor.baseUrl, runtimeToken)) {
          throw new Error("Codex history adapter did not confirm the current runtime.");
        }
        historyAdapterBaseUrl = descriptor.baseUrl;
      }
      await assertCodexAuthGenerationCurrent(resolvedAuthStateSignature);
    } catch (cause) {
      const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
        helper,
        executionId: startResult.execution?.id,
        pid: startResult.pid,
        processIdentity
      }, processLifecycleOptions);
      if (cleanup.cleanupFailed) {
        const error = new Error("Codex app-server authentication changed and its execution could not be drained.", {
          cause
        });
        error.code = `${errorPrefix}codex_app_server_cleanup_required`;
        error.cleanupRequired = true;
        error.retryable = false;
        throw error;
      }
      throw cause;
    }

    return {
      accountIdentitySignature: normalizeText(accountIdentitySignature),
      attachmentHostRoot: compatibility.attachmentHostRoot,
      authStateSignature: resolvedAuthStateSignature,
      endpoint,
      executionId: normalizeText(startResult.execution?.id),
      executionMode: helper
        ? CODEX_APP_SERVER_EXECUTION_MODES.HELPER
        : CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
      executionContextHash: compatibility.executionContextHash,
      healthz: "",
      historyAdapterBaseUrl,
      logPath,
      pid: Number.isSafeInteger(Number(startResult.pid)) ? Number(startResult.pid) : null,
      processCwd,
      processIdentity,
      processState: CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
      provider: CODEX_APP_SERVER_PROVIDER_ID,
      readyz: "",
      runtimeDir,
      runtimesHash: compatibility.runtimesHash,
      schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
      socketPath,
      startedAt: new Date().toISOString(),
      terminalEnvHash: codexAppServerTerminalEnvHash(normalizedTerminalEnv),
      toolHomeSource: helper ? "" : normalizedToolHomeSource,
      transport: CODEX_APP_SERVER_TRANSPORT.UNIX
    };
  }

  async function ensureCodexAppServerRuntime(options = {}) {
    const runtimeDir = path.resolve(options.runtimeDir);
    while (codexAppServerRuntimePreparations.has(runtimeDir)) {
      await codexAppServerRuntimePreparations.get(runtimeDir);
    }
    // Each waiter rechecks its own auth and runtime configuration after startup.
    const operation = prepareCodexAppServerRuntime({ ...options, runtimeDir });
    codexAppServerRuntimePreparations.set(runtimeDir, operation);
    try {
      return await operation;
    } finally {
      codexAppServerRuntimePreparations.delete(runtimeDir);
    }
  }

  async function prepareCodexAppServerRuntime(options) {
    const { runtimeDir } = options;
    const [accountIdentitySignature, authStateSignature] = await Promise.all([
      currentCodexAccountIdentitySignature(options),
      currentCodexAuthStateSignature(options)
    ]);
    const runtimeOptions = {
      ...options,
      accountIdentitySignature,
      authStateSignature
    };
    const runtimeMetadataWriter = typeof options.runtimeMetadataWriter === "function"
      ? options.runtimeMetadataWriter
      : writeCodexAppServerMetadata;
    await ensureWritablePrivateDirectory(runtimeDir);

    const existing = await readCodexAppServerMetadata(runtimeDir);
    const existingStatus = existing ? await codexAppServerRuntimeStatus(existing, runtimeOptions) : null;
    if (existingStatus?.reusable) {
      return {
        ...existingStatus.metadata,
        reused: true,
        runtimeStatus: existingStatus.status
      };
    }

    const releaseLock = await acquireRuntimeLock(runtimeDir, runtimeOptions);
    try {
      let socketOwnerDrained = false;
      const afterLock = await readCodexAppServerMetadata(runtimeDir);
      const afterLockStatus = afterLock ? await codexAppServerRuntimeStatus(afterLock, runtimeOptions) : null;
      if (afterLockStatus?.reusable) {
        return {
          ...afterLockStatus.metadata,
          reused: true,
          runtimeStatus: afterLockStatus.status
        };
      }

      if (afterLock && (!afterLockStatus || afterLockStatus.replace !== false)) {
        const stopped = await stopCodexAppServerProcess(runtimeDir, runtimeOptions);
        if (stopped.processExitVerified !== true) {
          const error = new Error(
            `${clientInfo.title} found an earlier Codex app-server but could not prove that its owned execution was stopped. It refused to start a replacement because two assistant processes could damage the session or worsen resource pressure.`
          );
          error.code = `${errorPrefix}codex_app_server_process_identity_unverified`;
          error.cleanupRequired = true;
          error.retryable = false;
          throw error;
        }
        socketOwnerDrained = true;
      }

      const started = await startCodexAppServerProcess({
        ...runtimeOptions,
        runtimeDir,
        socketOwnerDrained
      });
      try {
        await assertCodexAuthGenerationCurrent(started.authStateSignature, runtimeOptions);
        await runtimeMetadataWriter(runtimeDir, started);
        await assertCodexAuthGenerationCurrent(started.authStateSignature, runtimeOptions);
      } catch (error) {
        const helper = codexAppServerIsHelper(runtimeOptions);
        const cleanup = await cleanupFailedCodexAppServerStart(runtimeDir, {
          helper,
          executionId: started.executionId,
          pid: started.pid,
          processIdentity: started.processIdentity
        }, runtimeOptions);
        const failure = new Error(
          helper
            ? "Codex isolated helper runtime metadata could not be recorded."
            : "Codex app-server runtime could not be published safely.",
          { cause: error }
        );
        failure.code = cleanup.cleanupFailed
          ? (helper
              ? `${errorPrefix}codex_helper_runtime_cleanup_required`
              : `${errorPrefix}codex_app_server_cleanup_required`)
          : (error?.code || (helper
              ? `${errorPrefix}codex_helper_runtime_metadata_failed`
              : `${errorPrefix}codex_app_server_metadata_failed`));
        failure.cleanupRequired = cleanup.cleanupFailed;
        failure.retryable = false;
        throw failure;
      }
      return {
        ...started,
        reused: false
      };
    } finally {
      await releaseLock();
    }
  }

  return {
    ensure: ensureCodexAppServerRuntime,
    start: startCodexAppServerProcess,
    stop: stopCodexAppServerRuntime,
    isLive: codexAppServerMetadataIsLive,
    cleanupFailedStart: cleanupFailedCodexAppServerStart
  };
}

