import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createConversationProcessIdentity } from "./localExecution.js";
import { isRecord, normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import { prepareCodexModelCatalog } from "./codexConfiguration.js";
import { startCodexHistoryAdapter } from "./codexHistoryAdapter.js";

const CODEX_APP_SERVER_METADATA_FILE = "runtime.json";
const CODEX_APP_SERVER_LOCK_DIR = "runtime.lock";
const CODEX_APP_SERVER_LOCK_TIMEOUT_MS = 10000;
const CODEX_APP_SERVER_LOCK_STALE_MS = 120000;
export const CODEX_APP_SERVER_EXECUTION_MODES = Object.freeze({ HELPER: "helper", INTERACTIVE: "interactive" });
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
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const catalogPath = await prepareCodexModelCatalog({
    command,
    runtimeDir,
    bundled,
    additionalModels,
    codexHome,
    signal: startup.signal
  });
  const adapter = await startCodexHistoryAdapter({ token, codexHome });
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
  const normalized = isRecord(metadata) ? metadata : {};
  const endpoint = normalizeNullableText(normalized.endpoint);
  return {
    accountIdentitySignature: normalizeNullableText(normalized.accountIdentitySignature),
    attachmentHostRoot: normalizeNullableText(normalized.attachmentHostRoot),
    authStateSignature: normalizeNullableText(normalized.authStateSignature),
    endpoint,
    executionId: normalizeNullableText(normalized.executionId),
    executionMode: normalizeNullableText(normalized.executionMode) || CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
    executionContextHash: normalizeNullableText(normalized.executionContextHash),
    healthz: normalizeNullableText(normalized.healthz),
    historyAdapterBaseUrl: normalizeNullableText(normalized.historyAdapterBaseUrl),
    logPath: normalizeNullableText(normalized.logPath),
    pid: Number.isSafeInteger(Number(normalized.pid)) ? Number(normalized.pid) : null,
    processCwd: normalizeNullableText(normalized.processCwd),
    processExitVerifiedAt: normalizeNullableText(normalized.processExitVerifiedAt),
    processIdentity: runtimeProcessIdentity.normalize(normalized.processIdentity),
    processState: normalizeNullableText(normalized.processState),
    provider: normalizeNullableText(normalized.provider),
    readyz: normalizeNullableText(normalized.readyz),
    runtimeDir: normalizeNullableText(normalized.runtimeDir),
    runtimesHash: normalizeNullableText(normalized.runtimesHash),
    schemaVersion: Number(normalized.schemaVersion || 0),
    socketPath: normalizeNullableText(normalized.socketPath),
    startedAt: normalizeNullableText(normalized.startedAt),
    terminalEnvHash: normalizeNullableText(normalized.terminalEnvHash),
    toolHomeSource: normalizeNullableText(normalized.toolHomeSource),
    transport: normalizeNullableText(normalized.transport)
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

export const CODEX_APP_SERVER_PROVIDER_ID = "codex_app_server";

export const CODEX_APP_SERVER_TRANSPORT = Object.freeze({
  UNIX: "unix"
});

export const CODEX_APP_SERVER_RUNTIME_DIR_NAME = "codex-app-server";

const CODEX_APP_SERVER_LOG_FILE = "app-server.log";

const CODEX_APP_SERVER_SOCKET_FILE = "app-server.sock";

export const CODEX_APP_SERVER_READY_TIMEOUT_MS = 60000;

export const CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS = 2000;

export const CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "DBUS_STARTER_ADDRESS",
  "DBUS_STARTER_BUS_TYPE"
]);

const CODEX_APP_SERVER_HELPER_HOME_DIR = "codex-home";

const CODEX_APP_SERVER_HELPER_WORKSPACE_DIR = "workspace";

export const CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES = process.platform === "linux" ? 107 : 103;

export const CODEX_APP_SERVER_ENDPOINT_STATUS = Object.freeze({
  MISSING: "missing",
  RESPONSIVE: "responsive",
  TIMEOUT: "timeout",
  UNREACHABLE: "unreachable"
});

export const CODEX_APP_SERVER_RUNTIME_STATUS = Object.freeze({
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

export const CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS = Object.freeze({
  ABSENT: "absent",
  AMBIGUOUS: "ambiguous",
  EXACT: "exact",
  INVALID: "invalid",
  MISMATCH: "mismatch"
});

export function stableHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

export function codexAppServerExecutionMode(options = {}) {
  return normalizeNullableText(options.executionMode) === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
    ? CODEX_APP_SERVER_EXECUTION_MODES.HELPER
    : CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE;
}

export function codexAppServerIsHelper(options = {}) {
  return codexAppServerExecutionMode(options) === CODEX_APP_SERVER_EXECUTION_MODES.HELPER;
}

export async function assertExistingDirectory(dirPath = "", label = "directory") {
  const normalizedPath = normalizeNullableText(dirPath);
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

export function codexAppServerHelperCommandBaseEnv(env, codexHome = "") {
  const source = isRecord(env) ? env : {};
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

export function codexAppServerLogPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_LOG_FILE);
}

export function codexAppServerSocketPath(runtimeDir = "") {
  return path.join(runtimeDir, CODEX_APP_SERVER_SOCKET_FILE);
}

export function codexAppServerSocketPathBytes(socketPath = "") {
  return Buffer.byteLength(String(socketPath || ""), "utf8");
}

export function codexAppServerSocketPathTooLong(socketPath = "") {
  return codexAppServerSocketPathBytes(socketPath) > CODEX_APP_SERVER_UNIX_SOCKET_PATH_MAX_BYTES;
}

export function codexAppServerUnixEndpoint(socketPath = "") {
  return `unix://${socketPath}`;
}

export function codexAppServerProjectTrustOverride(workdir = "") {
  const normalizedWorkdir = normalizeNullableText(workdir);
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
  const normalizedWorkdir = normalizeNullableText(workdir) ? path.resolve(workdir) : "";
  if (normalizedWorkdir) {
    return normalizedWorkdir;
  }
  const normalizedExecutionRoot = normalizeNullableText(executionRoot) ? path.resolve(executionRoot) : "";
  if (normalizedExecutionRoot) {
    return normalizedExecutionRoot;
  }
  return normalizeNullableText(runtimeDir) ? path.resolve(runtimeDir) : "";
}

export function codexAppServerRuntimeDirIsManaged(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeNullableText(runtimeDir);
  if (!normalizedRuntimeDir) {
    return false;
  }
  const basename = path.basename(path.resolve(normalizedRuntimeDir));
  return basename === CODEX_APP_SERVER_RUNTIME_DIR_NAME ||
    basename.startsWith(`${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-`);
}

export async function removeCodexAppServerRuntimeDir(runtimeDir = "") {
  const normalizedRuntimeDir = normalizeNullableText(runtimeDir);
  if (!codexAppServerRuntimeDirIsManaged(normalizedRuntimeDir)) {
    return false;
  }
  await rm(normalizedRuntimeDir, {
    force: true,
    recursive: true
  });
  return true;
}

export async function removeCodexAppServerMetadataTemps(runtimeDir = "") {
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

export function codexAppServerRuntimeCleanupCanSkip(error) {
  return ["EACCES", "EPERM", "ENOENT"].includes(String(error?.code || ""));
}

export function codexAppServerRuntimeIdentity(runtime = {}) {
  return [
    normalizeNullableText(runtime.accountIdentitySignature),
    normalizeNullableText(runtime.authStateSignature),
    normalizeNullableText(runtime.endpoint),
    normalizeNullableText(runtime.executionId),
    normalizeNullableText(runtime.executionMode),
    normalizeNullableText(runtime.runtimesHash),
    normalizeNullableText(runtime.terminalEnvHash),
    normalizeNullableText(runtime.socketPath),
    normalizeNullableText(runtime.startedAt),
    normalizeNullableText(runtime.pid)
  ].join("\0");
}

export function normalizeCodexAppServerTerminalEnv(terminalEnv = {}) {
  if (!isRecord(terminalEnv)) {
    return {};
  }
  return Object.fromEntries(Object.entries(terminalEnv)
    .map(([name, value]) => [
      normalizeNullableText(name),
      String(value ?? "")
    ])
    .filter(([name, value]) => (
      name &&
      String(value || "") &&
      !CODEX_APP_SERVER_DESKTOP_BUS_ENV_NAMES.has(name)
    )));
}

export function codexAppServerCommandBaseEnv({
  env,
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
  const home = normalizeNullableText(toolHomeSource);
  if (!home) {
    return {};
  }
  return {
    home,
    username: normalizeNullableText(baseEnv.USER || baseEnv.LOGNAME)
  };
}

export function codexAppServerTerminalEnvHash(terminalEnv = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeCodexAppServerTerminalEnv(terminalEnv))
    .sort(([left], [right]) => left.localeCompare(right))));
}

export function codexHistoryAdapterUrlIsValid(baseUrl, token) {
  // Only this adapter URL shape serves thread-bound compaction recovery. Any
  // other shape keeps its process identity readable but is retired through
  // normal owned cleanup.
  const match = typeof baseUrl === "string" && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/[0-9a-f-]{36}\/v2$/iu.exec(baseUrl);
  return Boolean(match && Number(match[1]) <= 65535 && baseUrl.endsWith(`/${token}/v2`));
}

export function codexAppServerLivenessTimeoutMs(options = {}) {
  return normalizePositiveInteger(
    options.livenessTimeoutMs,
    { fallback: normalizePositiveInteger(options.timeoutMs, { fallback: CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS }) }
  );
}

export function codexAppServerProcessCommandHash({
  codexArgs = [],
  codexCommand = "",
  executionMode = "",
  processCwd = "",
  runtimeDir = ""
} = {}) {
  return stableHash(JSON.stringify({
    codexArgs,
    codexCommand: normalizeNullableText(codexCommand),
    executionMode: codexAppServerExecutionMode({ executionMode }),
    processCwd: normalizeNullableText(processCwd),
    runtimeDir: normalizeNullableText(runtimeDir)
  }));
}

/** Default environment names the runtime and its process leader share. */
export const CODEX_APP_SERVER_DEFAULT_ENVIRONMENT = Object.freeze({
  runtimeToken: "JSKIT_EXECUTION_RUNTIME_TOKEN",
  modelCatalogSource: "JSKIT_CODEX_MODEL_CATALOG_SOURCE",
  commandHash: "JSKIT_EXECUTION_COMMAND_HASH"
});

/** The PreToolUse hook that routes native Bash commands through the host's wrapper. */
export function codexCommandHookDefinition(command) {
  return [{ matcher: "^Bash$", hooks: [{ type: "command", command, timeout: 30 }] }];
}

