import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";
import { setTimeout as delay } from "node:timers/promises";
import { normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";
import { CodexAppServerJsonRpcClient, socketPathFromCodexAppServerEndpoint } from "./codexClient.js";
import { createConversationProcessIdentity } from "./localExecution.js";
import { normalizeNullableText } from "./normalize.js";
import {
  CODEX_APP_SERVER_DEFAULT_ENVIRONMENT, CODEX_APP_SERVER_ENDPOINT_STATUS, CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS, CODEX_APP_SERVER_METADATA_SCHEMA_VERSION, CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS,
  CODEX_APP_SERVER_PROCESS_STATE, CODEX_APP_SERVER_PROVIDER_ID, CODEX_APP_SERVER_READY_TIMEOUT_MS,
  CODEX_APP_SERVER_RUNTIME_STATUS, CODEX_APP_SERVER_TRANSPORT, codexAppServerExecutionMode,
  codexAppServerHelperWorkspaceDir, codexAppServerIsHelper, codexAppServerLivenessTimeoutMs,
  codexAppServerTerminalEnvHash, codexHistoryAdapterUrlIsValid, ensureWritablePrivateDirectory, fileExists,
  normalizeCodexAppServerMetadata, readCodexAppServerMetadata, writeCodexAppServerMetadata
} from "./codexProcess.js";
import { createCodexAppServerRuntimeStop } from "./codexRuntimeStop.js";
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
  const codexAppServerProcessMetadataIsIdentifiable = runtimeStop.processMetadataIsIdentifiable;
  const inspectCodexAppServerProcessIdentity = runtimeStop.inspectProcessIdentity;
  const processStart = createCodexAppServerProcessStart({
    execution,
    credentials,
    processIdentity: codexProcessIdentity,
    stop: runtimeStop,
    endpointStatus: codexAppServerEndpointStatus,
    waitForServer: waitForCodexAppServer,
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
  const startCodexAppServerProcess = processStart.start;

  function codexAppServerMetadataIsWellFormed(metadata = {}, options = {}) {
    const expectedAttachmentHostRoot = options.compatibility.attachmentHostRoot;
    const expectedAccountIdentitySignature = normalizeNullableText(options.accountIdentitySignature);
    const expectedExecutionMode = codexAppServerExecutionMode(options);
    const expectedToolHomeSource = codexAppServerIsHelper(options) ? "" : normalizeNullableText(options.toolHomeSource);
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
    const normalizedEndpoint = normalizeNullableText(endpoint);
    const socketPath = socketPathFromCodexAppServerEndpoint(normalizedEndpoint);
    if (!socketPath || !await fileExists(socketPath)) {
      return {
        status: CODEX_APP_SERVER_ENDPOINT_STATUS.MISSING
      };
    }
    const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs, { fallback: CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS });
    return {
      status: await probeCodexAppServer(normalizedEndpoint, normalizedTimeoutMs, WebSocketImpl)
    };
  }

  // One bounded connect-and-initialize handshake: responsive, timeout or unreachable.
  async function probeCodexAppServer(endpoint, timeoutMs, WebSocketImpl) {
    const client = new CodexAppServerJsonRpcClient({
      endpoint,
      requestTimeoutMs: timeoutMs,
      WebSocketImpl
    });
    let timeout = null;
    const probe = (async () => {
      await client.connect();
      await client.initialize({ clientInfo });
      return CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE;
    })();
    probe.catch(() => null);
    try {
      return await Promise.race([
        probe,
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.TIMEOUT), timeoutMs);
          // readable-check: allow optional-call - platform object: a timer handle has unref only under Node
          timeout.unref?.();
        })
      ]);
    } catch {
      return CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE;
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
    // readable-check: allow method-probe - optional operation: a runtime caller may supply its own process liveness check
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
    if (!await fileExists(socketPath)) {
      return false;
    }
    return await probeCodexAppServer(endpoint, remainingMs, WebSocketImpl) === CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE;
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
