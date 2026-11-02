import WebSocket from "ws";
import { setTimeout as delay } from "node:timers/promises";
import { normalizePositiveInteger } from "@jskit-ai/kernel/shared/support/normalize";
import { CodexAppServerJsonRpcClient, socketPathFromCodexAppServerEndpoint } from "./codexClient.js";
import { normalizeNullableText } from "./normalize.js";
import {
  CODEX_APP_SERVER_ENDPOINT_STATUS, CODEX_APP_SERVER_EXECUTION_MODES, CODEX_APP_SERVER_LIVENESS_TIMEOUT_MS,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION, CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS, CODEX_APP_SERVER_PROCESS_STATE,
  CODEX_APP_SERVER_PROVIDER_ID, CODEX_APP_SERVER_READY_TIMEOUT_MS, CODEX_APP_SERVER_RUNTIME_STATUS, CODEX_APP_SERVER_TRANSPORT,
  codexAppServerExecutionMode, codexAppServerHelperWorkspaceDir, codexAppServerIsHelper, codexAppServerLivenessTimeoutMs,
  codexAppServerTerminalEnvHash, codexHistoryAdapterUrlIsValid, fileExists, normalizeCodexAppServerMetadata
} from "./codexProcess.js";

/**
 * Reads whether a recorded native runtime is still the one this host would start, and whether it answers.
 * @param {object} dependencies
 * @param {{ name: string, title: string, version: string }} dependencies.clientInfo
 * @param {import("./codexRuntime.js").CodexRuntimeCredentials} dependencies.credentials
 * @param {import("./codexRuntimeStop.js").CodexRuntimeStop} dependencies.stop
 */
export function createCodexAppServerRuntimeStatus({ clientInfo, credentials, stop }) {
  const currentCodexAuthStateSignature = credentials.generation;
  const codexAppServerProcessMetadataIsIdentifiable = stop.processMetadataIsIdentifiable;
  const inspectCodexAppServerProcessIdentity = stop.inspectProcessIdentity;

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
          // readable-check: allow optional-call - platform object: a timer handle, which has unref only under Node
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

  return Object.freeze({
    endpointStatus: codexAppServerEndpointStatus,
    metadataIsLive: codexAppServerMetadataIsLive,
    runtimeStatus: codexAppServerRuntimeStatus,
    waitForServer: waitForCodexAppServer
  });
}
