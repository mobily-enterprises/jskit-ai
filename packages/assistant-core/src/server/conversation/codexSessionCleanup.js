import { normalizeCodexRunText } from "./codexTurnState.js";

// Cleanup of the existing run/provider/Helper owners. The application keeps
// its authority and storage projections; all native coordination stays here:
// one closure per session key (shared with the runtime lifecycle, which drains
// them on shutdown) and the private record of which closures are restricted.
export function createCodexSessionCleanup({ namespace, runOwner, providerSessions, sessionClosures, helperLifecycle,
  journal, conversations, debugLog, debugError }) {
  const providerOwner = providerSessions?.owner;
  const restrictedClosures = new WeakSet();

  async function closeSession(sessionId, cleanup) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const sessionKey = cleanup.sessionKey;
    let pending = sessionClosures.get(sessionKey);
    while (pending) {
      const pendingIsRestricted = restrictedClosures.has(pending);
      if (cleanup.restricted && !pendingIsRestricted) {
        await pending.catch(() => null);
        pending = sessionClosures.get(sessionKey);
        continue;
      }
      if (!cleanup.restricted && pendingIsRestricted) {
        await cleanup.assertPublicAccess();
      }
      return pending;
    }
    const closing = (async () => {
      await providerOwner.drainThreadEnvironmentTasks(sessionKey);
      journal.clearSessionRecoveryTimers(normalizedSessionId);
      let prepared = null;
      let session = null;
      try {
        prepared = await cleanup.read();
        const restoration = await prepared.helpers;
        helperLifecycle.assertRestored(await helperLifecycle.restoreThreads(
          restoration.projectRuntimeRoot, restoration.context
        ));
        helperLifecycle.assertRetired(await helperLifecycle.retireAll({
          projectRuntimeRoot: prepared.projectRuntimeRoot,
          sessionId: normalizedSessionId
        }));
        session = prepared.session;
      } catch (error) {
        debugLog("appServerRuntime.closeSession.prepare.error", {
          error: debugError(error),
          sessionId: normalizedSessionId
        });
        throw error;
      }
      await conversations.closeCodexAppServerConversations(normalizedSessionId);
      const { exitFailure } = await providerOwner.releaseSession(sessionKey, {
        sessionId: normalizedSessionId,
        runOwner,
        get changeover() { return cleanup.changeover; },
        preserveProcessExitProof: cleanup.preserveProcessExitProof,
        get requireStopped() { return cleanup.requireStopped; },
        session
      });
      await prepared.complete(exitFailure);
    })();
    sessionClosures.set(sessionKey, closing);
    if (cleanup.restricted) {
      restrictedClosures.add(closing);
    }
    try {
      return await closing;
    } finally {
      if (sessionClosures.get(sessionKey) === closing) {
        sessionClosures.delete(sessionKey);
      }
    }
  }

  async function closeProject(input = {}, preparation) {
    const restoration = await preparation.helpers;
    helperLifecycle.assertRestored(await helperLifecycle.restoreThreads(
      restoration.projectRuntimeRoot, restoration.context
    ));
    const sessionNamespacePrefix = namespace("");
    for (const sessionKey of [...conversations.codexAppServerConversations.keys()]) {
      if (!sessionKey.startsWith(sessionNamespacePrefix)) {
        continue;
      }
      await conversations.closeCodexAppServerConversations(
        sessionKey.slice(sessionNamespacePrefix.length)
      );
    }
    return providerOwner.stopProvidersForProject(input, {
      managed: providerSessions.managed,
      keyFields: providerSessions.keyFields,
      helperThreads: helperLifecycle
    });
  }

  return { closeSession, closeProject };
}
