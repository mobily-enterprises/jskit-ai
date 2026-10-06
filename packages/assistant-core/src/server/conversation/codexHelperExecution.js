import { deleteCodexAppServerThread } from "./codexProvider.js";
import { CODEX_HELPER_THREAD_LIFECYCLES } from "./codexHelperThreadLedger.js";

function normalizeText(value) {
  return String(value || "").trim();
}

export function errorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeText(value?.error || value?.message || value) || fallback;
}

export function createCodexHelperOwnershipError({ applicationName = "Application", errorPrefix = "" } = {}) {
  return function codexAppServerHelperOwnershipError(message = "", details = {}) {
    const error = new Error(
      normalizeText(message) ||
      `${applicationName} could not prove ownership of a persisted low-cost assistant thread.`
    );
    error.code = `${errorPrefix}codex_helper_ownership_blocked`;
    error.statusCode = 409;
    error.retryable = details.retryable !== false;
    error.details = {
      ...details,
      retryable: error.retryable
    };
    return error;
  };
}

export async function readCodexAppServerAccountIdentity(provider, codexAppServerHelperOwnershipError) {
  if (typeof provider.currentRuntimeInfo !== "function") {
    throw codexAppServerHelperOwnershipError(
      "The Codex provider cannot identify the selected account."
    );
  }
  const runtimeInfo = await provider.currentRuntimeInfo();
  const accountIdentitySignature = normalizeText(runtimeInfo?.accountIdentitySignature);
  if (!/^sha256:[a-f0-9]{64}$/u.test(accountIdentitySignature)) {
    throw codexAppServerHelperOwnershipError(
      "The Codex provider did not return a stable selected-account identity."
    );
  }
  return accountIdentitySignature;
}

export async function assertCodexAppServerHelperAccountIdentity(provider, expectedSignature = "", codexAppServerHelperOwnershipError) {
  const expected = normalizeText(expectedSignature);
  if (!expected) {
    return;
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(expected) || typeof provider?.currentRuntimeInfo !== "function") {
    throw codexAppServerHelperOwnershipError(
      "The requested low-cost assistant account identity is invalid. Refresh the task and retry."
    );
  }
  const actual = normalizeText((await provider.currentRuntimeInfo())?.accountIdentitySignature);
  if (actual !== expected) {
    throw codexAppServerHelperOwnershipError(
      "The selected Codex account changed before low-cost assistant work could run. Retry the task with the current account."
    );
  }
}

// Advanced host facility: applications prepare their Helper policy; this shared
// operation owns native execution-context lookup and the actual dispatch.
export async function sendPreparedCodexAppServerHelperTurn(provider, prepared, helperIsolation) {
  const turn = await provider.sendTurn(
    prepared.threadId,
    prepared.input,
    prepared.turnSettings((await helperIsolation.executionContext(provider)).cwd)
  );
  return Object.freeze({ executionProfile: prepared.executionProfile, input: prepared.input, turn });
}

// One invocation retains its original mutable record while the shared ownership
// facet retains all durable state, locks and cross-operation coordination.
export async function prepareDetachedCodexHelperThread(owner, scope, preparation, {
  applicationName = "Application"
} = {}) {
  const {
    withProjectOperation: withCodexAppServerHelperProjectOperation,
    remember: rememberCodexAppServerHelperThread,
    update: updateCodexAppServerHelperThread,
    remove: removeCodexAppServerHelperThread,
    retire: retireCodexAppServerHelperThread,
    ownershipError: codexAppServerHelperOwnershipError,
    cleanupError: codexAppServerHelperThreadCleanupError,
    key: codexAppServerHelperThreadKey,
    turnStarts: codexAppServerHelperTurnStarts
  } = owner;
  const {
    executionProfile, onRetired, projectRuntimeRoot, provider, sessionId,
    requestedThreadId, workdir
  } = scope;
  let thread = null;
  let helperThreadRecord = scope.record;

  async function startAndRememberCodexAppServerHelperThread({
    scope = {},
    executionProfile = null,
    onRetired = null,
    projectRuntimeRoot = "",
    provider = null,
    sessionId = "",
    workdir = ""
  } = {}) {
    return withCodexAppServerHelperProjectOperation(projectRuntimeRoot, async () => {
      const projectContextRoot = normalizeText(scope.projectContextRoot);
      let thread = null;
      try {
        const started = await preparation.isolation.start(provider, async () => {
          const prepared = preparation.start();
          const enforcement = await preparation.isolation.inspect(provider, prepared.inspection);
          return prepared.prepared(enforcement);
        });
        thread = started.thread;
      } catch (error) {
        const failedThreadId = normalizeText(error?.codexAppServerHelperThreadId);
        if (
          error?.codexAppServerHelperThreadCleanupRequired === true &&
          failedThreadId
        ) {
          await rememberCodexAppServerHelperThread({
            executionProfile,
            lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED,
            projectContextRoot,
            projectRuntimeRoot,
            provider,
            sessionId,
            threadId: failedThreadId,
            workdir
          });
        }
        throw error;
      }
      const threadId = normalizeText(thread?.id || thread?.response?.thread?.id);
      if (!threadId) {
        throw new Error("Codex app-server did not return a helper thread id.");
      }
      try {
        const record = await rememberCodexAppServerHelperThread({
          executionProfile,
          lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.STARTING_TURN,
          onRetired,
          projectContextRoot,
          projectRuntimeRoot,
          provider,
          sessionId,
          threadId,
          workdir
        });
        return { record, thread, threadId };
      } catch (ledgerError) {
        try {
          await deleteCodexAppServerThread({ provider, threadId });
        } catch (cleanupError) {
          const failure = codexAppServerHelperOwnershipError(
            `${applicationName} could not persist or retire a newly created low-cost assistant thread.`,
            {
              cleanupError: errorMessage(cleanupError),
              ledgerError: errorMessage(ledgerError),
              sessionId,
              threadId
            }
          );
          failure.cause = ledgerError;
          throw failure;
        }
        throw ledgerError;
      }
    });
  }

  if (requestedThreadId) {
    try {
      helperThreadRecord = await updateCodexAppServerHelperThread(
        helperThreadRecord,
        {
          lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.STARTING_TURN,
          onRetired,
          turnId: ""
        }
      );
      const resumed = await preparation.isolation.resume(provider, requestedThreadId, async () => {
        const prepared = preparation.resume();
        const enforcement = await preparation.isolation.inspect(provider, prepared.inspection);
        return prepared.prepared(enforcement);
      });
      thread = resumed.thread;
    } catch (error) {
      if (error?.codexAppServerHelperThreadRetired === true) {
        try {
          await removeCodexAppServerHelperThread(helperThreadRecord);
        } catch (ledgerError) {
          throw codexAppServerHelperThreadCleanupError(
            helperThreadRecord,
            ledgerError
          );
        }
      } else if (error?.codexAppServerHelperThreadCleanupRequired === true) {
        try {
          helperThreadRecord = await updateCodexAppServerHelperThread(
            helperThreadRecord,
            {
              lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED
            }
          );
        } catch (ledgerError) {
          throw codexAppServerHelperThreadCleanupError(
            helperThreadRecord,
            ledgerError
          );
        }
      } else {
        try {
          await retireCodexAppServerHelperThread(helperThreadRecord);
        } catch (cleanupError) {
          cleanupError.cause = error;
          throw cleanupError;
        }
      }
      throw error;
    }
  }
  if (!thread) {
    const started = await startAndRememberCodexAppServerHelperThread({
      scope,
      executionProfile,
      onRetired,
      projectRuntimeRoot,
      provider,
      sessionId,
      workdir
    });
    helperThreadRecord = started.record;
    thread = started.thread;
  }

  const discardHelperThread = async () => {
    if (!helperThreadRecord) {
      return;
    }
    await retireCodexAppServerHelperThread(helperThreadRecord);
  };

  async function dispatch(threadId, failDispatch) {
    let delivery = null;
    let turnId = "";
    let status = "";
    let helperTurnStart = null;
    try {
      const helperThreadKey = codexAppServerHelperThreadKey(helperThreadRecord);
      helperTurnStart = (async () => {
        const currentDelivery = await sendPreparedCodexAppServerHelperTurn(
          provider, preparation.turn(threadId), preparation.isolation
        );
        const currentTurnId = normalizeText(currentDelivery.turn?.id);
        const currentStatus = normalizeText(
          currentDelivery.turn?.status || currentDelivery.turn?.raw?.status
        );
        helperThreadRecord = await updateCodexAppServerHelperThread(
          helperThreadRecord,
          {
            lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE,
            turnId: currentTurnId
          }
        );
        return {
          delivery: currentDelivery,
          status: currentStatus,
          turnId: currentTurnId
        };
      })();
      codexAppServerHelperTurnStarts.set(helperThreadKey, helperTurnStart);
      ({ delivery, status, turnId } = await helperTurnStart);
    } catch (error) {
      await failDispatch(error);
    } finally {
      if (helperTurnStart) {
        const helperThreadKey = codexAppServerHelperThreadKey(helperThreadRecord);
        if (codexAppServerHelperTurnStarts.get(helperThreadKey) === helperTurnStart) {
          codexAppServerHelperTurnStarts.delete(helperThreadKey);
        }
      }
    }
    return { delivery, status, turnId };
  }

  async function complete() {
    try {
      helperThreadRecord = await updateCodexAppServerHelperThread(helperThreadRecord, {
        lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.READY,
        turnId: ""
      });
    } catch (error) {
      try {
        await retireCodexAppServerHelperThread(helperThreadRecord);
      } catch (cleanupError) {
        cleanupError.cause = error;
        throw cleanupError;
      }
      throw error;
    }
  }

  return Object.freeze({ thread, dispatch, discard: discardHelperThread, complete });
}
