import { normalizeCodexRunText } from "./codexTurnState.js";
import { codexAppServerProjectHookTrustConfig } from "./codexConfiguration.js";
import { createCodexAppServerModelCatalogCache } from "./codexModelCatalog.js";
import { readCodexAppServerAccountIdentity } from "./codexHelperExecution.js";

// Provider acquisition and per-operation provider contexts for a run owner's
// managed threads, with their model catalogue and account identity reads.
export function createCodexProviderSelection({
  providerSessions,
  turnState,
  helperLifecycle,
  helperOwnershipError,
  modelCatalogCacheMs,
  errorPrefix
}) {
  const readCodexAppServerModelCatalog = createCodexAppServerModelCatalogCache({
    cacheMs: modelCatalogCacheMs,
    errorPrefix
  });
  function sessionConnection(sessionId, providerOptions) {
    return providerSessions.context(normalizeCodexRunText(sessionId), providerOptions);
  }

  function ensureSessionProvider(sessionId, providerOptions, threadId) {
    return providerSessions.owner.ensureSession(sessionConnection(sessionId, providerOptions), threadId);
  }

  // `{ provider, release }`: a use that does not keep the provider running.
  function borrowSessionProvider(sessionId, providerOptions) {
    return providerSessions.owner.borrowSession(sessionConnection(sessionId, providerOptions));
  }

  function rememberManagedSession(sessionId, providerOptions, { executionRoot, workdir, threadId } = {}) {
    const connection = sessionConnection(sessionId, providerOptions);
    connection.runOwner.runtimeLifecycle.rememberManagedSession(connection.providerKey, {
      providerOptions,
      sessionId: normalizeCodexRunText(sessionId),
      executionRoot,
      threadId,
      workdir
    });
  }

  // A provider left on the previous account (stale) serves only the turn it
  // is still running: its output, steer and interrupt. Anything else goes to
  // the session's provider for the current account.
  function managedProviderKeyForThread(sessionId, workdir, threadId, { turnActive = false } = {}) {
    for (const [providerKey, managed] of providerSessions.managed) {
      const provider = providerSessions.owner.providers.get(providerKey);
      if (
        managed.sessionId !== sessionId ||
        managed.workdir !== workdir ||
        managed.threadId !== threadId ||
        provider?.isAvailable?.() !== true ||
        provider.stale && !turnActive
      ) {
        continue;
      }
      return providerKey;
    }
    return null;
  }

  async function ensureCodexAppServerProviderForManagedThread(session = {}, options = {}) {
    const normalizedSessionId = normalizeCodexRunText(session.sessionId || session.id);
    const turn = turnState(session);
    if (!normalizedSessionId || !turn.threadId) {
      return null;
    }
    const normalizedExecutionRoot = normalizeCodexRunText(options.executionRoot);
    const normalizedWorkdir = normalizeCodexRunText(options.workdir);
    for (const [providerKey, managed] of providerSessions.managed.entries()) {
      const fields = providerSessions.keyFields(providerKey);
      if (
        fields.sessionId !== normalizedSessionId ||
        (normalizedExecutionRoot && fields.executionRoot !== normalizedExecutionRoot) ||
        (normalizedWorkdir && fields.workdir !== normalizedWorkdir) ||
        normalizeCodexRunText(managed?.sessionId) !== normalizedSessionId ||
        normalizeCodexRunText(managed?.threadId) !== turn.threadId
      ) {
        continue;
      }
      const provider = providerSessions.owner.providers.get(providerKey);
      if (provider && !(provider.stale && !turn.active)) {
        return {
          provider: await ensureSessionProvider(normalizedSessionId, managed.providerOptions),
          providerKey,
          providerOptions: managed.providerOptions
        };
      }
    }
    return null;
  }

  async function ensureCodexAppServerProviderForActiveTurn(session = {}, options = {}) {
    if (!turnState(session).active) {
      return null;
    }
    return ensureCodexAppServerProviderForManagedThread(session, options);
  }

  async function acquireCodexAppServerOutputProvider(sessionId, session, managedIdentity, prepareProviderOptions) {
    const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session, managedIdentity);
    const provider = activeProvider?.provider;
    if (provider) return provider;
    return await ensureSessionProvider(sessionId, await prepareProviderOptions());
  }

  async function codexAppServerRuntimeForVisibleTerminal(rawSessionId, session, options, managedIdentity, prepareProviderOptions) {
    const sessionId = normalizeCodexRunText(rawSessionId);
    const activeProvider = await ensureCodexAppServerProviderForActiveTurn(session, managedIdentity);
    const providerOptions = activeProvider?.providerOptions || await prepareProviderOptions();
    const provider = activeProvider?.provider || await ensureSessionProvider(sessionId, providerOptions);
    await codexAppServerProjectHookTrustConfig(provider, options.workdir, {
      persist: true
    });
    const providerKey = activeProvider?.providerKey || sessionConnection(sessionId, providerOptions).providerKey;
    return providerSessions.owner.acquireRuntime({
      operation: () => provider.ensureRuntime(),
      provider,
      providerKey,
      providerOptions
    });
  }

  function codexAppServerMessageContext(sessionId, context) {
    const { runtime, session } = context;
    return {
      runtime,
      session,
      threadId: context.threadId,
      async acquireProvider(currentSession) {
        const activeProvider = await ensureCodexAppServerProviderForManagedThread(
          currentSession, context.managedIdentity(currentSession)
        );
        if (activeProvider) return { provider: activeProvider.provider || null, reused: true };
        return {
          provider: await ensureSessionProvider(sessionId, await context.providerOptions(currentSession)),
          reused: false
        };
      }
    };
  }

  function codexAppServerControlContext(sessionId, context) {
    return {
      runtime: context.runtime,
      admissionError: context.admissionError,
      threadId: context.threadId,
      async acquireProvider(currentSession) {
        const activeProvider = await ensureCodexAppServerProviderForActiveTurn(
          currentSession, context.managedIdentity(currentSession)
        );
        return activeProvider?.provider ||
          await ensureSessionProvider(sessionId, await context.providerOptions(currentSession));
      },
      observationOwner(threadId) {
        for (const [key, managed] of providerSessions.managed) {
          const owner = providerSessions.owner.providers.get(key);
          if (managed.sessionId === sessionId && managed.threadId === threadId && owner?.observationFailure) {
            return owner;
          }
        }
        return null;
      }
    };
  }

  function codexAppServerObservationRecoveryContext(sessionId, context) {
    return {
      threadId: context.threadId,
      async acquireProvider(current) {
        return ensureSessionProvider(sessionId, await context.providerOptions(current));
      }
    };
  }

  function codexAppServerSessionObserverOptions(sessionId, providerOptions) {
    return {
      get providerKey() {
        return sessionConnection(sessionId, providerOptions).providerKey;
      }
    };
  }


  async function readExecutionProfileModelCatalog(sessionId, preparation) {
    if (!preparation.assistantScope) {
      const restoration = await preparation.helperRestoration;
      helperLifecycle.assertRestored(await helperLifecycle.restoreThreads(
        restoration.projectRuntimeRoot, restoration.context
      ));
    }
    const provider = preparation.provider || await ensureSessionProvider(sessionId, await preparation.providerOptions);
    return readCodexAppServerModelCatalog(provider, { signal: preparation.signal });
  }

  async function readProviderAccountIdentity(sessionId, preparation) {
    const restoration = await preparation.helperRestoration;
    helperLifecycle.assertRestored(await helperLifecycle.restoreThreads(
      restoration.projectRuntimeRoot, restoration.context
    ));
    const providerOptions = await preparation.providerOptions;
    const context = sessionConnection(sessionId, providerOptions);
    const provider = await providerSessions.owner.withLifecycle(
      () => providerSessions.owner.providerForSession(context),
      context.providerKey,
      providerOptions
    );
    return readCodexAppServerAccountIdentity(provider, helperOwnershipError);
  }

  return {
    readExecutionProfileModelCatalog,
    readProviderAccountIdentity,
    managedProviderKeyForThread,
    ensureCodexAppServerProviderForActiveTurn,
    acquireCodexAppServerOutputProvider,
    codexAppServerRuntimeForVisibleTerminal,
    codexAppServerMessageContext,
    codexAppServerControlContext,
    codexAppServerObservationRecoveryContext,
    codexAppServerSessionObserverOptions,
    sessionConnection,
    ensureSessionProvider,
    borrowSessionProvider,
    rememberManagedSession
  };
}
