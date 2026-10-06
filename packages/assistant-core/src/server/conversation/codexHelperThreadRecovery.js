import { stat } from "node:fs/promises";
import { deleteCodexAppServerThread, codexAppServerRuntimeStopWasVerified } from "./codexProvider.js";
import { CODEX_HELPER_THREAD_LIFECYCLES } from "./codexHelperThreadLedger.js";

export function normalizeText(value) {
  return String(value || "").trim();
}

export async function directoryExists(filePath = "") {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

// Recovery operations of the same Helper lifecycle. All maps and record mutations
// belong to the supplied lifecycle; this module creates no owner or registry.
export function createCodexHelperThreadRecovery(lifecycle, {
  providerOwner,
  applicationName,
  errorPrefix
}) {
  const codexAppServerProviders = providerOwner.providers;
  const {
    threads: codexAppServerHelperThreads,
    mutations: codexAppServerHelperThreadMutations,
    restores: codexAppServerHelperThreadRestores,
    key: codexAppServerHelperThreadKey,
    ledger: codexAppServerHelperThreadLedger,
    providerFingerprint: codexAppServerProviderKeyFingerprint,
    attach: attachCodexAppServerHelperThread,
    remove: removeCodexAppServerHelperThread,
    retire: retireCodexAppServerHelperThread,
    ownershipError: codexAppServerHelperOwnershipError,
    ownershipMatches: codexAppServerHelperThreadOwnershipMatches,
    failure: codexAppServerHelperFailure
  } = lifecycle;

  async function restoreCodexAppServerHelperThread(record = {}, context = {}) {
    const { ledger = null } = context;
    const key = codexAppServerHelperThreadKey(record);
    const pendingMutation = codexAppServerHelperThreadMutations.get(key);
    if (pendingMutation) {
      await pendingMutation.catch(() => null);
    }
    const existing = codexAppServerHelperThreads.get(key);
    if (existing && (
      existing.ownershipId !== record.ownershipId ||
      existing.revision < record.revision
    )) {
      throw codexAppServerHelperOwnershipError(
        "Persisted Codex helper ownership changed while the controller was running.",
        { sessionId: record.sessionId, threadId: record.threadId }
      );
    }
    const cleanupRequired = record.lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.CLEANUP_REQUIRED;
    if (existing && !cleanupRequired) {
      if (!context.retiring) {
        return { record: existing, retiredThreadId: "" };
      }
      await retireCodexAppServerHelperThread(existing);
      return { record: null, retiredThreadId: existing.threadId };
    }
    if (!await directoryExists(record.identity.runtime.runtimeDir)) {
      if (existing) {
        await retireCodexAppServerHelperThread(existing);
      } else {
        await ledger.remove(record);
      }
      return { record: null, retiredThreadId: record.threadId };
    }
    const prepared = await context.prepareProvider();
    const { providerOptions, providerKey } = prepared;
    const contextChanged = !existing &&
      codexAppServerProviderKeyFingerprint(providerKey) !== record.identity.providerKeyFingerprint;
    if (contextChanged) {
      const staleProvider = providerOwner.createNativeProvider({
        ...providerOptions,
        runtimeDir: record.identity.runtime.runtimeDir
      });
      try {
        const currentRuntime = await staleProvider.currentRuntimeInfo();
        const accountChanged = record.identity.runtime.accountIdentitySignature !==
          normalizeText(currentRuntime.accountIdentitySignature);
        if (accountChanged && !cleanupRequired) {
          throw codexAppServerHelperOwnershipError(
            "Reconnect the original Codex account to resume or delete this helper thread.",
            { retryable: false, sessionId: record.sessionId, threadId: record.threadId }
          );
        }
        if (accountChanged || contextChanged) {
          // Context drift cannot reuse the previous provider configuration.
          const stopped = await staleProvider.stopRuntime(accountChanged ? {
            expectedAccountIdentitySignature: record.identity.runtime.accountIdentitySignature
          } : {});
          const retired = accountChanged
            ? stopped?.ownershipSuperseded === true || stopped?.processExitVerified === true
            : codexAppServerRuntimeStopWasVerified(stopped);
          if (!retired) {
            throw codexAppServerHelperOwnershipError(
              "The earlier Codex runtime could not be verified as retired; its cleanup record has been preserved.",
              { sessionId: record.sessionId, threadId: record.threadId }
            );
          }
          await ledger.remove(record);
          codexAppServerHelperThreads.delete(key);
          return { record: null, retiredThreadId: record.threadId };
        }
      } finally {
        staleProvider.close?.();
      }
    }
    if (existing) {
      await retireCodexAppServerHelperThread(existing);
      return { record: null, retiredThreadId: existing.threadId };
    }
    let provider = codexAppServerProviders.get(providerKey);
    if (!provider) {
      const policy = prepared.restoreProvider;
      provider = providerOwner.createProvider({
        providerKey, providerOptions,
        ...policy,
        create: (onObservationLost) => providerOwner.createNativeProvider({ ...providerOptions, onObservationLost })
      });
    }
    if (typeof provider.currentRuntimeInfo !== "function") {
      throw codexAppServerHelperOwnershipError(
        "The Codex provider cannot prove persisted runtime ownership.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const expectedRuntime = await provider.currentRuntimeInfo();
    if (!codexAppServerHelperThreadOwnershipMatches(record, {
      providerKey,
      runtime: expectedRuntime
    }, {
      // Cleanup deletes locally owned history; it never resumes account-bound work.
      requireAccount: !cleanupRequired,
      requireEndpoint: false
    })) {
      throw codexAppServerHelperOwnershipError(
        "The current Codex runtime/auth identity does not match persisted helper ownership.",
        {
          retryable: record.identity.runtime.accountIdentitySignature === normalizeText(expectedRuntime.accountIdentitySignature),
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    await providerOwner.acquireRuntime({
      operation: () => provider.ensureAvailable?.(),
      provider,
      providerKey,
      providerOptions
    });
    const currentRuntime = await provider.currentRuntimeInfo();
    const currentServer = provider.currentServerInfo?.();
    if (!codexAppServerHelperThreadOwnershipMatches(record, {
      providerKey,
      runtime: currentRuntime,
      server: currentServer
    }, {
      requireAccount: !cleanupRequired,
      requireEndpoint: true,
      requireServer: !cleanupRequired
    })) {
      throw codexAppServerHelperOwnershipError(
        "The connected Codex server identity does not match persisted helper ownership.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const currentLedger = await ledger.readAll();
    if (currentLedger.failures.length > 0) {
      throw codexAppServerHelperOwnershipError(
        "Persisted Codex helper ownership could not be revalidated before restore.",
        {
          failed: currentLedger.failures,
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const currentDurable = currentLedger.records.find((candidate) => (
      codexAppServerHelperThreadKey(candidate) === key
    ));
    if (!currentDurable) {
      return { record: null, retiredThreadId: record.threadId };
    }
    if (
      currentDurable.ownershipId !== record.ownershipId ||
      currentDurable.revision !== record.revision
    ) {
      throw codexAppServerHelperOwnershipError(
        "Persisted Codex helper ownership changed before it could be restored.",
        {
          sessionId: record.sessionId,
          threadId: record.threadId
        }
      );
    }
    const attached = attachCodexAppServerHelperThread({
      durable: currentDurable,
      ledger,
      provider
    });
    if (
      attached.lifecycle !== CODEX_HELPER_THREAD_LIFECYCLES.READY ||
      context.retiring
    ) {
      await retireCodexAppServerHelperThread(attached);
      return { record: null, retiredThreadId: attached.threadId };
    }
    return { record: attached, retiredThreadId: "" };
  }

  async function restoreCodexAppServerHelperThreads(projectRuntimeRoot = "", context = {}) {
    const previous = codexAppServerHelperThreadRestores.get(projectRuntimeRoot) || Promise.resolve();
    const restore = previous.catch(() => null).then(async () => {
      const ledger = codexAppServerHelperThreadLedger(projectRuntimeRoot);
      const listed = await ledger.readAll();
      const failed = listed.failures.map((failure) => ({
        ...failure,
        projectRuntimeRoot
      }));
      const normalizedSessionId = normalizeText(context.sessionId);
      const records = listed.records.filter((record) => {
        return !normalizedSessionId || record.sessionId === normalizedSessionId;
      });
      const retiredThreadIds = [];
      const retiredBySession = new Map();
      for (const record of records) {
        try {
          const prepared = await context.prepareRecord(record, ledger);
          const restored = await restoreCodexAppServerHelperThread(record, prepared);
          if (normalizeText(restored?.retiredThreadId)) {
            retiredThreadIds.push(normalizeText(restored.retiredThreadId));
            const retired = retiredBySession.get(record.sessionId) || [];
            retired.push(normalizeText(restored.retiredThreadId));
            retiredBySession.set(record.sessionId, retired);
          }
        } catch (error) {
          failed.push(codexAppServerHelperFailure(record, error));
        }
      }
      await context.publish({ records, failed, retiredBySession, normalizedSessionId });
      return {
        failed,
        ok: failed.length === 0,
        projectRuntimeRoot,
        recordCount: records.length,
        retiredThreadIds: [...new Set(retiredThreadIds)]
      };
    });
    codexAppServerHelperThreadRestores.set(projectRuntimeRoot, restore);
    try {
      return await restore;
    } finally {
      if (codexAppServerHelperThreadRestores.get(projectRuntimeRoot) === restore) {
        codexAppServerHelperThreadRestores.delete(projectRuntimeRoot);
      }
    }
  }

  async function reconcileCodexAppServerHelperRuntimeUnlocked({
    sessionId = "",
    projectRuntimeRoot = "",
    prepareProvider
  } = {}) {
    const ledger = codexAppServerHelperThreadLedger(projectRuntimeRoot);
    const listed = await ledger.readAll();
    if (listed.failures.length > 0) {
      throw codexAppServerHelperOwnershipError(
        `${applicationName} cannot inventory helper threads while durable ownership is malformed.`,
        { failed: listed.failures, sessionId }
      );
    }
    const ownedRecords = listed.records.filter((record) => record.sessionId === sessionId);
    const remainingOwnedThreadIds = new Set(
      ownedRecords.map((record) => record.threadId)
    );
    const retireOwnedReadyThreadsMissingFrom = async (inventoryThreadIds) => {
      const retiredThreadIds = [];
      for (const durable of ownedRecords) {
        if (
          durable.lifecycle !== CODEX_HELPER_THREAD_LIFECYCLES.READY ||
          inventoryThreadIds.has(durable.threadId)
        ) {
          continue;
        }
        const record = codexAppServerHelperThreads.get(
          codexAppServerHelperThreadKey(durable)
        );
        if (!record || record.ownershipId !== durable.ownershipId) {
          throw codexAppServerHelperOwnershipError(
            `${applicationName} cannot retire missing helper ownership without its verified controller record.`,
            { sessionId, threadId: durable.threadId }
          );
        }
        if (
          record.lifecycle !== CODEX_HELPER_THREAD_LIFECYCLES.READY ||
          record.revision !== durable.revision
        ) {
          continue;
        }
        try {
          await removeCodexAppServerHelperThread(record);
        } catch (error) {
          if (error?.code === `${errorPrefix}codex_helper_thread_unavailable`) {
            continue;
          }
          throw error;
        }
        remainingOwnedThreadIds.delete(durable.threadId);
        retiredThreadIds.push(durable.threadId);
      }
      return retiredThreadIds;
    };
    const prepared = await prepareProvider();
    const { providerOptions, providerKey } = prepared;
    let provider = codexAppServerProviders.get(providerKey);
    if (
      ownedRecords.length === 0 &&
      !provider &&
      !await directoryExists(providerOptions.runtimeDir)
    ) {
      const retiredMissingThreadIds = await retireOwnedReadyThreadsMissingFrom(new Set());
      return {
        deletedThreadIds: [],
        ok: true,
        ownedThreadIds: [...remainingOwnedThreadIds],
        providerKey,
        retiredMissingThreadIds,
        status: "runtimeAbsent"
      };
    }
    provider ||= await providerOwner.ensureSession(prepared.sessionContext);
    if (typeof provider.listHelperThreads !== "function") {
      throw codexAppServerHelperOwnershipError(
        "The Codex helper provider cannot authoritatively inventory its threads.",
        { sessionId }
      );
    }
    const inventory = await provider.listHelperThreads();
    if (!Array.isArray(inventory?.threadIds)) {
      throw codexAppServerHelperOwnershipError(
        "The Codex helper provider returned an invalid thread inventory.",
        { sessionId }
      );
    }
    const inventoryThreadIds = new Set(inventory.threadIds.map(normalizeText).filter(Boolean));
    const unknownThreadIds = inventory.threadIds.filter((threadId) => {
      return normalizeText(threadId) && !remainingOwnedThreadIds.has(normalizeText(threadId));
    });
    const deletedThreadIds = [];
    for (const threadId of unknownThreadIds) {
      try {
        await deleteCodexAppServerThread({ provider, threadId });
      } catch (error) {
        if (error?.code !== "codex_helper_thread_delete_unconfirmed") throw error;
        throw codexAppServerHelperOwnershipError(
          "Codex did not confirm deletion of an unowned helper thread.",
          { sessionId, threadId }
        );
      }
      deletedThreadIds.push(threadId);
    }
    const retiredMissingThreadIds = await retireOwnedReadyThreadsMissingFrom(
      inventoryThreadIds
    );
    return {
      deletedThreadIds,
      ok: true,
      ownedThreadIds: [...remainingOwnedThreadIds],
      providerKey,
      retiredMissingThreadIds,
      status: "reconciled"
    };
  }

  return {
    restoreThread: restoreCodexAppServerHelperThread,
    restoreThreads: restoreCodexAppServerHelperThreads,
    reconcileRuntimeUnlocked: reconcileCodexAppServerHelperRuntimeUnlocked
  };
}
