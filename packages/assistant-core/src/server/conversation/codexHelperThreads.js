import crypto from "node:crypto";
import { createCodexHelperOwnershipError, errorMessage, prepareDetachedCodexHelperThread } from "./codexHelperExecution.js";
import { deleteCodexAppServerHelperThread } from "./codexProvider.js";
import { createCodexHelperThreadRecovery, directoryExists, normalizeText } from "./codexHelperThreadRecovery.js";
import {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES
} from "./codexHelperThreadLedger.js";

const CODEX_APP_SERVER_PROVIDER_ID = "codex_app_server";

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Internal facet of the original run owner. Public supplies policy and authorized
// scope inputs; native ownership, pending work and retirement have one owner.
export function createCodexHelperThreadLifecycle({
  providerOwner,
  ledgerOwner,
  applicationName = "Application",
  errorPrefix = ""
} = {}) {
  const codexAppServerProviders = providerOwner.providers;
  const {
    createCodexHelperThreadLedger: codexHelperThreadLedgerFactory,
    defineCodexHelperThreadRecord
  } = ledgerOwner;
  const codexAppServerHelperThreads = new Map();
  const codexAppServerHelperProjectOperations = new Map();
  const codexAppServerHelperThreadCleanups = new Map();
  const codexAppServerHelperThreadLedgers = new Map();
  const codexAppServerHelperThreadMutations = new Map();
  const codexAppServerHelperTurnStarts = new Map();
  const codexAppServerHelperThreadRestores = new Map();

  function codexAppServerHelperThreadKey({
    projectRuntimeRoot = "",
    sessionId = "",
    threadId = ""
  } = {}) {
    return [
      normalizeText(projectRuntimeRoot),
      normalizeText(sessionId),
      normalizeText(threadId)
    ].join("\u001f");
  }

  async function withCodexAppServerHelperProjectOperation(
    projectRuntimeRoot = "",
    operation
  ) {
    const key = normalizeText(projectRuntimeRoot);
    if (!key || typeof operation !== "function") {
      throw codexAppServerHelperOwnershipError(
        `${applicationName} project runtime state is unavailable for low-cost assistant ownership.`
      );
    }
    const previous = codexAppServerHelperProjectOperations.get(key) || Promise.resolve();
    const current = previous.catch(() => null).then(operation);
    codexAppServerHelperProjectOperations.set(key, current);
    try {
      return await current;
    } finally {
      if (codexAppServerHelperProjectOperations.get(key) === current) {
        codexAppServerHelperProjectOperations.delete(key);
      }
    }
  }

  function codexAppServerHelperThreadUnavailableError(threadId = "") {
    const error = new Error(
      "This low-cost assistant thread is no longer available. Start the background task again instead of reusing another assistant conversation."
    );
    error.code = `${errorPrefix}codex_helper_thread_unavailable`;
    error.statusCode = 409;
    error.threadId = normalizeText(threadId);
    return error;
  }

  function codexAppServerHelperThreadForOperation({
    executionProfile = null,
    lifecycles = [CODEX_HELPER_THREAD_LIFECYCLES.READY],
    projectRuntimeRoot = "",
    provider = null,
    sessionId = "",
    threadId = "",
    turnId = "",
    workdir = ""
  } = {}) {
    const record = codexAppServerHelperThreads.get(
      codexAppServerHelperThreadKey({ projectRuntimeRoot, sessionId, threadId })
    );
    if (
      !record ||
      !lifecycles.includes(record.lifecycle) ||
      record.provider !== provider ||
      record.workdir !== normalizeText(workdir) ||
      (normalizeText(turnId) && record.turnId !== normalizeText(turnId)) ||
      !ledgerOwner.matchesExecutionProfile(
        record.executionProfile,
        executionProfile || {}
      )
    ) {
      throw codexAppServerHelperThreadUnavailableError(threadId);
    }
    return record;
  }

  function inspectCodexAppServerHelperControl(operation, input, scope) {
    const { sessionId, threadId, turnId } = scope;
    if (operation === "delete") {
      if (scope.retiredThreadIds?.includes(threadId)) {
        return { deleted: true, ok: true, status: "deleted", threadId };
      }
      const helperThread = codexAppServerHelperThreads.get(
        codexAppServerHelperThreadKey({ projectRuntimeRoot: scope.projectRuntimeRoot, sessionId, threadId })
      );
      if (helperThread) {
        if (!isRecord(input.executionProfile)) throw codexAppServerHelperThreadUnavailableError(threadId);
        return retireCodexAppServerHelperThread(codexAppServerHelperThreadForOperation({
          executionProfile: input.executionProfile,
          lifecycles: Object.values(CODEX_HELPER_THREAD_LIFECYCLES),
          projectRuntimeRoot: scope.projectRuntimeRoot,
          provider: scope.provider,
          sessionId,
          threadId,
          workdir: scope.workdir
        }));
      }
      if (isRecord(input.executionProfile)) throw codexAppServerHelperThreadUnavailableError(threadId);
    } else if (isRecord(input.executionProfile)) {
      codexAppServerHelperThreadForOperation({
        executionProfile: input.executionProfile,
        lifecycles: [CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE],
        projectRuntimeRoot: scope.projectRuntimeRoot,
        provider: scope.provider,
        sessionId,
        threadId,
        turnId,
        workdir: scope.workdir
      });
    }
  }

  function codexAppServerHelperThreadLedger(projectRuntimeRoot = "") {
    const normalizedProjectRuntimeRoot = normalizeText(projectRuntimeRoot);
    let ledger = codexAppServerHelperThreadLedgers.get(normalizedProjectRuntimeRoot);
    if (!ledger) {
      ledger = codexHelperThreadLedgerFactory({
        projectRuntimeRoot: normalizedProjectRuntimeRoot
      });
      codexAppServerHelperThreadLedgers.set(normalizedProjectRuntimeRoot, ledger);
    }
    return ledger;
  }

  function codexAppServerProviderKeyForProvider(provider = null) {
    for (const [providerKey, candidate] of codexAppServerProviders.entries()) {
      if (candidate === provider) {
        return providerKey;
      }
    }
    return "";
  }

  function codexAppServerProviderKeyFingerprint(providerKey = "") {
    return `sha256:${crypto.createHash("sha256")
      .update(normalizeText(providerKey))
      .digest("hex")}`;
  }

  async function codexAppServerHelperThreadIdentity({
    executionProfile = null,
    provider = null
  } = {}) {
    if (
      typeof provider?.currentRuntimeInfo !== "function" ||
      typeof provider?.currentServerInfo !== "function"
    ) {
      throw new Error("Codex provider cannot prove durable helper thread ownership.");
    }
    const runtime = await provider.currentRuntimeInfo();
    const server = provider.currentServerInfo();
    const providerKey = codexAppServerProviderKeyForProvider(provider);
    if (!providerKey) {
      throw new Error("Codex helper provider is not owned by this controller.");
    }
    return Object.freeze({
      providerId: normalizeText(executionProfile?.providerId),
      providerKeyFingerprint: codexAppServerProviderKeyFingerprint(
        providerKey
      ),
      runtime,
      server,
      transportId: CODEX_APP_SERVER_PROVIDER_ID
    });
  }

  function attachCodexAppServerHelperThread({
    durable = null,
    ledger = null,
    onRetired = null,
    provider = null
  } = {}) {
    const key = codexAppServerHelperThreadKey(durable);
    const record = Object.freeze({
      ...durable,
      durable,
      ledger,
      onRetired,
      provider
    });
    codexAppServerHelperThreads.set(key, record);
    return record;
  }

  async function rememberCodexAppServerHelperThread({
    executionProfile = null,
    lifecycle = CODEX_HELPER_THREAD_LIFECYCLES.READY,
    onRetired = null,
    projectContextRoot = "",
    projectRuntimeRoot = "",
    provider = null,
    sessionId = "",
    threadId = "",
    turnId = "",
    workdir = ""
  } = {}) {
    if (
      !normalizeText(projectRuntimeRoot) ||
      !normalizeText(sessionId) ||
      !normalizeText(threadId) ||
      !provider
    ) {
      throw codexAppServerHelperThreadUnavailableError(threadId);
    }
    const now = new Date().toISOString();
    const durable = defineCodexHelperThreadRecord({
      createdAt: now,
      executionProfile: ledgerOwner.snapshotExecutionProfile(executionProfile),
      identity: await codexAppServerHelperThreadIdentity({ executionProfile, provider }),
      lifecycle,
      ownershipId: crypto.randomUUID(),
      projectContextRoot: normalizeText(projectContextRoot),
      projectRuntimeRoot: normalizeText(projectRuntimeRoot),
      revision: 1,
      schemaVersion: CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
      sessionId: normalizeText(sessionId),
      threadId: normalizeText(threadId),
      turnId: normalizeText(turnId),
      updatedAt: now,
      workdir: normalizeText(workdir)
    });
    const ledger = codexAppServerHelperThreadLedger(projectRuntimeRoot);
    await ledger.write(durable);
    return attachCodexAppServerHelperThread({ durable, ledger, onRetired, provider });
  }

  async function withCodexAppServerHelperThreadMutation(record = null, operation) {
    const key = codexAppServerHelperThreadKey(record);
    if (!record || typeof operation !== "function") {
      throw codexAppServerHelperThreadUnavailableError(record?.threadId);
    }
    const previous = codexAppServerHelperThreadMutations.get(key) || Promise.resolve();
    const mutation = previous.catch(() => null).then(operation);
    codexAppServerHelperThreadMutations.set(key, mutation);
    try {
      return await mutation;
    } finally {
      if (codexAppServerHelperThreadMutations.get(key) === mutation) {
        codexAppServerHelperThreadMutations.delete(key);
      }
    }
  }

  async function updateCodexAppServerHelperThreadUnlocked(record = null, {
    lifecycle = record?.lifecycle,
    onRetired = record?.onRetired,
    turnId = record?.turnId
  } = {}) {
    const key = codexAppServerHelperThreadKey(record);
    if (!record || codexAppServerHelperThreads.get(key) !== record) {
      throw codexAppServerHelperThreadUnavailableError(record?.threadId);
    }
    const durable = defineCodexHelperThreadRecord({
      ...record.durable,
      lifecycle,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
      turnId: normalizeText(turnId)
    });
    await record.ledger.write(durable, { expected: record.durable });
    return attachCodexAppServerHelperThread({
      durable,
      ledger: record.ledger,
      onRetired,
      provider: record.provider
    });
  }

  async function updateCodexAppServerHelperThread(record = null, changes = {}) {
    return withCodexAppServerHelperThreadMutation(record, () => (
      updateCodexAppServerHelperThreadUnlocked(record, changes)
    ));
  }

  function forgetCodexAppServerHelperThreadInMemory(record = null) {
    const key = codexAppServerHelperThreadKey(record);
    if (!record || codexAppServerHelperThreads.get(key) !== record) {
      return false;
    }
    codexAppServerHelperThreadCleanups.delete(key);
    codexAppServerHelperThreads.delete(key);
    record.onRetired?.({ threadId: record.threadId });
    return true;
  }

  async function removeCodexAppServerHelperThreadUnlocked(record = null) {
    const key = codexAppServerHelperThreadKey(record);
    if (!record || codexAppServerHelperThreads.get(key) !== record) {
      throw codexAppServerHelperThreadUnavailableError(record?.threadId);
    }
    await record.ledger.remove(record.durable);
    forgetCodexAppServerHelperThreadInMemory(record);
    return true;
  }

  async function removeCodexAppServerHelperThread(record = null) {
    return withCodexAppServerHelperThreadMutation(record, () => (
      removeCodexAppServerHelperThreadUnlocked(record)
    ));
  }

  function codexAppServerHelperThreadRecords({
    projectContextRoot = "",
    projectRuntimeRoot = "",
    provider = null,
    sessionId = ""
  } = {}) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    const normalizedProjectRuntimeRoot = normalizeText(projectRuntimeRoot);
    const normalizedSessionId = normalizeText(sessionId);
    return [...codexAppServerHelperThreads.values()].filter((record) => {
      return (!provider || record.provider === provider) &&
        (!normalizedSessionId || record.sessionId === normalizedSessionId) &&
        (!normalizedProjectContextRoot || record.projectContextRoot === normalizedProjectContextRoot) &&
        (!normalizedProjectRuntimeRoot || record.projectRuntimeRoot === normalizedProjectRuntimeRoot);
    });
  }

  function codexAppServerHelperThreadCleanupError(record = {}, error = null, interruptError = null) {
    const failure = new Error(
      `${applicationName} could not retire a low-cost assistant thread. Retry cleanup before shutting down its Codex provider.`
    );
    failure.code = `${errorPrefix}codex_helper_thread_cleanup_failed`;
    failure.statusCode = 503;
    failure.retryable = true;
    failure.details = {
      cleanupError: errorMessage(error, "Codex helper thread deletion failed."),
      ...(interruptError
        ? { interruptError: errorMessage(interruptError, "Codex helper turn interruption failed.") }
        : {}),
      retryable: true,
      sessionId: normalizeText(record.sessionId),
      threadId: normalizeText(record.threadId),
      turnId: normalizeText(record.turnId)
    };
    return failure;
  }

  async function retireCodexAppServerHelperThread(record = null) {
    const key = codexAppServerHelperThreadKey(record);
    const pendingTurnStart = codexAppServerHelperTurnStarts.get(key);
    if (pendingTurnStart) {
      await pendingTurnStart.catch(() => null);
    }
    const current = codexAppServerHelperThreads.get(key);
    if (!record || !current) {
      return {
        deleted: false,
        ok: true,
        status: "notOwned",
        threadId: normalizeText(record?.threadId)
      };
    }
    const pending = codexAppServerHelperThreadCleanups.get(key);
    if (pending) {
      return pending;
    }
    const cleanup = withCodexAppServerHelperThreadMutation(record, async () => {
      let cleanupRecord = codexAppServerHelperThreads.get(key);
      if (!cleanupRecord || cleanupRecord.ownershipId !== record.ownershipId) {
        return {
          deleted: false,
          ok: true,
          status: "notOwned",
          threadId: normalizeText(record.threadId)
        };
      }
      if (cleanupRecord.lifecycle !== CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED) {
        try {
          cleanupRecord = await updateCodexAppServerHelperThreadUnlocked(cleanupRecord, {
            lifecycle: CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED
          });
        } catch (error) {
          throw codexAppServerHelperThreadCleanupError(cleanupRecord, error);
        }
      }
      if (!await directoryExists(cleanupRecord.identity.runtime.runtimeDir)) {
        await removeCodexAppServerHelperThreadUnlocked(cleanupRecord);
        return {
          deleted: false,
          ok: true,
          status: "runtimeAbsent",
          threadId: cleanupRecord.threadId,
          turnId: cleanupRecord.turnId
        };
      }
      const { error, interruptError, ...result } = await deleteCodexAppServerHelperThread({
        provider: cleanupRecord.provider,
        threadId: cleanupRecord.threadId,
        turnId: cleanupRecord.turnId
      });
      if (result.ok === false) {
        throw codexAppServerHelperThreadCleanupError(cleanupRecord, error, interruptError);
      }
      try {
        await removeCodexAppServerHelperThreadUnlocked(cleanupRecord);
      } catch (ledgerError) {
        throw codexAppServerHelperThreadCleanupError(cleanupRecord, ledgerError, interruptError);
      }
      return result;
    });
    codexAppServerHelperThreadCleanups.set(key, cleanup);
    try {
      return await cleanup;
    } finally {
      if (codexAppServerHelperThreadCleanups.get(key) === cleanup) {
        codexAppServerHelperThreadCleanups.delete(key);
      }
    }
  }

  async function retireCodexAppServerHelperThreads(filters = {}) {
    const records = codexAppServerHelperThreadRecords(filters);
    const results = [];
    const failed = [];
    for (const record of records) {
      try {
        results.push(await retireCodexAppServerHelperThread(record));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: errorMessage(error),
          retryable: error?.retryable === true,
          sessionId: record.sessionId,
          threadId: record.threadId,
          turnId: record.turnId
        });
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      owned: records.length,
      results
    };
  }

  function assertCodexAppServerHelperThreadsRetired(result = {}) {
    if (result.ok !== false) {
      return result;
    }
    const failure = new Error(
      `${applicationName} could not retire every low-cost assistant thread. Retry cleanup before shutting down Codex.`
    );
    failure.code = `${errorPrefix}codex_helper_thread_cleanup_failed`;
    failure.statusCode = 503;
    failure.retryable = true;
    failure.details = {
      failed: result.failed,
      retryable: true
    };
    throw failure;
  }

  const codexAppServerHelperOwnershipError = createCodexHelperOwnershipError({ applicationName, errorPrefix });

  function codexAppServerRuntimeIdentityMatches(expected = {}, actual = {}, {
    requireAccount = true,
    requireEndpoint = true
  } = {}) {
    return (!requireAccount || expected.accountIdentitySignature === normalizeText(actual.accountIdentitySignature)) &&
      (!requireEndpoint || expected.endpoint === normalizeText(actual.endpoint)) &&
      expected.executionMode === normalizeText(actual.executionMode) &&
      expected.executionContextHash === normalizeText(actual.executionContextHash) &&
      expected.provider === normalizeText(actual.provider) &&
      expected.runtimeDir === normalizeText(actual.runtimeDir) &&
      expected.runtimesHash === normalizeText(actual.runtimesHash) &&
      expected.terminalEnvHash === normalizeText(actual.terminalEnvHash) &&
      expected.toolHomeSource === normalizeText(actual.toolHomeSource) &&
      expected.transport === normalizeText(actual.transport);
  }

  function codexAppServerHelperThreadOwnershipMatches(record = {}, {
    providerKey = "",
    runtime = {},
    server = null
  } = {}, options = {}) {
    return record.identity?.providerId === normalizeText(record.executionProfile?.providerId) &&
      record.identity?.providerKeyFingerprint === codexAppServerProviderKeyFingerprint(providerKey) &&
      record.identity?.transportId === CODEX_APP_SERVER_PROVIDER_ID &&
      codexAppServerRuntimeIdentityMatches(record.identity?.runtime, runtime, options) &&
      (
        options.requireServer !== true ||
        record.identity?.server?.userAgent === normalizeText(server?.userAgent)
      );
  }

  function codexAppServerHelperFailure(record = null, error = null) {
    return {
      code: normalizeText(error?.code) || `${errorPrefix}codex_helper_ownership_blocked`,
      error: errorMessage(error),
      projectRuntimeRoot: normalizeText(record?.projectRuntimeRoot),
      retryable: error?.retryable !== false,
      sessionId: normalizeText(record?.sessionId),
      threadId: normalizeText(record?.threadId)
    };
  }

  async function retireProvider(provider) {
    assertCodexAppServerHelperThreadsRetired(await retireCodexAppServerHelperThreads({ provider }));
  }
  async function reconcileProviderRetirement({ provider, retired, stopped }) {
    let pendingThreadCleanup = [];
    if (
      retired.status === "rejected" &&
      stopped.status === "fulfilled" &&
      stopped.value?.runtimeDirRemoved === true
    ) {
      // Stopping the isolated runtime can win the race with thread/delete.
      // Reconcile its now-absent storage without reconnecting to the old account.
      [retired] = await Promise.allSettled([
        retireCodexAppServerHelperThreads({ provider }).then(assertCodexAppServerHelperThreadsRetired)
      ]);
    }
    if (
      retired.status === "rejected" &&
      stopped.status === "fulfilled" &&
      stopped.value?.processExitVerified === true &&
      stopped.value?.runtimeDirPreserved === true
    ) {
      const pending = codexAppServerHelperThreadRecords({ provider });
      if (pending.every((thread) => thread.lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED)) {
        // Shared history survives process shutdown. Keep its durable cleanup
        // records for the next connection, without retaining the stopped client
        // as an account-transition blocker or claiming its history was deleted.
        pendingThreadCleanup = retired.reason.details?.failed || [];
        for (const thread of pending) {
          codexAppServerHelperThreads.delete(codexAppServerHelperThreadKey(thread));
        }
        retired = { status: "fulfilled" };
      }
    }
    return { retired, pendingThreadCleanup };
  }
  function assertProviderReleased(provider) {
    if (codexAppServerHelperThreadRecords({ provider }).length > 0) {
      throw new Error(
        "Codex provider cannot close while it still owns low-cost assistant threads."
      );
    }
  }

  function assertCodexAppServerHelperThreadsRestored(result = {}) {
    if (result.ok !== false) {
      return result;
    }
    throw codexAppServerHelperOwnershipError(
      `${applicationName} could not reconcile persisted low-cost assistant thread ownership.`,
      {
        failed: result.failed,
        retryable: result.failed?.some((failure) => failure.retryable !== false) !== false,
        projectRuntimeRoot: normalizeText(result.projectRuntimeRoot)
      }
    );
  }

  async function assertCodexAppServerOrdinaryThreadAvailable(projectRuntimeRoot, threadId) {
    const ledger = codexAppServerHelperThreadLedger(projectRuntimeRoot);
    const { records } = await ledger.readAll();
    if (records.some((record) => record.threadId === threadId)) {
      throw codexAppServerHelperThreadUnavailableError(threadId);
    }
  }

  const lifecycle = {
    threads: codexAppServerHelperThreads,
    projectOperations: codexAppServerHelperProjectOperations,
    cleanups: codexAppServerHelperThreadCleanups,
    mutations: codexAppServerHelperThreadMutations,
    turnStarts: codexAppServerHelperTurnStarts,
    restores: codexAppServerHelperThreadRestores,
    key: codexAppServerHelperThreadKey,
    withProjectOperation: withCodexAppServerHelperProjectOperation,
    unavailableError: codexAppServerHelperThreadUnavailableError,
    threadForOperation: codexAppServerHelperThreadForOperation,
    inspectControl: inspectCodexAppServerHelperControl,
    ledger: codexAppServerHelperThreadLedger,
    providerFingerprint: codexAppServerProviderKeyFingerprint,
    attach: attachCodexAppServerHelperThread,
    remember: rememberCodexAppServerHelperThread,
    update: updateCodexAppServerHelperThread,
    remove: removeCodexAppServerHelperThread,
    records: codexAppServerHelperThreadRecords,
    cleanupError: codexAppServerHelperThreadCleanupError,
    retire: retireCodexAppServerHelperThread,
    retireAll: retireCodexAppServerHelperThreads,
    assertRetired: assertCodexAppServerHelperThreadsRetired,
    assertRestored: assertCodexAppServerHelperThreadsRestored,
    assertOrdinaryThreadAvailable: assertCodexAppServerOrdinaryThreadAvailable,
    ownershipError: codexAppServerHelperOwnershipError,
    ownershipMatches: codexAppServerHelperThreadOwnershipMatches,
    failure: codexAppServerHelperFailure
  };
  Object.assign(lifecycle, createCodexHelperThreadRecovery(lifecycle, {
    providerOwner, applicationName, errorPrefix
  }), {
    prepareDetached: (scope, preparation) => prepareDetachedCodexHelperThread(
      lifecycle, scope, preparation, { applicationName }
    ),
    retireProvider,
    reconcileProviderRetirement,
    assertProviderReleased
  });
  return Object.freeze(lifecycle);
}
