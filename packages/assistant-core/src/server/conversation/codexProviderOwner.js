import path from "node:path";
import { CodexAppServerAgentProvider } from "./codexProvider.js";
import { codexAppServerProjectHookTrustConfig } from "./codexConfiguration.js";
import { createCodexRuntimeModelCatalog } from "./codexModelCatalog.js";
import { createCodexProviderInvalidation } from "./codexProviderInvalidation.js";
import { createCodexProviderRelease } from "./codexProviderRelease.js";
import {
  codexAppServerOwnedRuntimeKey,
  codexAppServerOwnedRuntimes,
  codexAppServerProviders,
  codexAppServerRuntimeStopWasVerified,
  codexAppServerStaleRuntimes,
  providerRecords,
  runningNativeThreads,
  runtimePeers,
  withRuntimeLifecycle
} from "./codexRuntimeInventory.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {ReturnType<typeof createCodexAppServerProviderOwner>} CodexAppServerProviderOwner */

/**
 * The provider sessions a run owner works through, supplied by its application: the provider owner, the managed
 * sessions it keeps running, and the per-session contexts it prepares.
 * @typedef {object} CodexProviderSessions
 * @property {CodexAppServerProviderOwner} owner
 * @property {Map<string, object>} managed
 * @property {(sessionId: string, providerOptions: object) => object} context
 * @property {(providerKey: string) => object} keyFields
 * @property {() => void} assertOpen
 * @property {object} [connectionPolicy]
 * @property {(request: { sessionId: string, runtime: object, session: object }) => Promise<object | null>} [outputContext]
 * @property {number} [wellbeingMs]
 */

/** An owner outside an application lifecycle is always open. */
function ownerStaysOpen() {}

/** An owner without a recovery listener reports nothing. */
function ignoreRecoveryEvent() {}

/** An owner without a debug log records nothing. */
function ignoreDebugEvent() {}

/** A provider built without a native host description gets an empty one. */
function emptyNativeHost() {
  return {};
}

/**
 * Internal consumer view of the one native provider owner, not a server per view.
 * @param {object} [dependencies]
 * @param {string} [dependencies.runtimeRoot]
 * @param {() => void} [dependencies.assertOpen]
 * @param {(owner: object, event: string, error: unknown) => void} [dependencies.onRecoveryEvent]
 * @param {(event: string, details: object) => void} [dependencies.debugLog]
 * @param {(error: unknown) => unknown} [dependencies.debugError]
 * @param {((parameters: object) => CodexAppServerAgentProvider) | null} [dependencies.providerFactory]
 * @param {(parameters: object) => object} [dependencies.prepareNativeHost]
 * @param {string} [dependencies.runtimeBusyCode]
 * @param {string} [dependencies.exitUnverifiedCode]
 * @param {string} [dependencies.requiredStopCode]
 * @param {string} [dependencies.runtimeCloseError]
 * @param {number} [dependencies.transientIdleMs]
 */
export function createCodexAppServerProviderOwner({
  runtimeRoot = "",
  assertOpen: assertApplicationOpen = ownerStaysOpen,
  onRecoveryEvent = ignoreRecoveryEvent,
  debugLog = ignoreDebugEvent,
  debugError = error => error,
  // readable-check: allow dependency-default - input validation: an application passes null to choose the built-in provider
  providerFactory = null,
  prepareNativeHost = emptyNativeHost,
  runtimeBusyCode = "codex_app_server_runtime_busy",
  exitUnverifiedCode = "codex_runtime_exit_unverified",
  requiredStopCode = "codex_runtime_exit_unverified",
  runtimeCloseError = "Codex app-server runtime close failed.",
  transientIdleMs = 60_000
} = {}) {
  const scopeRoot = normalizeText(runtimeRoot) ? path.resolve(runtimeRoot) : "";
  const records = new Map();
  const lifecycleTasks = new Set();
  const runtimeAcquisitions = new Set();
  let codexAppServerProviderLifecycle = Promise.resolve();
  let closing = false;
  let runtimeLifecycle = null;
  // Providers borrowed by work that is not a conversation, terminal or helper.
  const transientReleases = new Map();

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

  const modelCatalog = createCodexRuntimeModelCatalog({ withLifecycle, assertOpen, acquireRuntime, stopOwnedRuntime, forgetOwnedRuntime });
  const invalidation = createCodexProviderInvalidation({
    inScope, withLifecycle, forgetModelCatalog: modelCatalog.forget, exitUnverifiedCode, debugLog, debugError
  });
  const sessionRelease = createCodexProviderRelease({
    records, providers, providerOwners, ownedRuntimes, withLifecycle, runtimeIsShared, forgetOwnedRuntime, closeProvider,
    requiredStopCode, exitUnverifiedCode, runtimeCloseError, debugLog, debugError
  });

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

  function withLifecycle(operation, providerKey = "", providerOptions = null) {
    const run = codexAppServerProviderLifecycle.catch(() => null).then(() => {
      if (!providerKey && !providerOptions) return operation();
      const options = providerOptions || records.get(normalizeText(providerKey))?.providerOptions;
      return withRuntimeLifecycle(codexAppServerOwnedRuntimeKey(providerKey, options), operation);
    });
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
      runtimeDir: normalizeText(providerOptions.runtimeDir),
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

  /**
   * @param {object} request
   * @param {string} request.providerKey
   * @param {object} [request.providerOptions]
   * @param {object} [request.owner]
   * @param {(onObservationLost: (error: unknown) => Promise<void>) => CodexAppServerAgentProvider} request.create
   * @param {object} [request.observation]
   * @param {object} [request.resources]
   * @param {boolean} [request.preserveProcessExitProof]
   */
  function createProvider({ providerKey, providerOptions = {}, owner = {}, create, observation, resources, preserveProcessExitProof = false }) {
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
    // readable-check: allow optional-call - optional operation: a driver's resources have no retire step, and a borrowed provider has no resources
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
        const record = records.get(currentKey);
        if (!record?.provider.stale) {
          await retireAndCloseProvider(currentKey);
          continue;
        }
        // A stale runtime whose turn has ended stops before the session's next
        // runtime starts, so its threads are never loaded in two runtimes at once.
        await retireStaleRuntime(codexAppServerOwnedRuntimeKey(currentKey, record.providerOptions)).catch(() => null);
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
          runInContext: prepared.runInContext,
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
        // Listener replacement and rejected command recovery stay on the
        // provider's per-thread operation that is already running.
        if (provider.threadEnvironmentTasks?.has(threadId)) continue;
        void prepared.runInContext(() => provider.ensureThreadControls(threadId))
          .catch(error => provider.failObservation(error))
          .catch(() => null);
      }
    });
    return provider;
  }

  // A Main conversation, terminal or helper keeps a provider a borrower created.
  // Every exported way to reach a provider for real use claims it here.
  function claimTransient(providerKey = "") {
    const key = normalizeText(providerKey);
    const release = transientReleases.get(key);
    if (!release) return;
    clearTimeout(release.timer);
    transientReleases.delete(key);
  }

  async function ensureSession(context, mainThreadId = "") {
    claimTransient(context.providerKey);
    return acquireSession(context, mainThreadId);
  }

  // The last borrower's return starts a short idle, so consecutive borrowers
  // share one process; the release then stops it unless it was claimed.
  function useBorrowed(providerKey, release) {
    clearTimeout(release.timer);
    release.users += 1;
    let returned = false;
    return () => {
      if (returned) return;
      returned = true;
      release.users -= 1;
      if (release.users > 0 || transientReleases.get(providerKey) !== release || closing) return;
      release.timer = setTimeout(() => {
        if (transientReleases.get(providerKey) !== release || release.users > 0) return;
        transientReleases.delete(providerKey);
        if (closing) return;
        sessionRelease.stopCachedProvider(providerKey).catch(error => debugLog("appServerRuntime.transientRelease.error", {
          error: debugError(error), providerKey
        }));
      }, transientIdleMs);
      release.timer.unref();
    };
  }

  // Reads, storage work and Temporary chats borrow a session provider instead
  // of claiming it. `release()` returns the borrow. A provider a real user
  // already holds (it exists unborrowed, or a managed Main thread uses it) is
  // simply used and stays that user's.
  async function borrowSession(context) {
    const providerKey = context.providerKey;
    let release = transientReleases.get(providerKey);
    if (!release && (records.has(providerKey) || context.runOwner.runtimeLifecycle.managedThreadId(providerKey))) {
      return { provider: await acquireSession(context), release() {} };
    }
    if (!release) transientReleases.set(providerKey, release = { users: 0, timer: null });
    const returnBorrow = useBorrowed(providerKey, release);
    try {
      return { provider: await acquireSession(context), release: returnBorrow };
    } catch (error) {
      returnBorrow();
      throw error;
    }
  }

  async function withTransientSession(context, operation) {
    const borrowed = await borrowSession(context);
    try {
      return await operation(borrowed.provider);
    } finally {
      borrowed.release();
    }
  }

  // Native work running on a borrowed provider (a Temporary turn or goal)
  // holds it until that work ends. A claimed or closed provider needs no hold.
  function holdProvider(provider) {
    for (const [providerKey, record] of records) {
      if (record.provider !== provider) continue;
      const release = transientReleases.get(providerKey);
      return release ? useBorrowed(providerKey, release) : () => {};
    }
    return () => {};
  }

  async function acquireSession(context, mainThreadId = "") {
    const sessionId = context.sessionId;
    const providerOptions = context.providerOptions;
    const providerKey = context.providerKey;
    let provider = await withLifecycle(() => providerForSession(context), providerKey, providerOptions);
    if (provider.observationFailure) {
      await provider.failObservation(provider.observationFailure);
      provider = await withLifecycle(() => providerForSession(context), providerKey, providerOptions);
    }
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
        operation: () => provider.ensureAvailable({ modelProviderId: providerOptions.routingModelProviderId }),
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
        await sessionRelease.stopProvider(context.providerKey, providerOptions, {
          get runtimeHost() { return context.runtimeHost; }
        });
      }
      throw error;
    }
  }

  function closeProvider(providerKey = "", { closeProvider = true } = {}) {
    const record = records.get(providerKey);
    if (!record) return;
    // readable-check: allow optional-call - optional operation: a provider borrowed for a catalogue read has no resources
    record.resources?.release?.(record.provider);
    if (closeProvider) record.provider.close();
    records.delete(providerKey);
    if (!records.size) codexAppServerProviders.delete(api);
    if (record.provider.stale) {
      // Another stop (a session close or idle release) ended a stale runtime.
      const runtimeKey = codexAppServerOwnedRuntimeKey(providerKey, record.providerOptions);
      const stale = codexAppServerStaleRuntimes.get(runtimeKey);
      if (stale && !stale.retiring && !runtimePeers(runtimeKey).length) {
        codexAppServerStaleRuntimes.delete(runtimeKey);
      }
    }
  }

  async function stopOwnedRuntime(record = {}, {
    cached = false,
    preserveProcessExitProof = false,
    requireVerifiedExit = true
  } = {}) {
    const provider = record.provider;
    const providerKey = normalizeText(record.providerKey);
    const resources = record.resources || records.get(providerKey)?.resources;
    // readable-check: allow optional-call - optional operation: a driver's resources have no retire step, and a borrowed provider has no resources
    const retirement = Promise.resolve().then(() => resources?.retire?.(provider));
    const runtimeStop = Promise.resolve().then(async () => {
      // readable-check: allow method-probe - safety invariant: a record without a provider that stops would leave its process running unverified
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
      provider?.close();
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

  // Stops a stale runtime once no loaded thread is running, through the same
  // verified stop an idle runtime gets at the account change.
  function retireStaleRuntime(runtimeKey = "") {
    const stale = codexAppServerStaleRuntimes.get(runtimeKey);
    if (!stale) return Promise.resolve(null);
    if (stale.retiring) return stale.retiring;
    const retiring = withRuntimeLifecycle(runtimeKey, async () => {
      const peers = runtimePeers(runtimeKey);
      const running = await runningNativeThreads(peers).catch(() => []);
      // A Temporary turn or goal holding a borrowed provider also keeps it.
      if (running.length || peers.some(peer => peer.scope.isHeld(peer.providerKey))) {
        return { ...stale, busy: true, stopped: false };
      }
      const owned = codexAppServerOwnedRuntimes.get(runtimeKey);
      const target = owned || peers[0];
      let result = { stopped: false };
      if (target) {
        result = await (target.scope || api).stopOwnedRuntime({ ...target }, {
          cached: true,
          // A runtime its session no longer records keeps no exit proof.
          preserveProcessExitProof: target.preserveProcessExitProof === true && !stale.superseded,
          requireVerifiedExit: true
        });
      }
      for (const peer of peers) peer.scope.closeProvider(peer.providerKey);
      codexAppServerStaleRuntimes.delete(runtimeKey);
      return { ...stale, ...result, busy: false };
    }).finally(() => {
      if (stale.retiring === retiring) stale.retiring = null;
    });
    stale.retiring = retiring;
    return retiring;
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
      const stop = { error, promise: invalidation.suspendUnobservedProvider(record, error) };
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

  // A borrowed provider (a read, storage work or a Temporary chat) is not the
  // session's conversation.
  async function readPlanUsage(sessionKey) {
    for (const [key, provider] of providers) {
      if (providerOwners.get(key)?.sessionKey === sessionKey && !transientReleases.has(key) &&
          !provider.isHelperProvider() && provider.isAvailable()) {
        return provider.readPlanUsage();
      }
    }
    return { status: "unavailable", windows: [] };
  }

  async function readSessionGoal(sessionKey, threadId) {
    if (!threadId) return { status: "available", threadId: "", goal: null };
    for (const [key, provider] of providers) {
      if (providerOwners.get(key)?.sessionKey === sessionKey && !transientReleases.has(key) &&
          !provider.isHelperProvider() && provider.isAvailable()) {
        const result = await provider.readGoal(threadId);
        return { status: "available", threadId, goal: result.goal || null };
      }
    }
    return { status: "unavailable", goal: null };
  }

  function isHeld(providerKey) {
    return (transientReleases.get(normalizeText(providerKey))?.users || 0) > 0;
  }

  // The exported ways to reach a provider for real use claim it first.
  function acquireClaimedRuntime(options) {
    claimTransient(options?.providerKey);
    return acquireRuntime(options);
  }

  function createClaimedProvider(options) {
    claimTransient(options?.providerKey);
    return createProvider(options);
  }

  function claimedProviderForSession(context) {
    claimTransient(context.providerKey);
    return providerForSession(context);
  }

  function beginShutdown() {
    closing = true;
    for (const release of transientReleases.values()) clearTimeout(release.timer);
    transientReleases.clear();
  }

  const api = Object.freeze({
    providers, providerOwners, ownedRuntimes, lifecycleTasks, runtimeAcquisitions,
    isHeld,
    withLifecycle, runtimeIsShared, rememberOwnedRuntime, forgetOwnedRuntime, attachRuntimeLifecycle,
    acquireRuntime: acquireClaimedRuntime,
    createProvider: createClaimedProvider,
    providerForSession: claimedProviderForSession,
    createNativeProvider, ensureSession, borrowSession, withTransientSession, holdProvider, retireAndCloseProvider, closeProvider,
    stopOwnedRuntime,
    stopCachedProvider: sessionRelease.stopCachedProvider,
    stopProvider: sessionRelease.stopProvider,
    stopThreadBeforeRelease: sessionRelease.stopThreadBeforeRelease,
    readModelCatalog: modelCatalog.read,
    invalidateRuntimes: invalidation.invalidateRuntimes,
    recover, reportRecoveryEvent, pendingRecovery, readSessionGoal, readPlanUsage,
    stopCachedProvidersForSession: sessionRelease.stopCachedProvidersForSession,
    stopProvidersForProject: sessionRelease.stopProvidersForProject,
    drainThreadEnvironmentTasks: sessionRelease.drainThreadEnvironmentTasks,
    stopPersistedRuntime: sessionRelease.stopPersistedRuntime,
    sessionExitProof: sessionRelease.sessionExitProof,
    unsubscribeSessionThread: sessionRelease.unsubscribeSessionThread,
    releasePersistedRuntimeProof: sessionRelease.releasePersistedRuntimeProof,
    releasePreparedRuntimeProof: sessionRelease.releasePreparedRuntimeProof,
    releaseSession: sessionRelease.releaseSession,
    retireStaleRuntime,
    beginShutdown
  });
  return api;
}
