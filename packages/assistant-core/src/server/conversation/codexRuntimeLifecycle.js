import { normalizeCodexRunText as normalizeText } from "./codexTurnState.js";

// Shutdown, wellbeing timers and managed-session records for shared Codex
// runtimes. It works on the run/provider owners' collections; it owns no servers.
// `pendingWork` names the run owner's in-flight task collections that shutdown
// drains; `observer` owns the event subscriptions a released provider ends.
export function createCodexRuntimeLifecycle({
  pendingWork,
  observer,
  checkManagedConnection,
  providerSessions,
  helperLifecycle,
  captureContext,
  runInContext,
  continueGoalAfterAccountChange = null,
  debugLog,
  debugError,
  closingError = null
}) {
  const codexAppServerSessionClosures = new Map();
  const codexAppServerWellbeingTimers = new Map();
  const codexAppServerReconcileTasks = new Set();
  const staleWatches = new Set();
  let codexAppServerThreadReconcileGeneration = 0;
  let codexAppServerServerClosing = false;
  let codexAppServerShutdownPromise = null;

  function assertOpen() {
    if (!closingError) return providerSessions.assertOpen();
    if (codexAppServerServerClosing) {
      const error = new Error(closingError.message);
      error.code = closingError.code;
      error.retryable = closingError.retryable;
      throw error;
    }
  }

  function closeCodexAppServerProvider(providerKey = "", options = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    if (!providerSessions.owner.providers.get(normalizedProviderKey)) {
      stopCodexAppServerWellbeing(normalizedProviderKey);
      providerSessions.managed.delete(normalizedProviderKey);
      return;
    }
    providerSessions.owner.closeProvider(normalizedProviderKey, options);
  }

  async function retireAndCloseCodexAppServerProviderUnlocked(providerKey = "", options = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    if (!providerSessions.owner.providers.get(normalizedProviderKey)) {
      closeCodexAppServerProvider(normalizedProviderKey, options);
      return;
    }
    return providerSessions.owner.retireAndCloseProvider(normalizedProviderKey, options);
  }

  function retireAndCloseCodexAppServerProvider(providerKey = "", options = {}) {
    return providerSessions.owner.withLifecycle(
      () => retireAndCloseCodexAppServerProviderUnlocked(providerKey, options),
      normalizeText(providerKey)
    );
  }

  function codexAppServerProviderResources(providerKey) {
    const normalizedProviderKey = normalizeText(providerKey);
    return {
      retire: helperLifecycle.retireProvider,
      reconcileRetirement: helperLifecycle.reconcileProviderRetirement,
      release(provider) {
        helperLifecycle.assertProviderReleased(provider);
        stopCodexAppServerWellbeing(normalizedProviderKey);
        providerSessions.managed.delete(normalizedProviderKey);
        const subscriptionPrefix = `${normalizedProviderKey}:`;
        for (const key of [...observer.eventSubscriptions.keys()]) {
          if (key.startsWith(subscriptionPrefix)) {
            observer.unsubscribeEventSubscription(key);
          }
        }
      }
    };
  }

  // A runtime the account change left running a turn stops after that turn
  // ends, once its output is recorded. A goal it paused then resumes, on the
  // session's runtime for the current account.
  function retireWhenIdle(stale) {
    if (staleWatches.has(stale.runtimeKey)) return;
    staleWatches.add(stale.runtimeKey);
    const goals = new Map();
    for (const providerKey of stale.providerKeys) {
      const managed = providerSessions.managed.get(providerKey);
      if (managed && stale.pausedGoals.includes(managed.threadId)) goals.set(managed.threadId, managed);
    }
    const unsubscribes = [];
    let done = false;
    const attempt = async () => {
      if (done || codexAppServerServerClosing) return;
      await Promise.allSettled([...pendingWork.notificationTasks.values(), ...pendingWork.resultFinalizations.values()]);
      const retired = await providerSessions.owner.retireStaleRuntime(stale.runtimeKey);
      if (retired?.busy || done) return;
      done = true;
      staleWatches.delete(stale.runtimeKey);
      for (const unsubscribe of unsubscribes) unsubscribe();
      debugLog("appServerRuntime.stale.retired", { runtimeKey: stale.runtimeKey, stopped: retired?.stopped === true });
      if (!continueGoalAfterAccountChange || codexAppServerServerClosing) return;
      for (const [threadId, managed] of goals) {
        try {
          await runInContext(managed.projectContext, () => continueGoalAfterAccountChange(managed.sessionId, { threadId }));
        } catch (error) {
          debugLog("appServerRuntime.stale.goalContinue.error", { error: debugError(error), sessionId: managed.sessionId, threadId });
        }
      }
    };
    const retire = () => attempt().catch(error => debugLog("appServerRuntime.stale.retire.error", {
      error: debugError(error), runtimeKey: stale.runtimeKey
    }));
    for (const providerKey of stale.providerKeys) {
      const provider = providerSessions.owner.providers.get(providerKey);
      if (!provider?.subscribe) continue;
      // Subscribed after the session observer, so its completion work for
      // this notification is already queued when the retirement drains it.
      unsubscribes.push(provider.subscribe(notification => {
        if (notification?.method === "turn/completed") void retire();
      }));
    }
    // The turn may have ended while the account change looked at it.
    void retire();
  }

  async function invalidateCodexAppServerRuntimes(input = {}) {
    const result = await providerSessions.owner.invalidateRuntimes(input);
    for (const stale of result.deferred || []) retireWhenIdle(stale);
    debugLog("appServerRuntime.invalidate.done", {
      deferredCount: (result.deferred || []).length,
      failedCount: result.failed.length,
      providerCount: result.providerCount,
      reason: normalizeText(input.reason),
      stopped: result.stopped,
      toolHomeSource: normalizeText(input.toolHomeSource)
    });
    return result;
  }

  function shutdownCodexAppServerRuntimes(input = {}) {
    beginCodexAppServerShutdown();
    if (!codexAppServerShutdownPromise) {
      codexAppServerShutdownPromise = (async () => {
        const invalidation = invalidateCodexAppServerRuntimes({
          ...input,
          includeOwned: true,
          reason: "server-shutdown",
          requireVerifiedExit: true,
          stopOwnedRuntimes: true
        });
        const drain = drainCodexAppServerControllerTasks();
        const [invalidated, drained] = await Promise.allSettled([
          invalidation,
          drain
        ]);
        if (drained.status === "rejected") {
          throw drained.reason;
        }
        const verified = await invalidateCodexAppServerRuntimes({
          ...input,
          includeOwned: true,
          reason: "server-shutdown",
          requireVerifiedExit: true,
          stopOwnedRuntimes: true
        });
        if (invalidated.status === "rejected") {
          throw invalidated.reason;
        }
        const initial = invalidated.value;
        const resultsByProvider = new Map([
          ...initial.results,
          ...verified.results
        ].map((result) => [normalizeText(result?.providerKey), result]));
        const results = [...resultsByProvider.values()];
        return {
          ...verified,
          providerCount: Math.max(initial.providerCount, verified.providerCount),
          results,
          stopped: results.filter((result) => result?.stopped === true).length
        };
      })();
    }
    return codexAppServerShutdownPromise;
  }

  function stopCodexAppServerWellbeing(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const timer = codexAppServerWellbeingTimers.get(normalizedProviderKey);
    if (timer) {
      clearTimeout(timer);
      codexAppServerWellbeingTimers.delete(normalizedProviderKey);
    }
  }

  function beginCodexAppServerShutdown() {
    if (codexAppServerServerClosing) {
      return;
    }
    codexAppServerServerClosing = true;
    providerSessions.owner.beginShutdown();
    codexAppServerThreadReconcileGeneration += 1;
    for (const providerKey of [...codexAppServerWellbeingTimers.keys()]) {
      stopCodexAppServerWellbeing(providerKey);
    }
  }

  async function drainCodexAppServerControllerTasks() {
    while (true) {
      const pending = new Set([
        ...pendingWork.conversationTurnStarts.values(),
        ...helperLifecycle.projectOperations.values(),
        ...helperLifecycle.cleanups.values(),
        ...helperLifecycle.mutations.values(),
        ...helperLifecycle.restores.values(),
        ...helperLifecycle.turnStarts.values(),
        ...pendingWork.messageDeliveries.values(),
        ...pendingWork.reasoningPersistQueues.values(),
        ...pendingWork.resultFinalizations.values(),
        ...providerSessions.owner.lifecycleTasks,
        ...providerSessions.owner.runtimeAcquisitions,
        ...codexAppServerReconcileTasks,
        ...codexAppServerSessionClosures.values(),
        ...pendingWork.threadReconciliations.values(),
        ...pendingWork.notificationTasks.values()
      ]);
      if (pending.size === 0) {
        return;
      }
      await Promise.allSettled([...pending]);
    }
  }

  function scheduleCodexAppServerWellbeing(providerKey = "") {
    const normalizedProviderKey = normalizeText(providerKey);
    const managed = providerSessions.managed.get(normalizedProviderKey);
    if (!managed || codexAppServerServerClosing) {
      stopCodexAppServerWellbeing(normalizedProviderKey);
      return;
    }
    stopCodexAppServerWellbeing(normalizedProviderKey);
    const timer = setTimeout(() => {
      void (async () => {
        const current = providerSessions.managed.get(normalizedProviderKey);
        if (!current) {
          return;
        }
        await runInContext(current.projectContext, async () => {
          await checkManagedConnection(normalizedProviderKey);
        });
      })()
        .catch((error) => {
          debugLog("appServerDaemon.wellbeing.error", {
            error: debugError(error),
            providerKey: normalizedProviderKey,
            sessionId: managed.sessionId
          });
        })
        .finally(() => {
          if (
            !codexAppServerServerClosing &&
            providerSessions.managed.has(normalizedProviderKey)
          ) {
            scheduleCodexAppServerWellbeing(normalizedProviderKey);
          }
        });
    }, providerSessions.wellbeingMs);
    timer.unref?.();
    codexAppServerWellbeingTimers.set(normalizedProviderKey, timer);
  }

  function rememberCodexAppServerManagedSession(providerKey = "", {
    providerOptions = {},
    sessionId = "",
    executionRoot = "",
    threadId = "",
    workdir = ""
  } = {}) {
    assertOpen();
    const normalizedProviderKey = normalizeText(providerKey);
    if (!normalizedProviderKey) {
      return;
    }
    providerSessions.managed.set(normalizedProviderKey, {
      projectContext: captureContext(),
      providerOptions,
      sessionId: normalizeText(sessionId),
      executionRoot: normalizeText(executionRoot),
      threadId: normalizeText(threadId),
      workdir: normalizeText(workdir)
    });
    scheduleCodexAppServerWellbeing(normalizedProviderKey);
  }

  function invalidateRuntimes(input = {}, preparation) {
    const serverShutdown = normalizeText(input?.reason) === "server-shutdown";
    if (serverShutdown) {
      beginCodexAppServerShutdown();
    }
    return (async () => {
      if (!preparation.enabled) {
        return preparation.disabledResult;
      }
      if (serverShutdown) {
        return shutdownCodexAppServerRuntimes(input);
      }
      if (input.includeOwned === true) {
        // An account change stops idle runtimes now and busy ones when their
        // turn ends; it never stops or waits for a running turn.
        return invalidateCodexAppServerRuntimes({
          ...input,
          deferBusy: true,
          includeOwned: true,
          requireVerifiedExit: true,
          stopOwnedRuntimes: true
        });
      }
      // Saved Helper threads are not reopened to be stopped: their records stay
      // for the next connection, which retires them against the new account.
      return invalidateCodexAppServerRuntimes({
        ...input,
        includeOwned: false,
        requireVerifiedExit: false
      });
    })();
  }

  return {
    get closing() { return codexAppServerServerClosing; },
    assertOpen,
    get reconcileGeneration() { return codexAppServerThreadReconcileGeneration; },
    nextReconcileGeneration() { return ++codexAppServerThreadReconcileGeneration; },
    reconcileTasks: codexAppServerReconcileTasks,
    sessionClosures: codexAppServerSessionClosures,
    invalidateRuntimes,
    resources: codexAppServerProviderResources,
    retireProvider: retireAndCloseCodexAppServerProvider,
    rememberManagedSession: rememberCodexAppServerManagedSession,
    managedSession: providerKey => providerSessions.managed.get(providerKey),
    managedThreadId: providerKey => providerSessions.managed.get(providerKey)?.threadId
  };
}
