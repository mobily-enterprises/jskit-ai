import { rm } from "node:fs/promises";
import { normalizeNullableText } from "./normalize.js";
import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION, CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS, CODEX_APP_SERVER_PROCESS_STATE,
  CODEX_APP_SERVER_PROVIDER_ID, acquireCodexRuntimeLock, codexAppServerHelperHomeDir, codexAppServerHelperWorkspaceDir,
  codexAppServerLogPath, codexAppServerMetadataPath, codexAppServerRuntimeCleanupCanSkip, codexAppServerRuntimeDirIsManaged,
  codexAppServerRuntimeIdentity, codexAppServerSocketPath, readCodexAppServerMetadata, removeCodexAppServerMetadataTemps,
  removeCodexAppServerRuntimeDir, stableHash, writeCodexAppServerMetadata
} from "./codexProcess.js";

/** @typedef {ReturnType<typeof createCodexAppServerRuntimeStop>} CodexRuntimeStop */

/**
 * Stops a native runtime's owned process and removes what it left behind.
 * @param {object} dependencies
 * @param {import("./codexRuntime.js").CodexRuntimeExecution} dependencies.execution
 * @param {import("./codexRuntime.js").CodexProcessIdentity} dependencies.codexProcessIdentity
 * @param {string} dependencies.errorPrefix
 */
export function createCodexAppServerRuntimeStop({ execution, codexProcessIdentity, errorPrefix }) {

  async function acquireRuntimeLock(runtimeDir = "", options = {}) {
    // readable-check: allow optional-call - optional operation: managed execution hosts add prepare; the local one has none
    await execution.prepare?.();
    return acquireCodexRuntimeLock(runtimeDir, { ...options, busyCode: `${errorPrefix}codex_app_server_runtime_busy` });
  }

  function codexAppServerProcessMetadataIsIdentifiable(metadata = {}, runtimeDir = "") {
    const normalizedRuntimeDir = normalizeNullableText(runtimeDir);
    return Boolean(
      Number(metadata.schemaVersion) === CODEX_APP_SERVER_METADATA_SCHEMA_VERSION &&
      metadata.provider === CODEX_APP_SERVER_PROVIDER_ID &&
      Number.isSafeInteger(Number(metadata.pid)) && Number(metadata.pid) > 0 &&
      (!normalizedRuntimeDir || metadata.runtimeDir === normalizedRuntimeDir) &&
      codexProcessIdentity.isValid(metadata.processIdentity) &&
      [
        CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
        CODEX_APP_SERVER_PROCESS_STATE.STOPPED
      ].includes(metadata.processState)
    );
  }

  async function inspectIdentifiableCodexAppServerProcess(metadata = {}) {
    if (!codexAppServerProcessMetadataIsIdentifiable(metadata)) {
      return { processGroupIds: [], status: CODEX_APP_SERVER_PROCESS_IDENTITY_STATUS.INVALID };
    }
    return codexProcessIdentity.inspect(metadata);
  }

  // A runtime caller may inspect the process identity its own way; every answer is normalized.
  async function inspectCodexAppServerProcessIdentity(metadata = {}, options = {}) {
    const { processIdentityInspector = inspectIdentifiableCodexAppServerProcess } = options;
    return codexProcessIdentity.normalizeInspection(await processIdentityInspector(metadata));
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

  async function stopOwnedCodexAppServerExecution(metadata = {}, options = {}) {
    if (
      metadata.processState === CODEX_APP_SERVER_PROCESS_STATE.STOPPED &&
      metadata.processExitVerifiedAt
    ) {
      return stopCodexAppServerProcessGroup(metadata, options);
    }
    const executionId = normalizeNullableText(metadata.executionId);
    if (executionId) {
      const { stopExecution = execution.stop } = options;
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
      // A runtime caller's own execution stop is authoritative for its scope, as an authoritative facility is.
      if (stopExecution !== execution.stop || execution.authoritative) {
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
    const normalizedRuntimeDir = normalizeNullableText(runtimeDir);
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
          executionId: normalizeNullableText(executionId),
          pid: Number(pid),
          processIdentity,
          processState: CODEX_APP_SERVER_PROCESS_STATE.RUNNING,
          provider: CODEX_APP_SERVER_PROVIDER_ID,
          runtimeDir: normalizeNullableText(runtimeDir),
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
    const runtimeDir = normalizeNullableText(options.runtimeDir);
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
      const expectedAccount = normalizeNullableText(options.expectedAccountIdentitySignature);
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
            ownerId: normalizeNullableText(options.ownerId) || stableHash(runtimeDir)
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

  return Object.freeze({
    acquireRuntimeLock,
    processMetadataIsIdentifiable: codexAppServerProcessMetadataIsIdentifiable,
    inspectProcessIdentity: inspectCodexAppServerProcessIdentity,
    stopProcess: stopCodexAppServerProcess,
    cleanupFailedStart: cleanupFailedCodexAppServerStart,
    stopRuntime: stopCodexAppServerRuntime
  });
}
