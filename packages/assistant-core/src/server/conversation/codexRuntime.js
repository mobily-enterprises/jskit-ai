import { fileURLToPath } from "node:url";
import path from "node:path";
import { createConversationProcessIdentity } from "./localExecution.js";
import {
  CODEX_APP_SERVER_DEFAULT_ENVIRONMENT, codexAppServerIsHelper, ensureWritablePrivateDirectory,
  readCodexAppServerMetadata, writeCodexAppServerMetadata
} from "./codexProcess.js";
import { createCodexAppServerRuntimeStop } from "./codexRuntimeStop.js";
import { createCodexAppServerRuntimeStatus } from "./codexRuntimeStatus.js";
import { createCodexAppServerProcessStart } from "./codexRuntimeStart.js";

/**
 * The host's process facility. Managed hosts add prepare, stopOwned and authoritative to the local one.
 * @typedef {object} CodexRuntimeExecution
 * @property {(request: object) => Promise<object>} run
 * @property {(executionId: string, options: object) => Promise<object>} stop
 * @property {(owner: object, options: object) => Promise<object>} [stopOwned]
 * @property {() => Promise<void>} [prepare]
 * @property {boolean} [authoritative]
 */

/** @typedef {ReturnType<typeof createConversationProcessIdentity>} CodexProcessIdentity */

/**
 * The host's account facility for one native runtime.
 * @typedef {object} CodexRuntimeCredentials
 * @property {(options: object) => Promise<string>} identity
 * @property {(options: object) => Promise<string>} generation
 * @property {(captured: string) => Promise<void>} assertCurrent
 * @property {(output: string) => void} observeFailure
 */

/**
 * What the process start reads from the runtime configuration.
 * @typedef {object} CodexRuntimeSettings
 * @property {string | undefined} commandHookCommand
 * @property {string} errorPrefix
 * @property {string} modelCatalogEnvironmentName
 * @property {string} processLabel
 * @property {string} processPath
 * @property {string} runtimeTokenEnvironmentName
 * @property {string} commandHashEnvironmentName
 * @property {string} socketPathHelp
 * @property {string | null} umask
 */

// One preparation at a time per runtime directory, across every runtime in this
// process: a second start would race the first for the same socket and lock.
const codexAppServerRuntimePreparations = new Map();

/**
 * The production shared runtime: one process owner per stable runtime directory.
 * Execution and credential facilities retain host policy; threads do not own this process.
 * @param {object} dependencies
 * @param {CodexRuntimeExecution} dependencies.execution
 * @param {CodexRuntimeCredentials} dependencies.credentials
 * @param {object} [dependencies.configuration]
 */
export function createCodexAppServerRuntime({ execution, credentials, configuration = {} }) {
  const {
    clientInfo = { name: "jskit", title: "JSKIT", version: "0.1.0" },
    commandHookCommand,
    errorPrefix = "",
    modelCatalogEnvironmentName = CODEX_APP_SERVER_DEFAULT_ENVIRONMENT.modelCatalogSource,
    processLabel = "jskit-codex-app-server",
    processPath = fileURLToPath(new URL("./codexProcessLeader.js", import.meta.url)),
    runtimeTokenEnvironmentName = CODEX_APP_SERVER_DEFAULT_ENVIRONMENT.runtimeToken,
    commandHashEnvironmentName = CODEX_APP_SERVER_DEFAULT_ENVIRONMENT.commandHash,
    socketPathHelp = "Configure a shorter host runtime directory.",
    umask = "0007"
  } = configuration;
  const codexProcessIdentity = createConversationProcessIdentity({
    runtimeTokenEnvironmentName, commandHashEnvironmentName,
    label: "Codex app-server",
    unavailableCode: `${errorPrefix}codex_app_server_process_identity_unavailable`
  });
  const currentCodexAccountIdentitySignature = credentials.identity;
  const currentCodexAuthStateSignature = credentials.generation;
  const assertCodexAuthGenerationCurrent = credentials.assertCurrent;
  const runtimeStop = createCodexAppServerRuntimeStop({ execution, processIdentity: codexProcessIdentity, errorPrefix });
  const runtimeStatus = createCodexAppServerRuntimeStatus({ clientInfo, credentials, stop: runtimeStop });
  const processStart = createCodexAppServerProcessStart({
    execution,
    credentials,
    processIdentity: codexProcessIdentity,
    stop: runtimeStop,
    status: runtimeStatus,
    settings: {
      commandHookCommand,
      errorPrefix,
      modelCatalogEnvironmentName,
      processLabel,
      processPath,
      runtimeTokenEnvironmentName,
      commandHashEnvironmentName,
      socketPathHelp,
      umask
    }
  });
  const acquireRuntimeLock = runtimeStop.acquireRuntimeLock;
  const stopCodexAppServerProcess = runtimeStop.stopProcess;
  const cleanupFailedCodexAppServerStart = runtimeStop.cleanupFailedStart;
  const stopCodexAppServerRuntime = runtimeStop.stopRuntime;
  const codexAppServerRuntimeStatus = runtimeStatus.runtimeStatus;
  const codexAppServerMetadataIsLive = runtimeStatus.metadataIsLive;
  const startCodexAppServerProcess = processStart.start;

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
    // readable-check: allow method-probe - optional operation: a runtime caller may supply its own metadata writer
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

  return Object.freeze({
    ensure: ensureCodexAppServerRuntime,
    start: startCodexAppServerProcess,
    stop: stopCodexAppServerRuntime,
    isLive: codexAppServerMetadataIsLive,
    cleanupFailedStart: cleanupFailedCodexAppServerStart
  });
}
