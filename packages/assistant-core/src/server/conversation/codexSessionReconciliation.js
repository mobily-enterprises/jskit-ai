import { normalizeCodexRunText as normalizeText, codexAppServerErrorMessage as errorMessage } from "./codexTurnState.js";
import { isPlainObject as isRecord } from "./normalize.js";

// Original batch restoration, prune and startup unsubscribe. The run owner's
// existing lifecycle and per-thread readiness retain all state and coordination.
export function createCodexSessionReconciliation({
  runOwner, providerSessions, helperLifecycle, lifecycle, createRuntime,
  namespace, turnState, sessionIdRequiredError, debugLog, debugError
}) {
  async function pruneCodexAppServerManagedSessions({
    keepProviderKeys = new Set(),
    projectContextRoot = ""
  } = {}) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    if (!normalizedProjectContextRoot) {
      return;
    }
    for (const [providerKey, managed] of [...providerSessions.managed.entries()]) {
      if (keepProviderKeys.has(providerKey)) {
        continue;
      }
      if (providerSessions.owner.providers.get(providerKey)?.observationFailure) continue;
      if (normalizeText(managed.projectContext?.targetRoot) === normalizedProjectContextRoot) {
        await lifecycle.retireProvider(providerKey);
      }
    }
  }

  async function retireAndCloseCodexAppServerProviderForSession(sessionId = "", options = null) {
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !normalizedSessionId ||
      !options ||
      typeof options !== "object" ||
      Array.isArray(options)
    ) {
      return;
    }
    await lifecycle.retireProvider(
      providerSessions.context(normalizedSessionId, options).providerKey
    );
  }

  function codexAppServerReconcileSessionId(value = {}) {
    if (typeof value === "string") {
      return normalizeText(value);
    }
    return normalizeText(value?.sessionId || value?.id);
  }

  async function unsubscribeCodexAppServerThreadForSession(sessionId = "", options, preparation) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return { ok: true, sessionId: normalizedSessionId, status: "notSubscribed" };
    }
    const unsubscribeParameters = await preparation.session(normalizedSessionId, options);
    if (!unsubscribeParameters.threadId) {
      return {
        ok: true,
        providerOptions: unsubscribeParameters.providerOptions,
        sessionId: normalizedSessionId,
        status: "notSubscribed"
      };
    }
    return providerSessions.owner.unsubscribeSessionThread(
      namespace(normalizedSessionId), normalizedSessionId, { unsubscribeParameters }
    );
  }

  async function unsubscribeCodexAppServerThreadsForSessions(sessions = [], preparation) {
    const results = [];
    const failed = [];
    const seenSessionIds = new Set();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const sessionId = normalizeText(session?.sessionId || session?.id || session);
      if (!sessionId || seenSessionIds.has(sessionId)) {
        continue;
      }
      seenSessionIds.add(sessionId);
      let providerOptions = null;
      try {
        const result = await unsubscribeCodexAppServerThreadForSession(sessionId, {
          session: isRecord(session) ? session : null
        }, preparation);
        providerOptions = result?.providerOptions || null;
        results.push(result);
      } catch (error) {
        failed.push({
          error: errorMessage(error, preparation.failureMessage),
          sessionId
        });
        debugLog("appServerThread.unsubscribeKnown.error", {
          error: debugError(error),
          sessionId
        });
      } finally {
        if (providerOptions) {
          try {
            await retireAndCloseCodexAppServerProviderForSession(
              sessionId,
              providerOptions
            );
          } catch (error) {
            failed.push({
              code: normalizeText(error?.code),
              error: errorMessage(error, preparation.cleanupFailureMessage),
              retryable: error?.retryable === true,
              sessionId
            });
          }
        }
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      results,
      sessionCount: seenSessionIds.size
    };
  }

  async function reconcileCodexAppServerThreadForSession(sessionId = "", {
    agentSettings = {}
  } = {}, preparation) {
    providerSessions.assertOpen();
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return { ok: false, error: sessionIdRequiredError };
    }
    const prepared = await preparation.session(normalizedSessionId, { agentSettings });
    if (prepared.result) return prepared.result;
    const { context } = prepared;
    if (turnState(context.session).status === "observation_lost") {
      const recovered = await prepared.recover(runOwner.recoverSessionObservationLoss);
      const turn = turnState(recovered);
      return prepared.stopped({
        ok: !turn.active,
        sessionId: normalizedSessionId,
        status: turn.active ? "stopUnverified" : "stopped",
        threadId: turn.threadId
      }, recovered);
    }
    return runOwner.reconcileThread(normalizedSessionId, context, prepared.thread);
  }

  async function reconcileCodexAppServerThreads(sessions = [], {
    agentSettings = {}
  } = {}, preparation) {
    providerSessions.assertOpen();
    const runtime = await createRuntime();
    providerSessions.assertOpen();
    const projectContextRoot = normalizeText(runtime.projectContextRoot);
    const helpers = await preparation.helperRestoration(runtime);
    const helperRestore = await helperLifecycle.restoreThreads(helpers.projectRuntimeRoot, helpers.context);
    const reconcileGeneration = lifecycle.nextReconcileGeneration();
    const sessionIds = [...new Set((Array.isArray(sessions) ? sessions : [])
      .map((session) => codexAppServerReconcileSessionId(session))
      .filter(Boolean))];
    const results = await Promise.all(sessionIds.map(async (sessionId) => {
      try {
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        let helperFailure = null;
        let helperInventory = null;
        if (helperRestore.ok !== false) {
          try {
            helperInventory = await helperLifecycle.withProjectOperation(runtime?.stateRoot, () => (
              helperLifecycle.reconcileRuntimeUnlocked(preparation.helperInventory({ runtime, session }))
            ));
          } catch (error) {
            helperFailure = helperLifecycle.failure({
              projectRuntimeRoot: runtime.stateRoot,
              sessionId
            }, error);
            debugLog("appServerHelper.reconcile.error", {
              error: debugError(error),
              sessionId
            });
          }
        }
        const result = await reconcileCodexAppServerThreadForSession(sessionId, {
          agentSettings
        }, preparation);
        return {
          ...result,
          helperFailure,
          helperInventory
        };
      } catch (error) {
        debugLog("appServerThread.reconcile.error", {
          error: debugError(error),
          sessionId
        });
        const failure = {
          ok: false,
          error: errorMessage(error, preparation.failureMessage),
          sessionId
        };
        if (error?.code === preparation.runtimeBusyCode) {
          failure.code = error.code;
          failure.retryable = true;
          failure.status = "reconnecting";
        }
        return failure;
      }
    }));
    const failed = [
      ...helperRestore.failed,
      ...results.flatMap((result) => [
        result?.ok === false ? result : null,
        result?.helperFailure || null
      ].filter(Boolean))
    ];
    const keepProviderKeys = new Set();
    const reconnectingSessionIds = new Set();
    for (const result of results) {
      const providerKey = normalizeText(result?.providerKey);
      if (providerKey) {
        keepProviderKeys.add(providerKey);
      }
      if (result.code === preparation.runtimeBusyCode) {
        reconnectingSessionIds.add(result.sessionId);
      }
    }
    for (const [providerKey, managed] of providerSessions.managed) {
      if (reconnectingSessionIds.has(managed.sessionId)) {
        keepProviderKeys.add(providerKey);
      }
    }
    if (reconcileGeneration === lifecycle.reconcileGeneration) {
      await runOwner.waitForThreadReconciliations({
        keepProviderKeys,
        projectContextRoot
      });
    }
    if (reconcileGeneration === lifecycle.reconcileGeneration) {
      await pruneCodexAppServerManagedSessions({
        keepProviderKeys,
        projectContextRoot
      });
    } else {
      debugLog("appServerThread.reconcile.pruneSkipped", {
        reason: "stale_reconcile",
        sessionCount: sessionIds.length,
        projectContextRoot
      });
    }
    debugLog("appServerThread.reconcile.done", {
      failedCount: failed.length,
      sessionCount: sessionIds.length
    });
    return {
      helperRestore,
      failed,
      ok: failed.length === 0,
      results,
      sessionCount: sessionIds.length
    };
  }

  async function reconcileSessions(sessions = [], options = {}, preparation) {
    if (!preparation.enabled) return preparation.disabledResult;
    providerSessions.assertOpen();
    const reconciliation = Promise.resolve().then(() => (
      reconcileCodexAppServerThreads(sessions, options, preparation)
    ));
    lifecycle.reconcileTasks.add(reconciliation);
    try {
      return await reconciliation;
    } finally {
      lifecycle.reconcileTasks.delete(reconciliation);
    }
  }

  async function unsubscribeSessions(sessions = [], preparation) {
    if (!preparation.enabled) return preparation.disabledResult;
    return unsubscribeCodexAppServerThreadsForSessions(sessions, preparation);
  }

  return {
    reconcileSessions,
    unsubscribeSessions,
    retireProviderForSession: retireAndCloseCodexAppServerProviderForSession
  };
}
