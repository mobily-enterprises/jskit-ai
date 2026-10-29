import { normalizeCodexRunText } from "./codexTurnState.js";

// Cleanup of the existing run/provider/Helper owners. The application keeps
// its authority and storage projections; all native coordination stays here:
// one closure per session key (shared with the runtime lifecycle, which drains
// them on shutdown) and the private record of which closures are restricted.
export function createCodexSessionCleanup({ namespace, runOwner, providerSessions, sessionClosures, helperLifecycle,
  journal, conversations, debugLog, debugError }) {
  const providerOwner = providerSessions?.owner;
  const restrictedClosures = new WeakSet();

  // Saved Helper records are retired through the providers a close is about to
  // stop. A record that cannot be restored (a removed account, a malformed or
  // unreadable ledger) stays on disk for a later connection; the host publishes
  // its failure, and the close still stops everything this server runs.
  async function restoreSavedHelpers(readRestoration, event, identity = {}) {
    let restored;
    try {
      const restoration = await readRestoration();
      restored = await helperLifecycle.restoreThreads(restoration.projectRuntimeRoot, restoration.context);
    } catch (error) {
      restored = { failed: [helperLifecycle.failure(identity, error)], ok: false };
    }
    if (restored.ok === false) {
      debugLog(event, {
        ...identity,
        failed: restored.failed.map(({ code, error, sessionId, threadId }) => ({ code, error, sessionId, threadId }))
      });
    }
    return restored;
  }

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
      const prepareFailed = (error) => {
        debugLog("appServerRuntime.closeSession.prepare.error", {
          error: debugError(error),
          sessionId: normalizedSessionId
        });
        return error;
      };
      let prepared = null;
      let session = null;
      try {
        prepared = await cleanup.read();
        session = prepared.session;
      } catch (error) {
        throw prepareFailed(error);
      }
      // Live work stops first, through the connections that observe it.
      await conversations.closeCodexAppServerConversations(normalizedSessionId);
      await restoreSavedHelpers(() => prepared.helpers, "appServerRuntime.closeSession.helperRestore.failed", {
        sessionId: normalizedSessionId
      });
      try {
        // Helper threads attached to a live provider must be gone before it stops.
        helperLifecycle.assertRetired(await helperLifecycle.retireAll({
          projectRuntimeRoot: prepared.projectRuntimeRoot,
          sessionId: normalizedSessionId
        }));
      } catch (error) {
        throw prepareFailed(error);
      }
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
    const sessionNamespacePrefix = namespace("");
    const conversationFailures = [];
    for (const sessionKey of [...conversations.codexAppServerConversations.keys()]) {
      if (!sessionKey.startsWith(sessionNamespacePrefix)) {
        continue;
      }
      const sessionId = sessionKey.slice(sessionNamespacePrefix.length);
      try {
        await conversations.closeCodexAppServerConversations(sessionId);
      } catch (error) {
        conversationFailures.push({
          code: normalizeCodexRunText(error?.code),
          error: normalizeCodexRunText(error?.message || error),
          retryable: error?.retryable !== false,
          sessionId
        });
      }
    }
    const helperRestore = await restoreSavedHelpers(() => preparation.helpers,
      "appServerRuntime.closeProject.helperRestore.failed",
      { projectContextRoot: normalizeCodexRunText(input.projectContextRoot) });
    // Every provider of the project's sessions stops, including one a
    // Temporary chat or a read borrowed and no Main thread names.
    const stopped = await providerOwner.stopProvidersForProject(input, {
      managed: providerSessions.managed,
      keyFields: providerSessions.keyFields,
      helperThreads: helperLifecycle,
      sessionKeyPrefix: sessionNamespacePrefix
    });
    const failed = [...conversationFailures, ...stopped.failed];
    return {
      ...stopped,
      failed,
      helperRestore: { failed: helperRestore.failed, ok: helperRestore.ok !== false },
      ok: failed.length === 0
    };
  }

  return { closeSession, closeProject };
}
