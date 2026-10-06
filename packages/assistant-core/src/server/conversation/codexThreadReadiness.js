import {
  codexAppServerTurnStatusIsActive,
  codexAppServerThreadStatus,
  codexAppServerReadThreadStatus,
  normalizeCodexRunText
} from "./codexTurnState.js";
import { codexAppServerThreadIsMissing, ensureCodexAppServerThread } from "./codexProvider.js";
import { codexAppServerThreadRawValue, codexAppServerThreadTurnId } from "./codexEvents.js";

// Original native readiness, loaded-thread restoration and reconciliation drain.
// One Map retains the original run-owner lifetime and is shared with shutdown.
export function createCodexThreadReadiness({
  providerSessions,
  selection,
  observer,
  threadStatus,
  recovery,
  turnState,
  debugLog,
  debugError
}) {
  const codexAppServerThreadReconciliations = new Map();
  const {
    ensureCodexAppServerProviderForActiveTurn,
    codexAppServerSessionObserverOptions,
    rememberCodexAppServerPreparedThread
  } = selection;
  const {
    eventSubscriptionKey: codexAppServerEventSubscriptionKey,
    eventSubscriptionIsCurrent: codexAppServerEventSubscriptionIsCurrent,
    subscribeEvents: subscribeCodexAppServerEvents
  } = observer;
  const {
    reconcileThreadStatus: reconcileCodexAppServerThreadStatus,
    reconcileLoadedThreadStatus: reconcileCodexAppServerLoadedThreadStatus
  } = threadStatus;
  const {
    recoverActiveTurn: recoverCodexAppServerActiveTurn
  } = recovery;

  async function ensureCodexAppServerThreadReady(sessionId, context, preparation) {
    const { runtime, session, workdir } = context;
    // Runtime recovery may await a disconnect callback that writes session
    // state. This acquisition stays outside the original startup gate.
    const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session, preparation.managedIdentity);
    let providerOptions = activeProvider?.providerOptions;
    if (!providerOptions) {
      providerOptions = await preparation.providerOptions(session);
    }
    const provider = activeProvider?.provider || await providerSessions.owner.ensureSession(
      providerSessions.context(normalizeCodexRunText(sessionId), providerOptions),
      preparation.threadId(session)
    );
    const { currentSession: preparedSession, thread } = await preparation.gate(async currentSession => {
      const thread = await ensureCodexAppServerThread({
        ...preparation.preparation(currentSession),
        observeThread: threadId => subscribeCodexAppServerEvents(sessionId, provider, threadId,
          codexAppServerSessionObserverOptions(sessionId, providerOptions)),
        provider,
        workdir
      });
      return { currentSession, thread };
    });
    subscribeCodexAppServerEvents(sessionId, provider, thread.threadId,
      codexAppServerSessionObserverOptions(sessionId, providerOptions));
    rememberCodexAppServerPreparedThread(sessionId, providerOptions, context, thread);
    await reconcileCodexAppServerThreadStatus(sessionId, provider, thread.threadId, {
      failUnconfirmedTrackedTurn: true,
      observeLatestTurn: true,
      requireTrackedTurn: true,
      source: "thread_ready"
    });
    const ready = await preparation.ready(preparedSession);
    let currentSession = await runtime.getSession(sessionId);
    if (turnState(currentSession).state === "starting") {
      currentSession = await recoverCodexAppServerActiveTurn(sessionId, {
        provider,
        retryOnError: false,
        runtime
      });
    }
    return { ...ready, currentSession, thread };
  }

  async function reconcileCodexAppServerThreadForSession(normalizedSessionId, context, preparation) {
    const { runtime, session, executionRoot, workdir } = context;
    const threadId = preparation.threadId(session);
    if (!threadId) {
      const providerOptions = await preparation.providerOptions(session);
      const providerKey = providerSessions.context(normalizedSessionId, providerOptions).providerKey;
      await providerSessions.owner.ensureSession(providerSessions.context(normalizedSessionId, providerOptions));
      providerSessions.context(normalizedSessionId, providerOptions).runOwner.runtimeLifecycle.rememberManagedSession(providerKey, {
        providerOptions,
        sessionId: normalizedSessionId,
        executionRoot,
        workdir
      });
      return {
        ok: true,
        providerKey,
        sessionId: normalizedSessionId,
        status: "notStarted",
        threadId: ""
      };
    }
    const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session, preparation.managedIdentity);
    const providerOptions = activeProvider?.providerOptions || await preparation.providerOptions(session);
    const providerKey = activeProvider?.providerKey || providerSessions.context(normalizedSessionId, providerOptions).providerKey;
    const existing = codexAppServerThreadReconciliations.get(providerKey);
    if (existing) {
      return existing;
    }
    const reconciliation = (async () => {
      const provider = activeProvider?.provider || await providerSessions.owner.ensureSession(
        providerSessions.context(normalizedSessionId, providerOptions), threadId
      );
      try {
        const restored = await restoreCodexAppServerLoadedThread(normalizedSessionId, {
          runtime, provider, providerKey, threadId,
          subscriptionOptions: {
            get providerKey() { return providerSessions.context(normalizeCodexRunText(normalizedSessionId), providerOptions).providerKey; }
          },
          get resumeOptions() {
            return preparation.resumeOptions;
          },
          remember() {
            providerSessions.context(normalizedSessionId, providerOptions).runOwner.runtimeLifecycle.rememberManagedSession(providerKey, {
              providerOptions,
              sessionId: normalizedSessionId,
              executionRoot,
              threadId,
              workdir
            });
          },
          ready() { return preparation.ready(); }
        });
        if (restored) return restored;
      } catch (error) {
        debugLog("appServerThread.loadedList.error", {
          error: debugError(error),
          sessionId: normalizedSessionId,
          threadId
        });
      }
      const prepared = await preparation.readiness(ensureCodexAppServerThreadReady);
      return {
        ...prepared,
        providerKey
      };
    })().finally(() => {
      codexAppServerThreadReconciliations.delete(providerKey);
    });
    codexAppServerThreadReconciliations.set(providerKey, reconciliation);
    return reconciliation;
  }

  async function waitForOtherCodexAppServerThreadReconciliations({
    keepProviderKeys = new Set(),
    projectContextRoot = ""
  } = {}) {
    const pending = [...codexAppServerThreadReconciliations.entries()]
      .filter(([providerKey]) => !keepProviderKeys.has(providerKey));
    if (pending.length === 0) {
      return;
    }
    debugLog("appServerThread.reconcile.pruneWait.start", {
      pendingCount: pending.length,
      projectContextRoot: normalizeCodexRunText(projectContextRoot)
    });
    await Promise.allSettled(pending.map(([, reconciliation]) => reconciliation));
    debugLog("appServerThread.reconcile.pruneWait.done", {
      pendingCount: pending.length,
      projectContextRoot: normalizeCodexRunText(projectContextRoot)
    });
  }

  async function checkManagedConnection(providerKey = "", {
    reconnect = true
  } = {}) {
    providerSessions.assertOpen();
    const normalizedProviderKey = normalizeCodexRunText(providerKey);
    const managed = providerSessions.managed.get(normalizedProviderKey);
    const provider = providerSessions.owner.providers.get(normalizedProviderKey);
    const sessionId = normalizeCodexRunText(managed?.sessionId);
    const threadId = normalizeCodexRunText(managed?.threadId);
    if (!managed || !provider || !sessionId) {
      throw new Error("Codex app-server managed connection is incomplete.");
    }
    const current = providerSessions.connectionPolicy(sessionId, {
      threadId,
      get workdir() { return managed.workdir; },
      get current() {
        return providerSessions.managed.get(normalizedProviderKey) === managed &&
          providerSessions.owner.providers.get(normalizedProviderKey) === provider;
      }
    });
    current.assertCurrent();

    if (reconnect) {
      await providerSessions.owner.acquireRuntime({
        operation: () => provider.ensureAvailable?.(),
        provider,
        providerKey: normalizedProviderKey,
        providerOptions: managed.providerOptions || {}
      });
    }
    return maintainCodexAppServerManagedConnection(sessionId, {
      provider, providerKey: normalizedProviderKey, threadId, reconnect,
      get workdir() { return managed.workdir; },
      subscriptionOptions: {
        get providerKey() { return providerSessions.context(normalizeCodexRunText(sessionId), managed.providerOptions || {}).providerKey; }
      }
    }, current);
  }

  async function maintainCodexAppServerManagedConnection(sessionId, connection, current) {
    const { provider, providerKey, threadId, subscriptionOptions, reconnect = true } = connection;
    if (!threadId) {
      return {
        ok: true,
        status: "available"
      };
    }
    let providerThread;
    try {
      providerThread = await codexAppServerReadThreadStatus(provider, threadId);
    } catch (error) {
      if (reconnect || !codexAppServerThreadIsMissing(error, threadId)) {
        throw error;
      }
      providerThread = { status: "notLoaded" };
    }
    // The host rejects a late result after closure, renewal or lost admission.
    const session = await current.readSession();
    current.assertCurrent(session);
    try {
      const controls = await provider.ensureThreadControls?.(threadId);
      if (controls?.recovered) providerThread = await codexAppServerReadThreadStatus(provider, threadId);
    } catch (error) {
      current.assertCurrent(session);
      // Retain the existing stop owner and its visible recovery state. Do not
      // spend automatic goal turns or repeatedly probe a known failed binding.
      void Promise.resolve(provider.failObservation?.(error)).catch(() => null);
      throw error;
    }
    current.assertCurrent(session);
    const nativeStatus = codexAppServerThreadRawValue(providerThread).status;
    const subscriptionKey = codexAppServerEventSubscriptionKey(
      providerKey,
      threadId
    );
    const subscriptionIsCurrent = codexAppServerEventSubscriptionIsCurrent(subscriptionKey, provider);
    if (!reconnect && (
      nativeStatus === "notLoaded" || nativeStatus?.type === "notLoaded" || !subscriptionIsCurrent
    )) {
      return { ok: true, requiresPreparation: true };
    }
    if (!subscriptionIsCurrent) {
      subscribeCodexAppServerEvents(
        sessionId,
        provider,
        threadId,
        subscriptionOptions
      );
      await provider.resumeThread?.(threadId, {
        cwd: normalizeCodexRunText(connection.workdir)
      });
      return reconcileCodexAppServerLoadedThreadStatus(
        sessionId,
        provider,
        threadId,
        {
          observeLatestTurn: true
        }
      );
    }

    const trackedTurn = turnState(session);
    const providerStatus = codexAppServerThreadStatus(providerThread);
    const providerTurnId = codexAppServerThreadTurnId(providerThread);
    const providerIsActive = codexAppServerTurnStatusIsActive(providerStatus);
    const trackedIdentityMatches = (
      trackedTurn.threadId === threadId &&
      (!providerTurnId || trackedTurn.turnId === providerTurnId)
    );
    if (
      (providerIsActive && (
        !trackedTurn.active ||
        trackedTurn.state !== "active" ||
        !trackedIdentityMatches
      )) ||
      (!providerIsActive && trackedTurn.active)
    ) {
      return reconcileCodexAppServerThreadStatus(
        sessionId,
        provider,
        threadId,
        {
          observeLatestTurn: true,
          source: "wellbeing"
        }
      );
    }
    return {
      ok: true,
      status: "healthy",
      threadId
    };
  }

  async function codexAppServerLoadedThreadIds(provider = null) {
    if (typeof provider?.listLoadedThreads !== "function") {
      return null;
    }
    const threadIds = new Set();
    let cursor = null;
    do {
      const response = await provider.listLoadedThreads({
        ...(cursor ? { cursor } : {}),
        limit: 100
      });
      for (const threadId of Array.isArray(response?.data) ? response.data : []) {
        const normalizedThreadId = normalizeCodexRunText(threadId);
        if (normalizedThreadId) {
          threadIds.add(normalizedThreadId);
        }
      }
      cursor = normalizeCodexRunText(response?.nextCursor);
    } while (cursor);
    return threadIds;
  }

  async function restoreCodexAppServerLoadedThread(sessionId, context) {
    const { runtime, provider, providerKey, threadId } = context;
    const loadedThreadIds = await codexAppServerLoadedThreadIds(provider);
    if (!loadedThreadIds?.has(threadId)) return null;
    const subscription = subscribeCodexAppServerEvents(
      sessionId,
      provider,
      threadId,
      context.subscriptionOptions
    );
    const subscriptionStatus = normalizeCodexRunText(subscription?.status) || "subscribed";
    if (subscriptionStatus !== "alreadySubscribed") {
      await provider.resumeThread(threadId, context.resumeOptions);
    }
    context.remember();
    await reconcileCodexAppServerLoadedThreadStatus(
      sessionId,
      provider,
      threadId,
      {
        observeLatestTurn: subscriptionStatus !== "alreadySubscribed"
      }
    ).catch((error) => {
      debugLog("appServerThread.statusReconcile.error", {
        error: debugError(error),
        sessionId: sessionId,
        threadId
      });
    });
    let loadedSession = await runtime.getSession(sessionId);
    if (turnState(loadedSession).state === "starting") {
      loadedSession = await recoverCodexAppServerActiveTurn(sessionId, {
        provider,
        retryOnError: false,
        runtime
      });
    }
    await context.ready();
    if (subscriptionStatus === "alreadySubscribed") {
      return {
        ok: true,
        providerKey,
        sessionId: sessionId,
        status: "alreadySubscribed",
        threadId
      };
    }
    return {
      ok: true,
      providerKey,
      sessionId: sessionId,
      status: subscriptionStatus === "resubscribed" ? "resubscribed" : "loaded",
      threadId
    };
  }

  return {
    threadReconciliations: codexAppServerThreadReconciliations,
    ensureThreadReady: ensureCodexAppServerThreadReady,
    reconcileThread: reconcileCodexAppServerThreadForSession,
    waitForThreadReconciliations: waitForOtherCodexAppServerThreadReconciliations,
    checkManagedConnection,
    restoreLoadedThread: restoreCodexAppServerLoadedThread
  };
}
