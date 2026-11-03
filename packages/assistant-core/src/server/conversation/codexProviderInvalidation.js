import {
  codexAppServerOwnedRuntimeKey,
  codexAppServerOwnedRuntimes,
  codexAppServerRuntimeStopWasVerified,
  codexAppServerStaleRuntimes,
  nativeRequest,
  providerRecords,
  runningNativeThreads,
  withRuntimeLifecycle
} from "./codexRuntimeInventory.js";
import { normalizeCodexRunText as normalizeText } from "./codexTurnState.js";

/**
 * Retires the native runtimes an account change or a lost observation leaves untrusted.
 * @param {object} dependencies
 * @param {(record: object) => boolean} dependencies.inScope
 * @param {<T>(operation: () => T, providerKey?: string, providerOptions?: object | null) => Promise<Awaited<T>>} dependencies.withLifecycle
 * @param {() => void} dependencies.forgetModelCatalog
 * @param {string} dependencies.exitUnverifiedCode
 * @param {(event: string, details: object) => void} dependencies.debugLog
 * @param {(error: unknown) => unknown} dependencies.debugError
 */
export function createCodexProviderInvalidation({ inScope, withLifecycle, forgetModelCatalog, exitUnverifiedCode, debugLog, debugError }) {
  async function invalidateProviderThreads(modelProviderId, includeOwned, toolHomeSource) {
    const groups = new Map();
    const inventory = [...providerRecords()];
    if (includeOwned) for (const record of codexAppServerOwnedRuntimes.values()) {
      if (!inventory.some(candidate => candidate.provider === record.provider)) inventory.push(record);
    }
    for (const record of inventory) {
      if (!inScope(record)) continue;
      const key = codexAppServerOwnedRuntimeKey(record.providerKey, record.providerOptions);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    const results = [], failed = [];
    for (const [runtimeKey, peers] of groups) {
      try {
        await withRuntimeLifecycle(runtimeKey, async () => {
          const available = peers.filter(record => record.provider.client?.isOpen());
          if (!available.length) {
            if (peers.some(record => record.provider.runtime || record.provider.runtimeStopOwner ||
                codexAppServerOwnedRuntimes.get(runtimeKey)?.provider === record.provider)) {
              throw new Error("Codex's existing control connection is unavailable. Restore it before changing this provider connection.");
            }
            return;
          }
          const request = (record, method, params) => {
            const client = record.provider.client;
            if (!client?.isOpen()) throw new Error("Codex's control connection closed during provider retirement. Restore it and retry.");
            return client.request(method, params, { signal: AbortSignal.timeout(5_000) });
          };
          const selectedHome = normalizeText(toolHomeSource);
          const dedicated = Boolean(selectedHome && peers.some(record =>
            normalizeText(record.providerOptions.toolHomeSource) === selectedHome));
          if (dedicated && peers.some(record => normalizeText(record.providerOptions.toolHomeSource) !== selectedHome)) {
            throw new Error("Codex's provider credential home has other native consumers. Close its native terminal/helper and retry; unrelated runtimes remain running.");
          }
          const inspector = available[0], candidates = new Set(), seen = new Set();
          let cursor;
          do {
            const page = await request(inspector, "thread/loaded/list", { limit: 100, ...(cursor ? { cursor } : {}) });
            if (!Array.isArray(page?.data)) throw new Error("Codex returned an invalid loaded-thread inventory. Restore its connection before retrying.");
            for (const id of page.data) {
              if (typeof id !== "string" || !id) throw new Error("Codex returned an invalid loaded-thread identity.");
              candidates.add(id);
            }
            cursor = page.nextCursor;
            if (cursor && (typeof cursor !== "string" || seen.has(cursor) || seen.size >= 100)) throw new Error("Codex's loaded-thread inventory did not finish.");
            if (cursor) seen.add(cursor);
          } while (cursor);
          for (const { provider } of peers) for (const [id, binding] of provider.threadEnvironments || []) {
            if (dedicated || binding.params?.modelProvider === modelProviderId) candidates.add(id);
          }
          const threadIds = [];
          for (const id of candidates) {
            const { thread } = await request(inspector, "thread/read", { threadId: id, includeTurns: false });
            if (!thread || thread.id !== id || typeof thread.modelProvider !== "string" || !thread.modelProvider ||
                !(typeof thread.status === "string" ? thread.status : thread.status?.type)) {
              throw new Error("Codex returned an untrustworthy thread/provider inventory. Restore its connection before changing credentials.");
            }
            if (dedicated && thread.modelProvider !== modelProviderId) {
              throw new Error("Codex's provider credential home retains another provider thread. Close its native terminal/helper and retry; unrelated threads remain running.");
            }
            if (thread.modelProvider === modelProviderId) threadIds.push(id);
          }
          if (!threadIds.length && !dedicated) return;
          const error = Object.assign(new Error("This Codex provider connection changed. Work is stopped; use Send or Resume after reconnecting."), {
            code: "codex_provider_connection_changed"
          });
          for (const { provider } of peers) for (const threadId of threadIds) provider.conversationRuntime?.invalidateThread(threadId);
          await Promise.allSettled(peers.flatMap(({ provider }) => threadIds
            .map(id => provider.threadEnvironmentTasks?.get(id)).filter(Boolean)));
          // The same observation journal retains selected stop ownership. Peers
          // with other threads must keep their admission and active work intact.
          for (const record of available) await record.observation?.prepare({ provider: record.provider, error, threadIds });
          for (const threadId of threadIds) {
            await inspector.provider.stopThreadForObservationLoss(threadId);
            for (const record of available) {
              const detached = await request(record, "thread/unsubscribe", { threadId });
              if (!["unsubscribed", "notSubscribed", "notLoaded"].includes(detached?.status)) throw new Error("Codex did not confirm selected-thread detachment.");
            }
            const { thread } = await request(inspector, "thread/read", { threadId, includeTurns: false });
            if ((typeof thread?.status === "string" ? thread.status : thread?.status?.type) !== "notLoaded") {
              throw new Error("Close the native Codex terminal using this provider, then retry changing its connection. Another subscriber retained the selected thread; the shared server and other conversations remain running.");
            }
          }
          if (dedicated) {
            // A curated default also lives in this exact isolated helper's
            // native config cache. Reuse verified retirement only after proving
            // every loaded/cached thread belongs to the selected provider.
            const owned = codexAppServerOwnedRuntimes.get(runtimeKey);
            if (!owned || !peers.some(record => record.provider === owned.provider)) {
              throw new Error("Codex's dedicated provider runtime ownership cannot be verified. Restore its control connection and retry.");
            }
            await owned.scope.stopOwnedRuntime(owned, { cached: false, preserveProcessExitProof: true, requireVerifiedExit: true });
          }
          for (const record of available) await record.observation?.complete({ provider: record.provider, error, threadIds, sharedStop: dedicated });
          if (dedicated) for (const record of peers) record.scope.closeProvider(record.providerKey);
          results.push({ runtimeKey, threadIds, stopped: true, sharedProcessRetained: !dedicated,
            ...(dedicated ? { dedicatedRuntimeRetired: true } : {}) });
        });
      } catch (error) {
        failed.push({ runtimeKey, error: error.message, retryable: true });
      }
    }
    return { ok: failed.length === 0, failed, results, providerCount: results.length, stopped: results.reduce((sum, result) => sum + result.threadIds.length, 0) };
  }

  // A runtime with a running turn keeps the credentials it started with until
  // that turn ends. Its active goals are paused so it starts no further turn;
  // retireStaleRuntime stops it once it is idle. Any other runtime returns
  // null and stops at once, like an idle one.
  async function deferBusyRuntime(runtimeKey, peers) {
    let running;
    try {
      running = await runningNativeThreads(peers);
    } catch (error) {
      // An unreadable runtime cannot show a running turn.
      debugLog("appServerRuntime.staleInspection.error", { error: debugError(error), runtimeKey });
      return null;
    }
    // Nor can one whose control connection closed while it was read.
    const client = peers.find(record => record.provider.client?.isOpen())?.provider.client;
    if (!running.length || !client) return null;
    const pausedGoals = [];
    for (const threadId of running) {
      try {
        const { goal } = await nativeRequest(client, "thread/goal/get", { threadId });
        if (goal?.status !== "active") continue;
        const result = await nativeRequest(client, "thread/goal/set", { threadId, status: "paused" });
        if (result?.goal?.status !== "paused") throw new Error("Codex did not confirm that the goal was paused.");
        pausedGoals.push(threadId);
      } catch (error) {
        debugLog("appServerRuntime.staleGoalPause.error", { error: debugError(error), runtimeKey, threadId });
      }
    }
    for (const peer of peers) peer.provider.markStale();
    const stale = {
      runtimeKey, threadIds: running, pausedGoals, retiring: null,
      providerKeys: peers.map(peer => peer.providerKey)
    };
    codexAppServerStaleRuntimes.set(runtimeKey, stale);
    return stale;
  }

  async function invalidateRuntimes({
    deferBusy = false,
    includeOwned = false,
    requireVerifiedExit = false,
    stopOwnedRuntimes = false,
    toolHomeSource = "",
    modelProviderId = ""
  } = {}) {
    if (modelProviderId) return withLifecycle(() => invalidateProviderThreads(modelProviderId, includeOwned, toolHomeSource));
    forgetModelCatalog();
    const normalizedToolHomeSource = normalizeText(toolHomeSource);
    const ownedRecordsByProvider = new Map(
      [...codexAppServerOwnedRuntimes.values()].filter(inScope).map((record) => [record.provider, record])
    );
    const targets = [...providerRecords()]
      .filter(record => inScope(record) && (!normalizedToolHomeSource ||
        normalizeText(record.providerOptions.toolHomeSource) === normalizedToolHomeSource))
      .map(record => ({
        ...record,
        kind: "cached",
        record: ownedRecordsByProvider.get(record.provider) || null
      }));
    const targetedProviders = new Set(targets.map((target) => target.provider));
    if (includeOwned) {
      for (const record of codexAppServerOwnedRuntimes.values()) {
        if (!inScope(record) || targetedProviders.has(record.provider)) {
          continue;
        }
        const recordToolHomeSource = normalizeText(
          record.providerOptions?.toolHomeSource
        );
        if (
          normalizedToolHomeSource &&
          recordToolHomeSource !== normalizedToolHomeSource
        ) {
          continue;
        }
        targets.push({
          ...record,
          kind: "owned",
          provider: record.provider,
          providerKey: record.providerKey,
          record
        });
        targetedProviders.add(record.provider);
      }
    }
    targets.sort((left, right) => Number(Boolean(left.record)) - Number(Boolean(right.record)));
    const failed = [];
    const results = [];
    const deferred = [];
    if (deferBusy) {
      const groups = new Map();
      for (const target of targets) {
        const runtimeKey = codexAppServerOwnedRuntimeKey(target.providerKey, target.providerOptions);
        if (!groups.has(runtimeKey)) groups.set(runtimeKey, []);
        groups.get(runtimeKey).push(target);
      }
      for (const [runtimeKey, peers] of groups) {
        if (codexAppServerStaleRuntimes.has(runtimeKey)) {
          deferred.push(codexAppServerStaleRuntimes.get(runtimeKey));
        } else {
          const stale = await withRuntimeLifecycle(runtimeKey, () => deferBusyRuntime(runtimeKey, peers));
          if (!stale) continue;
          deferred.push(stale);
        }
        for (const peer of peers) {
          targets.splice(targets.indexOf(peer), 1);
          results.push({ providerKey: peer.providerKey, deferred: true, stopped: false });
        }
      }
    }
    for (const target of targets) {
      if (!target.resources?.invalidation) continue;
      const error = Object.assign(new Error("Codex's native runtime was invalidated."), {
        code: "codex_runtime_invalidated"
      });
      target.invalidation = { error };
      try {
        if (await target.resources.invalidation.prepare({ provider: target.provider, error }) === false) {
          delete target.invalidation;
        }
      } catch (preparationError) {
        target.invalidation.preparationError = preparationError;
      }
    }
    for (const target of targets) {
      const preserveProcessExitProof = target.preserveProcessExitProof === true;
      try {
        const result = stopOwnedRuntimes && target.record
          ? await target.scope.stopOwnedRuntime({
              ...(target.record || {}),
              provider: target.provider,
              providerKey: target.providerKey
            }, {
              cached: target.kind === "cached",
              preserveProcessExitProof,
              requireVerifiedExit
            })
          : await target.scope.stopCachedProvider(target.providerKey, {
              preserveProcessExitProof,
              requireStopped: stopOwnedRuntimes && target.record != null
            });
        if (
          requireVerifiedExit &&
          target.record &&
          !codexAppServerRuntimeStopWasVerified(result)
        ) {
          throw Object.assign(new Error("Codex app-server process exit could not be verified."), {
            code: exitUnverifiedCode, providerKey: target.providerKey, retryable: true
          });
        }
        target.stopResult = result;
        results.push(result);
      } catch (error) {
        target.stopError = error;
        failed.push({
          code: normalizeText(error?.code),
          error: String(error?.message || "Codex app-server runtime invalidation failed."),
          providerKey: target.providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    for (const target of targets) {
      if (!target.invalidation) continue;
      const runtimeKey = codexAppServerOwnedRuntimeKey(target.providerKey, target.providerOptions);
      const peers = targets.filter(peer =>
        codexAppServerOwnedRuntimeKey(peer.providerKey, peer.providerOptions) === runtimeKey);
      const proof = peers.find(peer => codexAppServerRuntimeStopWasVerified(peer.stopResult));
      const stopped = proof
        ? { status: "fulfilled", value: proof.stopResult }
        : { status: "rejected", reason: peers.find(peer => peer.stopError)?.stopError ||
          Object.assign(new Error("Codex app-server process exit could not be verified."), {
            code: exitUnverifiedCode, providerKey: target.providerKey, retryable: true
          }) };
      try {
        await target.resources.invalidation.complete({
          provider: target.provider, ...target.invalidation, stopped
        });
        if (target.invalidation.preparationError) throw target.invalidation.preparationError;
        if (stopped.status === "rejected") throw stopped.reason;
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: String(error?.message || "Codex app-server invalidation could not be recorded."),
          providerKey: target.providerKey,
          retryable: true
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    return {
      deferred: deferred.map(({ runtimeKey, providerKeys, threadIds, pausedGoals }) =>
        ({ runtimeKey, providerKeys: [...providerKeys], threadIds: [...threadIds], pausedGoals: [...pausedGoals] })),
      failed,
      ok: failed.length === 0,
      providerCount: targets.length + deferred.reduce((sum, stale) => sum + stale.providerKeys.length, 0),
      results,
      stopped
    };
  }

  async function suspendUnobservedProvider(record, error) {
    const targets = [record];
    let sharedStop = false;
    try {
      const threads = await record.observation.prepare({ provider: record.provider, error });
      if (!threads.size) throw new Error("The unobserved Codex thread could not be identified.");
      for (const [threadId, turnId] of threads) {
        await record.provider.stopThreadForObservationLoss(threadId, turnId);
      }
    } catch {
      sharedStop = true;
      const runtimeKey = codexAppServerOwnedRuntimeKey(record.providerKey, record.providerOptions);
      for (const peer of providerRecords()) {
        if (peer !== record && codexAppServerOwnedRuntimeKey(peer.providerKey, peer.providerOptions) === runtimeKey) {
          peer.provider.observationFailure = error;
          targets.push(peer);
        }
      }
      // Preserve the original ordering and failure policy: attempt every durable
      // barrier before native stop; a storage failure cannot leave work running.
      for (const target of targets) {
        try {
          await target.observation.barrier({ provider: target.provider, error });
        } catch (failure) {
          target.scope.reportRecoveryEvent(target, "persistenceFailed", failure);
        }
      }
      const owned = codexAppServerOwnedRuntimes.get(runtimeKey) || record;
      await owned.scope.stopOwnedRuntime(owned, { preserveProcessExitProof: true, requireVerifiedExit: true });
    }
    for (const target of targets) {
      // Each adapter retains its original persistence/publication order. It can
      // release this provider only after its stopped state is durable.
      await target.observation.complete({ provider: target.provider, error, sharedStop });
    }
  }

  return Object.freeze({
    invalidateRuntimes,
    suspendUnobservedProvider
  });
}
