import path from "node:path";
import { stat } from "node:fs/promises";
import { CodexAppServerAgentProvider } from "./codexProvider.js";
import { codexAppServerProjectHookTrustConfig } from "./codexConfiguration.js";

// Moved from Vibe64's codexTerminal provider owner. Caller-local provider keys
// are grouped without duplicating the inventory. Recovery and sharing always
// inspect the complete inventory by native runtime identity.
const codexAppServerProviders = new Map();
const codexAppServerOwnedRuntimes = new Map();
let codexAppServerProviderLifecycle = Promise.resolve();
const normalizeText = value => String(value || "").trim();

export function codexAppServerOwnedRuntimeKey(providerKey = "", providerOptions = {}) {
  const runtimeDir = normalizeText(providerOptions?.runtimeDir);
  return runtimeDir
    ? `runtime:${path.resolve(runtimeDir)}`
    : `provider:${normalizeText(providerKey)}`;
}

export function codexAppServerRuntimeStopWasVerified(result = {}) {
  return result?.stopped === true ||
    result?.processExitVerified === true ||
    result?.runtimeDirRemoved === true;
}

async function directoryExists(filePath = "") {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function* providerRecords() {
  for (const records of codexAppServerProviders.values()) yield* records.values();
}

/** Internal consumer view of the one native provider owner, not a server per view. */
export function createCodexAppServerProviderOwner({
  runtimeRoot = "",
  assertOpen: assertApplicationOpen = () => {},
  onRecoveryEvent = () => {},
  debugLog = () => {},
  debugError = error => error,
  providerFactory = null,
  prepareNativeHost = () => ({}),
  runtimeBusyCode = "codex_app_server_runtime_busy",
  exitUnverifiedCode = "codex_runtime_exit_unverified",
  requiredStopCode = "codex_runtime_exit_unverified",
  runtimeCloseError = "Codex app-server runtime close failed."
} = {}) {
  const scopeRoot = normalizeText(runtimeRoot) ? path.resolve(runtimeRoot) : "";
  const records = new Map();
  const lifecycleTasks = new Set();
  const runtimeAcquisitions = new Set();
  let closing = false;
  let runtimeLifecycle = null;
  let codexAppServerChatModelCatalog = null;

  const providers = {
    get: key => records.get(key)?.provider,
    keys: () => records.keys(),
    *entries() {
      for (const [key, record] of records) yield [key, record.provider];
    },
    [Symbol.iterator]() { return this.entries(); }
  };
  const providerOwners = { get: key => records.get(key)?.owner };
  const ownedRuntimes = {
    get: key => codexAppServerOwnedRuntimes.get(key),
    *values() {
      for (const record of codexAppServerOwnedRuntimes.values()) {
        if (inScope(record)) yield record;
      }
    }
  };

  function attachRuntimeLifecycle(lifecycle) {
    if (runtimeLifecycle && runtimeLifecycle !== lifecycle) {
      throw new TypeError("Codex provider owner already has a runtime lifecycle.");
    }
    runtimeLifecycle = lifecycle;
  }

  function assertOpen() {
    if (runtimeLifecycle) return runtimeLifecycle.assertOpen();
    return assertApplicationOpen();
  }

  function inScope(record) {
    if (record.scope === api) return true;
    const runtimeDir = normalizeText(record.providerOptions?.runtimeDir);
    if (!scopeRoot || !runtimeDir) return false;
    const relative = path.relative(scopeRoot, path.resolve(runtimeDir));
    return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
  }

  function withLifecycle(operation) {
    const run = codexAppServerProviderLifecycle.catch(() => null).then(operation);
    const tracked = run.catch(() => null).finally(() => {
      lifecycleTasks.delete(tracked);
    });
    codexAppServerProviderLifecycle = tracked;
    lifecycleTasks.add(tracked);
    return run;
  }

  function runtimeIsShared(providerKey = "", providerOptions = {}) {
    const runtimeKey = codexAppServerOwnedRuntimeKey(providerKey, providerOptions);
    return [...providerRecords()].some(record =>
      !(record.scope === api && record.providerKey === providerKey) &&
      codexAppServerOwnedRuntimeKey(record.providerKey, record.providerOptions) === runtimeKey);
  }

  function rememberOwnedRuntime({ provider = null, providerKey = "", providerOptions = {} } = {}) {
    if (!path.isAbsolute(providerOptions.runtimeDir || "")) throw new TypeError("Codex ownership requires an absolute native runtime directory.");
    const runtimeKey = codexAppServerOwnedRuntimeKey(providerKey, providerOptions);
    const consumer = records.get(providerKey);
    const record = {
      provider,
      providerKey: normalizeText(providerKey),
      providerOptions,
      sessionKey: consumer?.owner.sessionKey || "",
      runtimeDir: normalizeText(providerOptions?.runtimeDir),
      runtimeKey,
      scope: api,
      resources: consumer?.resources,
      preserveProcessExitProof: consumer?.preserveProcessExitProof === true
    };
    codexAppServerOwnedRuntimes.set(runtimeKey, record);
    return record;
  }

  function forgetOwnedRuntime(provider = null) {
    for (const [runtimeKey, record] of codexAppServerOwnedRuntimes.entries()) {
      if (record.provider === provider) codexAppServerOwnedRuntimes.delete(runtimeKey);
    }
  }

  async function acquireRuntime({ operation, provider = null, providerKey = "", providerOptions = {} } = {}) {
    assertOpen();
    rememberOwnedRuntime({ provider, providerKey, providerOptions });
    const acquisition = Promise.resolve().then(operation);
    runtimeAcquisitions.add(acquisition);
    try {
      const result = await acquisition;
      assertOpen();
      return result;
    } finally {
      runtimeAcquisitions.delete(acquisition);
    }
  }

  function createProvider({ providerKey, providerOptions = {}, owner = {}, create, observation, resources, preserveProcessExitProof = false } = {}) {
    assertOpen();
    if (!path.isAbsolute(providerOptions.runtimeDir || "")) throw new TypeError("Codex ownership requires an absolute native runtime directory.");
    const existing = records.get(providerKey);
    if (existing) return existing.provider;
    const provider = create(error => recover(providerKey, error));
    records.set(providerKey, {
      provider, providerKey, providerOptions,
      owner: { ...owner, providerOptions },
      observation, resources, preserveProcessExitProof, scope: api
    });
    codexAppServerProviders.set(api, records);
    return provider;
  }

  async function retireAndCloseProvider(providerKey = "", options = {}) {
    const record = records.get(normalizeText(providerKey));
    if (!record) return;
    await record.resources?.retire?.(record.provider);
    closeProvider(normalizeText(providerKey), options);
  }

  function createNativeProvider(parameters) {
    return providerFactory
      ? providerFactory(parameters)
      : new CodexAppServerAgentProvider(parameters, prepareNativeHost(parameters));
  }

  async function providerForSession(context) {
    assertOpen();
    context.assertAdmission();
    const providerKey = context.providerKey;
    const existing = providers.get(providerKey);
    if (existing) return existing;
    const identity = context.keyFields(providerKey);
    for (const currentKey of [...providers.keys()]) {
      const current = context.keyFields(currentKey);
      if (current.sessionId === identity.sessionId &&
          current.executionMode === identity.executionMode &&
          current.executionRoot === identity.executionRoot &&
          current.runtimeInstanceId === identity.runtimeInstanceId &&
          current.workdir === identity.workdir) {
        await retireAndCloseProvider(currentKey);
      }
    }
    context.assertAdmission();
    assertOpen();
    const prepared = await context.prepare(providerKey, identity);
    let unsubscribeControls = null;
    const provider = createProvider({
      providerKey,
      providerOptions: context.providerOptions,
      preserveProcessExitProof: prepared.preserveProcessExitProof,
      owner: prepared.owner,
      observation: prepared.observation,
      resources: prepared.resources,
      create: onObservationLost => {
        const parameters = {
          ...prepared.parameters,
          onClose() { unsubscribeControls?.(); },
          beforeResumeThread(threadId) {
            return prepared.runInContext(async () => {
              const guard = await prepared.prepareResumeGuard();
              if (!guard) return;
              context.runOwner.assertThreadCanResume(guard.run, threadId);
            });
          },
          prepareThreadResumeParams(threadId, params) {
            return prepared.runInContext(async () => {
              const resume = await prepared.prepareResume(threadId, params);
              if (!resume) return params;
              const config = await codexAppServerProjectHookTrustConfig(provider, resume.workdir);
              const settings = resume.settings;
              return {
                ...settings,
                ...params,
                config: { ...settings.config, ...config, ...params.config }
              };
            });
          },
          onObservationLost
        };
        return createNativeProvider(parameters);
      }
    });
    unsubscribeControls = prepared.controls.subscribe(event => {
      if (!prepared.controls.available) return;
      for (const [threadId, binding] of provider.threadEnvironments || []) {
        const boundEnv = binding.params.config?.shell_environment_policy?.set || {};
        if (!Object.entries(boundEnv).some(([key, value]) => key.endsWith("_COMMAND_SOCKET") && value === event.socketPath)) continue;
        // Keep listener replacement and rejected command recovery on the
        // provider's original per-thread operation.
        if (provider.threadEnvironmentTasks?.has(threadId)) continue;
        void prepared.runInContext(() => provider.ensureThreadControls(threadId))
          .catch(error => provider.failObservation(error))
          .catch(() => null);
      }
    });
    return provider;
  }

  async function ensureSession(context, mainThreadId = "") {
    const sessionId = context.sessionId;
    const providerOptions = context.providerOptions;
    let provider = await withLifecycle(() => providerForSession(context));
    if (provider.observationFailure) {
      await provider.failObservation(provider.observationFailure);
      provider = await withLifecycle(() => providerForSession(context));
    }
    const providerKey = context.providerKey;
    if (mainThreadId) {
      const fields = context.keyFields(providerKey);
      context.runOwner.runtimeLifecycle.rememberManagedSession(providerKey, {
        providerOptions,
        sessionId,
        threadId: mainThreadId,
        executionRoot: fields.executionRoot,
        workdir: fields.workdir
      });
    }
    try {
      context.assertAdmission();
      await acquireRuntime({
        operation: () => {
          if (typeof provider.ensureAvailable === "function") {
            return provider.ensureAvailable({ modelProviderId: providerOptions.routingModelProviderId });
          }
          if (typeof provider.listLoadedThreads === "function") {
            return provider.listLoadedThreads({ limit: 1 });
          }
          return provider.ensureRuntime?.();
        },
        provider,
        providerKey,
        providerOptions
      });
      return provider;
    } catch (error) {
      if (error?.code === runtimeBusyCode) {
        const managedThreadId = mainThreadId || context.runOwner.runtimeLifecycle.managedThreadId(providerKey);
        if (!context.closing && managedThreadId) context.runOwner.scheduleActiveRecovery(sessionId);
        throw error;
      }
      if (!context.closing && mainThreadId) await provider.failObservation(error);
      if (!context.closing && !provider.observationFailure) {
        await stopProvider(context.providerKey, providerOptions, {
          get runtimeHost() { return context.runtimeHost; }
        });
      }
      throw error;
    }
  }

  function closeProvider(providerKey = "", { closeProvider = true } = {}) {
    const record = records.get(providerKey);
    if (!record) return;
    record.resources?.release?.(record.provider);
    if (closeProvider) record.provider.close?.();
    records.delete(providerKey);
    if (!records.size) codexAppServerProviders.delete(api);
  }

  async function stopOwnedRuntime(record = {}, {
    cached = false,
    preserveProcessExitProof = false,
    requireVerifiedExit = true
  } = {}) {
    const provider = record.provider;
    const providerKey = normalizeText(record.providerKey);
    const resources = record.resources || records.get(providerKey)?.resources;
    const retirement = Promise.resolve().then(() => resources?.retire?.(provider));
    const runtimeStop = Promise.resolve().then(async () => {
      if (typeof provider?.stopRuntime !== "function") {
        throw new Error("Codex app-server provider must implement stopRuntime().");
      }
      const result = await provider.stopRuntime({ preserveProcessExitProof });
      if (requireVerifiedExit && !codexAppServerRuntimeStopWasVerified(result)) {
        const error = new Error("Codex app-server process exit could not be verified.");
        error.code = exitUnverifiedCode;
        error.providerKey = providerKey;
        error.retryable = true;
        throw error;
      }
      return result;
    });
    let [retired, stopped] = await Promise.allSettled([retirement, runtimeStop]);
    let pendingThreadCleanup = [];
    if (resources?.reconcileRetirement) {
      ({ retired, pendingThreadCleanup } = await resources.reconcileRetirement({ provider, retired, stopped }));
    }
    if (stopped.status === "fulfilled" && codexAppServerRuntimeStopWasVerified(stopped.value)) {
      forgetOwnedRuntime(provider);
    } else {
      provider?.close?.();
    }
    if (retired.status === "fulfilled" && cached) {
      (record.scope || api).closeProvider(providerKey, { closeProvider: stopped.status !== "fulfilled" });
    }
    const failures = [retired, stopped]
      .filter(result => result.status === "rejected")
      .map(result => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 0) {
      throw new AggregateError(failures, `Codex app-server shutdown failed for provider "${providerKey}".`);
    }
    return {
      ...stopped.value, pendingThreadCleanup, providerKey,
      stopped: codexAppServerRuntimeStopWasVerified(stopped.value)
    };
  }

  async function stopCachedProviderUnlocked(providerKey = "", {
    preserveProcessExitProof = false,
    requireStopped = false
  } = {}) {
    const normalizedProviderKey = normalizeText(providerKey);
    const provider = providers.get(normalizedProviderKey);
    if (!provider) {
      closeProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        stopped: false
      };
    }
    await records.get(normalizedProviderKey)?.resources?.retire?.(provider);
    const sharedProcessRetained = runtimeIsShared(
      normalizedProviderKey, providerOwners.get(normalizedProviderKey)?.providerOptions
    );
    if (sharedProcessRetained) {
      closeProvider(normalizedProviderKey);
      return {
        providerKey: normalizedProviderKey,
        sessionDetached: true,
        sharedProcessRetained: true,
        stopped: false
      };
    }
    if (typeof provider.stopRuntime !== "function") {
      closeProvider(normalizedProviderKey);
      throw new Error("Codex app-server provider must implement stopRuntime().");
    }
    let providerStoppedRuntime = false;
    try {
      const stoppedRuntime = await provider.stopRuntime({
        preserveProcessExitProof: preserveProcessExitProof || requireStopped
      });
      providerStoppedRuntime = codexAppServerRuntimeStopWasVerified(stoppedRuntime);
      if (requireStopped && !providerStoppedRuntime) {
        const error = new Error("Codex app-server process exit could not be verified.");
        error.code = requiredStopCode;
        error.retryable = true;
        throw error;
      }
      if (providerStoppedRuntime) {
        forgetOwnedRuntime(provider);
      }
      return {
        ...(stoppedRuntime && typeof stoppedRuntime === "object" ? stoppedRuntime : {}),
        providerKey: normalizedProviderKey,
        stopped: providerStoppedRuntime
      };
    } finally {
      closeProvider(normalizedProviderKey, {
        closeProvider: !providerStoppedRuntime
      });
    }
  }

  function stopCachedProvider(providerKey = "", options = {}) {
    return withLifecycle(
      () => stopCachedProviderUnlocked(providerKey, options)
    );
  }

  function runtimeExitUnverifiedError(providerKey = "") {
    const error = new Error("Codex app-server process exit could not be verified.");
    error.code = exitUnverifiedCode;
    error.providerKey = normalizeText(providerKey);
    error.retryable = true;
    return error;
  }

  async function stopPreparedRuntime(context) {
    const { runtime, parameters } = context.runtimeHost;
    return runtime.stop(parameters);
  }

  async function stopProvider(providerKey, providerOptions, context = {}) {
    const { preserveProcessExitProof = false, requireStopped = false } = context;
    const provider = providers.get(providerKey);
    if (!provider) {
      if (runtimeIsShared(providerKey, providerOptions)) {
        return {
          providerKey,
          sessionDetached: true,
          sharedProcessRetained: true,
          stopped: false
        };
      }
      const stoppedRuntime = await stopPreparedRuntime(context);
      const stopped = codexAppServerRuntimeStopWasVerified(stoppedRuntime);
      if (requireStopped && !stopped) {
        throw runtimeExitUnverifiedError(providerKey);
      }
      return {
        ...(Boolean(stoppedRuntime && typeof stoppedRuntime === "object" && !Array.isArray(stoppedRuntime)) ? stoppedRuntime : {}),
        providerKey,
        stopped
      };
    }
    return stopCachedProvider(providerKey, {
      preserveProcessExitProof,
      requireStopped
    });
  }

  async function stopThreadBeforeRelease(providerKey, provider, threadId) {
    try {
      await provider.stopThreadForObservationLoss(threadId, "");
    } catch (error) {
      // If other sessions retain the shared process, closing this
      // socket alone is not proof that its native goal/work stopped.
      const shared = runtimeIsShared(
        providerKey, providerOwners.get(providerKey)?.providerOptions
      );
      if (shared) throw error;
      // The caller's existing shutdown must instead prove process exit.
    }
  }

  function readModelCatalog({
    prepareProviderOptions,
    providerFactory,
    resources = null,
    signal = null,
    cacheMs = 30_000
  } = {}) {
    return withLifecycle(async () => {
      assertOpen();
      signal?.throwIfAborted();
      const providerOptions = await prepareProviderOptions();
      const existing = codexAppServerOwnedRuntimes.get(
        codexAppServerOwnedRuntimeKey("", providerOptions)
      );
      const provider = existing?.provider || providerFactory(providerOptions);
      let runtime = null;
      let catalog = null;
      let identity = "";
      try {
        identity = JSON.stringify(await provider.currentRuntimeInfo());
        signal?.throwIfAborted();
        if (codexAppServerChatModelCatalog?.identity === identity &&
            codexAppServerChatModelCatalog.expiresAt > Date.now()) {
          return codexAppServerChatModelCatalog.value;
        }
        if (!existing?.provider) {
          runtime = await acquireRuntime({
            operation: () => provider.ensureRuntime(),
            provider,
            providerOptions
          });
        }
        catalog = await provider.listModels({ includeHidden: false, limit: 100 }, { signal });
      } finally {
        if (!existing?.provider) {
          try {
            if ((runtime || provider.runtime)?.reused === false) {
              await stopOwnedRuntime({ provider, resources });
            } else {
              forgetOwnedRuntime(provider);
            }
          } finally {
            provider.close();
          }
        }
      }
      codexAppServerChatModelCatalog = {
        expiresAt: Date.now() + cacheMs,
        identity,
        value: catalog
      };
      return catalog;
    });
  }

  async function invalidateRuntimes({
    includeOwned = false,
    requireVerifiedExit = false,
    stopOwnedRuntimes = false,
    toolHomeSource = ""
  } = {}) {
    codexAppServerChatModelCatalog = null;
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
      failed,
      ok: failed.length === 0,
      providerCount: targets.length,
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

  function reportRecoveryEvent(record, event, error) {
    onRecoveryEvent(record.owner, event, error);
  }

  function recover(providerKey, error) {
    const record = records.get(providerKey);
    if (!record || closing) return Promise.resolve();
    assertOpen();
    if (!record.observationStop || record.observationStop.error !== error) {
      reportRecoveryEvent(record, "lost", error);
      const stop = { error, promise: suspendUnobservedProvider(record, error) };
      record.observationStop = stop;
      const tracked = stop.promise.catch(failure => {
        reportRecoveryEvent(record, "stopFailed", failure);
      }).finally(() => {
        if (record.observationStop === stop) record.observationStop = null;
        lifecycleTasks.delete(tracked);
      });
      lifecycleTasks.add(tracked);
    }
    return record.observationStop.promise;
  }

  function pendingRecovery(providerKey, provider) {
    const record = records.get(providerKey);
    return record && record.provider === provider ? record.observationStop?.promise || null : null;
  }

  async function stopProvidersForProject({
    preserveProcessExitProof = false,
    projectContextRoot = "",
    reason = "",
  } = {}, { managed, keyFields, helperThreads }) {
    const normalizedProjectContextRoot = normalizeText(projectContextRoot);
    if (!normalizedProjectContextRoot) {
      return {
        failed: [],
        ok: true,
        projectContextRoot: normalizedProjectContextRoot,
        providerCount: 0,
        reason: normalizeText(reason),
        results: [],
        stopped: 0
      };
    }
    const helperProviders = new Set(
      helperThreads.records({
        projectContextRoot: normalizedProjectContextRoot
      }).map((record) => record.provider)
    );
    const providerKeys = [...providers.keys()]
      .filter((providerKey) => {
        const current = managed.get(providerKey);
        return normalizeText(current?.projectContext?.targetRoot) === normalizedProjectContextRoot ||
          helperProviders.has(providers.get(providerKey));
      });
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        const fields = keyFields(providerKey);
        results.push(await stopCachedProvider(providerKey, {
          preserveProcessExitProof: Boolean(
            preserveProcessExitProof &&
            fields.sessionId &&
            fields.executionMode !== "helper"
          )
        }));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: normalizeText(error?.error || error?.message || error) || runtimeCloseError,
          providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    const stopped = results.filter((result) => result.stopped).length;
    debugLog("appServerRuntime.closeProject.done", {
      failedCount: failed.length,
      providerCount: providerKeys.length,
      projectContextRoot: normalizedProjectContextRoot,
      reason: normalizeText(reason),
      stopped
    });
    return {
      failed,
      ok: failed.length === 0,
      projectContextRoot: normalizedProjectContextRoot,
      providerCount: providerKeys.length,
      reason: normalizeText(reason),
      results,
      stopped
    };
  }

  async function stopCachedProvidersForSession(sessionKey = "", options = {}) {
    if (!sessionKey) {
      return {
        failed: [],
        ok: true,
        providerCount: 0,
        results: [],
        stopped: 0
      };
    }
    const providerKeys = [...providers.keys()]
      .filter((providerKey) => (
        providerOwners.get(providerKey)?.sessionKey === sessionKey
      ));
    const failed = [];
    const results = [];
    for (const providerKey of providerKeys) {
      try {
        results.push(await stopCachedProvider(providerKey, options));
      } catch (error) {
        failed.push({
          code: normalizeText(error?.code),
          error: normalizeText(error?.error || error?.message || error) || runtimeCloseError,
          providerKey,
          retryable: error?.retryable === true
        });
      }
    }
    return {
      failed,
      ok: failed.length === 0,
      providerCount: providerKeys.length,
      results,
      stopped: results.filter((result) => result.stopped).length
    };
  }

  function drainThreadEnvironmentTasks(sessionKey) {
    return Promise.all([...providers.entries()]
      .filter(([key]) => providerOwners.get(key)?.sessionKey === sessionKey)
      .flatMap(([, provider]) => [...(provider.threadEnvironmentTasks?.values() || [])])
      .map((task) => task.catch(() => null)));
  }

  async function stopPersistedRuntime({ runtime, parameters }, runtimeDir) {
    const result = await runtime.stop(parameters);

    return {
      ...result,
      runtimeDirExists: await directoryExists(runtimeDir),
      verifiedStopped: result?.stopped === true ||
        result?.processExitVerified === true ||
        result?.runtimeDirRemoved === true
    };
  }

  function sessionExitProof(sessionKey, context) {
    const { cachedProviders, persistedRuntime } = context;
    const noRuntimeAcquired = cachedProviders.providerCount === 0 &&
      !context.hasRuntime &&
      !context.threadId &&
      ![...ownedRuntimes.values()].some((record) => record.sessionKey === sessionKey);
    const cachedRuntimeExitVerified = cachedProviders.providerCount > 0 &&
      cachedProviders.results.length === cachedProviders.providerCount &&
      cachedProviders.results.every((result) => (
        result?.stopped === true ||
        (result?.sessionDetached === true && result?.sharedProcessRetained === true)
      ));
    const persistedRuntimeExitVerified = persistedRuntime?.verifiedStopped === true ||
      (
        persistedRuntime?.sessionDetached === true &&
        persistedRuntime?.sharedProcessRetained === true
      );
    return { noRuntimeAcquired, cachedRuntimeExitVerified, persistedRuntimeExitVerified };
  }

  async function unsubscribeSessionThread(sessionKey, sessionId, session) {
    if (!sessionId) {
      return { ok: true, sessionId, status: "notSubscribed" };
    }
    const { providerOptions, workdir, threadId } = session.unsubscribeParameters;
    if (!threadId) {
      return { ok: true, providerOptions, sessionId, status: "notSubscribed" };
    }
    // The existing record carries the workdir captured in its provider key.
    // Never prepare new controls while releasing a retained connection.
    const provider = [...records.values()].find(record =>
      record.owner.sessionKey === sessionKey && record.owner.workdir === normalizeText(workdir))?.provider;
    if (!provider || typeof provider.unsubscribeThread !== "function") {
      return { ok: true, providerOptions, sessionId, status: "notSubscribed" };
    }
    const result = await provider.unsubscribeThread(threadId);
    debugLog("appServerThread.unsubscribe.done", {
      sessionId,
      status: normalizeText(result?.status),
      threadId
    });
    return {
      ok: true,
      providerOptions,
      result,
      sessionId,
      status: normalizeText(result?.status) || "unsubscribed",
      threadId
    };
  }

  async function stopPersistedSessionRuntime(session) {
    const host = session.persistedRuntimeHost;
    if (!host) return { stopped: false };
    return stopPersistedRuntime(host, host.runtimeDir);
  }

  async function releasePersistedRuntimeProof(runtimeOptions, session) {
    // Session closure already detached this participant. Its archived runtime
    // path may now belong to the successor or another live conversation.
    // Releasing the old proof must not stop or delete that shared process.
    if (runtimeIsShared("", runtimeOptions)) {
      return { sharedProcessRetained: true };
    }
    const existed = await directoryExists(runtimeOptions.runtimeDir);
    if (!existed) return { existed };
    const result = await stopPersistedSessionRuntime(session);
    return { existed, result };
  }

  function releasePreparedRuntimeProof(preparation) {
    return withLifecycle(async () => {
      const prepared = preparation.read();
      if (Object.hasOwn(prepared, "value")) return prepared.value;
      const evidence = await releasePersistedRuntimeProof(prepared.runtimeOptions, prepared);
      return prepared.complete(evidence);
    });
  }

  async function releaseSession(sessionKey, context) {
    const { sessionId, runOwner, session } = context;
    if (context.changeover) {
      const threadId = session.threadId;
      for (const [key, provider] of providers) {
        if (!threadId || providerOwners.get(key)?.sessionKey !== sessionKey) continue;
        await stopThreadBeforeRelease(key, provider, threadId);
      }
    }
    let exitFailure = null;
    try {
      const unsubscribeResult = await unsubscribeSessionThread(sessionKey, sessionId, session);
      session.providerOptions = unsubscribeResult?.providerOptions || session.providerOptions;
    } catch (error) {
      debugLog("appServerThread.unsubscribe.error", {
        error: debugError(error),
        sessionId
      });
    } finally {
      await runOwner.notificationQueue.drain(sessionId);
      const cachedProviders = await stopCachedProvidersForSession(sessionId ? sessionKey : "", {
        preserveProcessExitProof: context.preserveProcessExitProof,
        requireStopped: context.requireStopped
      });
      if (cachedProviders.ok === false) {
        debugLog("appServerRuntime.closeSession.cached.error", {
          failed: cachedProviders.failed,
          sessionId
        });
      }
      let persistedRuntime = null;
      if (session.exists) {
        persistedRuntime = cachedProviders.stopped > 0
          ? {
              stopped: true,
              verifiedStopped: true
            }
          : runtimeIsShared("", session.providerOptions || {})
          ? {
              sessionDetached: true,
              sharedProcessRetained: true,
              stopped: false,
              verifiedStopped: false
            }
          : session.hasRuntime
            ? await stopPersistedSessionRuntime(session)
            : {
                stopped: false,
                verifiedStopped: false
              };
        debugLog("appServerRuntime.closeSession.persisted.done", {
          removed: persistedRuntime?.removed === true,
          runtimeDirRemoved: persistedRuntime?.runtimeDirRemoved === true,
          sessionId,
          stopped: persistedRuntime?.removed === true || persistedRuntime?.runtimeDirRemoved === true
        });
      }
      if (session.requiresExitProof) {
        // A fresh session with no acquired native owner needs no process proof.
        // Losing a cache or recorded runtime does not make it a fresh session.
        const { noRuntimeAcquired, cachedRuntimeExitVerified, persistedRuntimeExitVerified } =
          sessionExitProof(sessionKey, {
            cachedProviders,
            persistedRuntime,
            get hasRuntime() { return session.hasRuntime; },
            get threadId() { return session.threadId; }
          });
        if (cachedProviders.failed.length > 0 ||
            (!noRuntimeAcquired && !cachedRuntimeExitVerified && !persistedRuntimeExitVerified)) {
          exitFailure = {
            cachedFailures: cachedProviders.failed,
            cachedRuntimeExitVerified,
            persistedRuntime: persistedRuntime || null
          };
        }
      }
    }
    return { exitFailure };
  }

  async function readPlanUsage(sessionKey) {
    for (const [key, provider] of providers) {
      if (providerOwners.get(key)?.sessionKey === sessionKey &&
          !provider.isHelperProvider() && provider.isAvailable()) {
        return provider.readPlanUsage();
      }
    }
    return { status: "unavailable", windows: [] };
  }

  async function readSessionGoal(sessionKey, threadId) {
    if (!threadId) return { status: "available", threadId: "", goal: null };
    for (const [key, provider] of providers) {
      if (providerOwners.get(key)?.sessionKey === sessionKey &&
          !provider.isHelperProvider() && provider.isAvailable()) {
        const result = await provider.readGoal(threadId);
        return { status: "available", threadId, goal: result.goal || null };
      }
    }
    return { status: "unavailable", goal: null };
  }

  const api = Object.freeze({
    providers, providerOwners, ownedRuntimes, lifecycleTasks, runtimeAcquisitions,
    withLifecycle, runtimeIsShared, rememberOwnedRuntime, forgetOwnedRuntime, attachRuntimeLifecycle,
    acquireRuntime, createProvider, createNativeProvider, providerForSession, ensureSession, retireAndCloseProvider, closeProvider, stopOwnedRuntime, stopCachedProvider, stopProvider, stopThreadBeforeRelease, readModelCatalog, invalidateRuntimes, recover,
    reportRecoveryEvent, pendingRecovery, readSessionGoal, readPlanUsage, stopCachedProvidersForSession, stopProvidersForProject, drainThreadEnvironmentTasks, stopPersistedRuntime, sessionExitProof,
    unsubscribeSessionThread, releasePersistedRuntimeProof, releasePreparedRuntimeProof, releaseSession,
    beginShutdown() { closing = true; }
  });
  return api;
}
