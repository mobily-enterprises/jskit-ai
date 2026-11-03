import {
  codexAppServerOwnedRuntimeKey,
  codexAppServerRuntimeStopWasVerified,
  directoryExists,
  withRuntimeLifecycle
} from "./codexRuntimeInventory.js";
import { normalizeCodexRunText as normalizeText } from "./codexTurnState.js";

/**
 * Stops cached providers and releases what sessions and projects leave behind.
 * @param {object} dependencies
 * @param {Map<string, object>} dependencies.records
 * @param {import("./codexProviderOwner.js").CodexAppServerProviderOwner["providers"]} dependencies.providers
 * @param {import("./codexProviderOwner.js").CodexAppServerProviderOwner["providerOwners"]} dependencies.providerOwners
 * @param {import("./codexProviderOwner.js").CodexAppServerProviderOwner["ownedRuntimes"]} dependencies.ownedRuntimes
 * @param {<T>(operation: () => T, providerKey?: string, providerOptions?: object | null) => Promise<Awaited<T>>} dependencies.withLifecycle
 * @param {(providerKey: string, providerOptions: object) => boolean} dependencies.runtimeIsShared
 * @param {(provider: object) => void} dependencies.forgetOwnedRuntime
 * @param {(providerKey: string, options?: object) => void} dependencies.closeProvider
 * @param {string} dependencies.requiredStopCode
 * @param {string} dependencies.exitUnverifiedCode
 * @param {string} dependencies.runtimeCloseError
 * @param {(event: string, details: object) => void} dependencies.debugLog
 * @param {(error: unknown) => unknown} dependencies.debugError
 */
export function createCodexProviderRelease({
  records,
  providers,
  providerOwners,
  ownedRuntimes,
  withLifecycle,
  runtimeIsShared,
  forgetOwnedRuntime,
  closeProvider,
  requiredStopCode,
  exitUnverifiedCode,
  runtimeCloseError,
  debugLog,
  debugError
}) {
  async function stopCachedProviderUnlocked(providerKey = "", {
    preserveProcessExitProof = false,
    requireStopped = false
  } = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = providers.get(normalizedProviderKey);
    if (!provider) {
      closeProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        stopped: false
      };
    }
    // readable-check: allow optional-call - optional operation: a driver's resources have no retire step, and a borrowed provider has no resources
    await records.get(normalizedProviderKey)?.resources?.retire?.(provider);
    const sharedProcessRetained = runtimeIsShared(
      normalizedProviderKey, providerOwners.get(normalizedProviderKey)?.providerOptions
    );
    if (sharedProcessRetained) {
      closeProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        sessionDetached: true,
        sharedProcessRetained: true,
        stopped: false
      };
    }
    // readable-check: allow method-probe - safety invariant: a provider that cannot stop would leave its process running unverified
    if (typeof provider.stopRuntime !== "function") {
      closeProvider(normalizedProviderKey);
      throw new Error("Codex app-server provider must implement stopRuntime().");
    }
    let providerStoppedRuntime = false;
    try {
      const stoppedRuntime = await provider.stopRuntime({
        preserveProcessExitProof: preserveProcessExitProof || requireStopped
      });
      providerStoppedRuntime = codexAppServerRuntimeStopWasVerified(stoppedRuntime);
      if (requireStopped && !providerStoppedRuntime) {
        const error = new Error("Codex app-server process exit could not be verified.");
        error.code = requiredStopCode;
        error.retryable = true;
        throw error;
      }
      if (providerStoppedRuntime) {
        forgetOwnedRuntime(provider);
      }
      return {
        ...(stoppedRuntime && typeof stoppedRuntime === "object" ? stoppedRuntime : {}),
        providerKey: normalizedProviderKey,
        stopped: providerStoppedRuntime
      };
    } finally {
      closeProvider(normalizedProviderKey, {
        closeProvider: !providerStoppedRuntime
      });
    }
  }

  function stopCachedProvider(providerKey = "", options = {}) {
    return withLifecycle(
      () => stopCachedProviderUnlocked(providerKey, options),
      normalizeText(providerKey)
    );
  }

  function runtimeExitUnverifiedError(providerKey = "") {
    const error = new Error("Codex app-server process exit could not be verified.");
    error.code = exitUnverifiedCode;
    error.providerKey = normalizeText(providerKey);
    error.retryable = true;
    return error;
  }

  async function stopPreparedRuntime(context) {
    const { runtime, parameters } = context.runtimeHost;
    return runtime.stop(parameters);
  }

  async function stopProvider(providerKey, providerOptions, context = {}) {
    const { preserveProcessExitProof = false, requireStopped = false } = context;
    const provider = providers.get(providerKey);
    if (!provider) {
      if (runtimeIsShared(providerKey, providerOptions)) {
        return {
          providerKey,
          sessionDetached: true,
          sharedProcessRetained: true,
          stopped: false
        };
      }
      const stoppedRuntime = await stopPreparedRuntime(context);
      const stopped = codexAppServerRuntimeStopWasVerified(stoppedRuntime);
      if (requireStopped && !stopped) {
        throw runtimeExitUnverifiedError(providerKey);
      }
      return {
        ...(Boolean(stoppedRuntime && typeof stoppedRuntime === "object" && !Array.isArray(stoppedRuntime)) ? stoppedRuntime : {}),
        providerKey,
        stopped
      };
    }
    return stopCachedProvider(providerKey, {
      preserveProcessExitProof,
      requireStopped
    });
  }

  async function stopThreadBeforeRelease(providerKey, provider, threadId) {
    try {
      await provider.stopThreadForObservationLoss(threadId, "");
    } catch (error) {
      // If other sessions retain the shared process, closing this
      // socket alone is not proof that its native goal/work stopped.
      const shared = runtimeIsShared(
        providerKey, providerOwners.get(providerKey)?.providerOptions
      );
      if (shared) throw error;
      // The caller's existing shutdown must instead prove process exit.
    }
  }

  async function stopProvidersForProject({
    preserveProcessExitProof = false,
    projectContextRoot = "",
    reason = "",
  } = {}, { managed, keyFields, helperThreads, sessionKeyPrefix = "" }) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    if (!normalizedProjectContextRoot) {
      return {
        failed: [],
        ok: true,
        projectContextRoot: normalizedProjectContextRoot,
        providerCount: 0,
        reason: normalizeText(reason),
        results: [],
        stopped: 0
      };
    }
    const helperProviders = new Set(
      helperThreads.records({
        projectContextRoot: normalizedProjectContextRoot
      }).map((record) => record.provider)
    );
    // Main threads name their project; every other provider of the project's
    // sessions (Temporary chats, reads) is found by its session key.
    const providerKeys = [...providers.keys()]
      .filter((providerKey) => {
        const current = managed.get(providerKey);
        return normalizeText(current?.projectContext?.targetRoot) === normalizedProjectContextRoot ||
          helperProviders.has(providers.get(providerKey)) ||
          Boolean(sessionKeyPrefix && normalizeText(providerOwners.get(providerKey)?.sessionKey).startsWith(sessionKeyPrefix));
      });
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        const fields = keyFields(providerKey);
        results.push(await stopCachedProvider(providerKey, {
          preserveProcessExitProof: Boolean(
            preserveProcessExitProof &&
            fields.sessionId &&
            fields.executionMode !== "helper"
          )
        }));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: normalizeText(error?.error || error?.message || error) || runtimeCloseError,
          providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    debugLog("appServerRuntime.closeProject.done", {
      failedCount: failed.length,
      providerCount: providerKeys.length,
      projectContextRoot: normalizedProjectContextRoot,
      reason: normalizeText(reason),
      stopped
    });
    return {
      failed,
      ok: failed.length === 0,
      projectContextRoot: normalizedProjectContextRoot,
      providerCount: providerKeys.length,
      reason: normalizeText(reason),
      results,
      stopped
    };
  }

  async function stopCachedProvidersForSession(sessionKey = "", options = {}) {
    if (!sessionKey) {
      return {
        failed: [],
        ok: true,
        providerCount: 0,
        results: [],
        stopped: 0
      };
    }
    const providerKeys = [...providers.keys()]
      .filter((providerKey) => (
        providerOwners.get(providerKey)?.sessionKey === sessionKey
      ));
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        results.push(await stopCachedProvider(providerKey, options));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: normalizeText(error?.error || error?.message || error) || runtimeCloseError,
          providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      providerCount: providerKeys.length,
      results,
      stopped: results.filter((result) => result.stopped).length
    };
  }

  function drainThreadEnvironmentTasks(sessionKey) {
    return Promise.all([...providers.entries()]
      .filter(([key]) => providerOwners.get(key)?.sessionKey === sessionKey)
      .flatMap(([, provider]) => [...(provider.threadEnvironmentTasks?.values() || [])])
      .map((task) => task.catch(() => null)));
  }

  async function stopPersistedRuntime({ runtime, parameters }, runtimeDir) {
    const result = await runtime.stop(parameters);

    return {
      ...result,
      runtimeDirExists: await directoryExists(runtimeDir),
      verifiedStopped: result?.stopped === true ||
        result?.processExitVerified === true ||
        result?.runtimeDirRemoved === true
    };
  }

  function sessionExitProof(sessionKey, context) {
    const { cachedProviders, persistedRuntime } = context;
    const noRuntimeAcquired = cachedProviders.providerCount === 0 &&
      !context.hasRuntime &&
      !context.threadId &&
      ![...ownedRuntimes.values()].some((record) => record.sessionKey === sessionKey);
    const cachedRuntimeExitVerified = cachedProviders.providerCount > 0 &&
      cachedProviders.results.length === cachedProviders.providerCount &&
      cachedProviders.results.every((result) => (
        result?.stopped === true ||
        (result?.sessionDetached === true && result?.sharedProcessRetained === true)
      ));
    const persistedRuntimeExitVerified = persistedRuntime?.verifiedStopped === true ||
      (
        persistedRuntime?.sessionDetached === true &&
        persistedRuntime?.sharedProcessRetained === true
      );
    return { noRuntimeAcquired, cachedRuntimeExitVerified, persistedRuntimeExitVerified };
  }

  async function unsubscribeSessionThread(sessionKey, sessionId, session) {
    if (!sessionId) {
      return { ok: true, sessionId, status: "notSubscribed" };
    }
    const { providerOptions, workdir, threadId } = session.unsubscribeParameters;
    if (!threadId) {
      return { ok: true, providerOptions, sessionId, status: "notSubscribed" };
    }
    // The existing record carries the workdir captured in its provider key.
    // Never prepare new controls while releasing a retained connection.
    const provider = [...records.values()].find(record =>
      record.owner.sessionKey === sessionKey && record.owner.workdir === normalizeText(workdir))?.provider;
    if (!provider) {
      return { ok: true, providerOptions, sessionId, status: "notSubscribed" };
    }
    const result = await provider.unsubscribeThread(threadId);
    debugLog("appServerThread.unsubscribe.done", {
      sessionId,
      status: normalizeText(result?.status),
      threadId
    });
    return {
      ok: true,
      providerOptions,
      result,
      sessionId,
      status: normalizeText(result?.status) || "unsubscribed",
      threadId
    };
  }

  async function stopPersistedSessionRuntime(session) {
    const host = session.persistedRuntimeHost;
    if (!host) return { stopped: false };
    return stopPersistedRuntime(host, host.runtimeDir);
  }

  async function releasePersistedRuntimeProof(runtimeOptions, session) {
    // Session closure already detached this participant. Its archived runtime
    // path may now belong to the successor or another live conversation.
    // Releasing the old proof must not stop or delete that shared process.
    if (runtimeIsShared("", runtimeOptions)) {
      return { sharedProcessRetained: true };
    }
    const existed = await directoryExists(runtimeOptions.runtimeDir);
    if (!existed) return { existed };
    const result = await stopPersistedSessionRuntime(session);
    return { existed, result };
  }

  function releasePreparedRuntimeProof(preparation) {
    return withLifecycle(async () => {
      const prepared = preparation.read();
      if (Object.hasOwn(prepared, "value")) return prepared.value;
      return withRuntimeLifecycle(codexAppServerOwnedRuntimeKey("", prepared.runtimeOptions), async () => {
        const evidence = await releasePersistedRuntimeProof(prepared.runtimeOptions, prepared);
        return prepared.complete(evidence);
      });
    });
  }

  async function releaseSession(sessionKey, context) {
    const { sessionId, runOwner, session } = context;
    if (context.changeover) {
      const threadId = session.threadId;
      for (const [key, provider] of providers) {
        if (!threadId || providerOwners.get(key)?.sessionKey !== sessionKey) continue;
        await stopThreadBeforeRelease(key, provider, threadId);
      }
    }
    let exitFailure = null;
    try {
      const unsubscribeResult = await unsubscribeSessionThread(sessionKey, sessionId, session);
      session.providerOptions = unsubscribeResult?.providerOptions || session.providerOptions;
    } catch (error) {
      debugLog("appServerThread.unsubscribe.error", {
        error: debugError(error),
        sessionId
      });
    } finally {
      await runOwner.notificationQueue.drain(sessionId);
      const cachedProviders = await stopCachedProvidersForSession(sessionId ? sessionKey : "", {
        preserveProcessExitProof: context.preserveProcessExitProof,
        requireStopped: context.requireStopped
      });
      if (cachedProviders.ok === false) {
        debugLog("appServerRuntime.closeSession.cached.error", {
          failed: cachedProviders.failed,
          sessionId
        });
      }
      let persistedRuntime = null;
      if (session.exists) {
        persistedRuntime = cachedProviders.stopped > 0
          ? {
              stopped: true,
              verifiedStopped: true
            }
          : runtimeIsShared("", session.providerOptions || {})
          ? {
              sessionDetached: true,
              sharedProcessRetained: true,
              stopped: false,
              verifiedStopped: false
            }
          : session.hasRuntime
            ? await stopPersistedSessionRuntime(session)
            : {
                stopped: false,
                verifiedStopped: false
              };
        debugLog("appServerRuntime.closeSession.persisted.done", {
          removed: persistedRuntime?.removed === true,
          runtimeDirRemoved: persistedRuntime?.runtimeDirRemoved === true,
          sessionId,
          stopped: persistedRuntime?.removed === true || persistedRuntime?.runtimeDirRemoved === true
        });
      }
      if (session.requiresExitProof) {
        // A fresh session with no acquired native owner needs no process proof.
        // Losing a cache or recorded runtime does not make it a fresh session.
        const { noRuntimeAcquired, cachedRuntimeExitVerified, persistedRuntimeExitVerified } =
          sessionExitProof(sessionKey, {
            cachedProviders,
            persistedRuntime,
            get hasRuntime() { return session.hasRuntime; },
            get threadId() { return session.threadId; }
          });
        if (cachedProviders.failed.length > 0 ||
            (!noRuntimeAcquired && !cachedRuntimeExitVerified && !persistedRuntimeExitVerified)) {
          exitFailure = {
            cachedFailures: cachedProviders.failed,
            cachedRuntimeExitVerified,
            persistedRuntime: persistedRuntime || null
          };
        }
      }
    }
    return { exitFailure };
  }

  return Object.freeze({
    stopCachedProvider,
    stopProvider,
    stopThreadBeforeRelease,
    stopProvidersForProject,
    stopCachedProvidersForSession,
    drainThreadEnvironmentTasks,
    stopPersistedRuntime,
    sessionExitProof,
    unsubscribeSessionThread,
    releasePersistedRuntimeProof,
    releasePreparedRuntimeProof,
    releaseSession
  });
}
