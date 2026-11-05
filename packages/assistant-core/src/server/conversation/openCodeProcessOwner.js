import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import path from "node:path";
import { OPENCODE_INTERRUPT_TIMEOUT_MS } from "./openCodeTurn.js";
import { openCodeServerForDirectory, sameOpenCodeSelection } from "./openCodeNativeSession.js";
import { normalizeNullableText } from "./normalize.js";

/** A released target whose caller keeps no state about it. */
function ignoreTargetRemoval() {}

/**
 * The one shared OpenCode process and the targets that use it: its start and
 * stop, its directories' credentials, its saved connections, the storage reads
 * that borrow it, and each target's acquisition and release. The process stops
 * when its last user leaves.
 * @param {{
 *   processes: Map<string, object>,
 *   processStarts: Map<string, Promise<object>>,
 *   monitors: Map<string, Promise<object>>,
 *   turns: Map<string, object>,
 *   temporaryConversations: Map<string, object>,
 *   onStop: (stop: { reason: string, sessions: number, startingSessions: number }) => void,
 *   storageIdleMs: number
 * }} options
 */
export function createOpenCodeProcessOwner({ processes, processStarts, monitors, turns, temporaryConversations, onStop, storageIdleMs }) {
  const processExitProofs = new Map();
  let sharedProcess = null;
  let sharedProcessStart = null;
  let sharedProcessStop = null;
  let failedStartup = null;
  let closed = false;
  let connectionUpdate = Promise.resolve();
  let storageReads = 0;
  let storageIdle = null;

  async function stop(reason = "opencode-last-session-closed") {
    if (sharedProcessStop) return sharedProcessStop;
    const target = sharedProcess;
    const startup = failedStartup;
    if (!target && !startup) return { exited: true, reason };
    onStop({ reason, sessions: processes.size, startingSessions: processStarts.size });
    const stopping = (async () => {
      const proof = startup ? await startup.retryCleanup() : await target.server.stop();
      if (proof?.exited !== true) {
        throw new AppError(503, "OpenCode process exit could not be verified.", {
          code: "assistant_opencode_stop_unverified", details: {}
        });
      }
      if (sharedProcess === target) sharedProcess = null;
      if (failedStartup === startup) failedStartup = null;
      return proof;
    })();
    sharedProcessStop = stopping;
    try {
      return await stopping;
    } finally {
      if (sharedProcessStop === stopping) sharedProcessStop = null;
    }
  }

  // A credential change reaches a native directory when OpenCode reloads that
  // directory's instance. An idle directory reloads at once; one with a turn in
  // flight reloads when its last turn there ends. New work in a directory waits
  // for its reload, so it never starts on credentials the server no longer holds.
  function directoryState(shared, workdir) {
    const directory = path.resolve(workdir);
    let state = shared.directories.get(directory);
    if (!state) {
      state = { directory, generation: shared.generation, turns: 0, reload: null, idle: null };
      shared.directories.set(directory, state);
    }
    return state;
  }

  function directoryCurrent(workdir) {
    const state = sharedProcess && normalizeNullableText(workdir) ? sharedProcess.directories.get(path.resolve(workdir)) : null;
    return !state || (!state.reload && state.generation === sharedProcess.generation);
  }

  function reloadDirectory(shared, state) {
    if (state.reload || state.generation === shared.generation) return state.reload;
    state.reload = (async () => {
      try {
        while (state.generation < shared.generation) {
          const generation = shared.generation;
          await shared.server.client.forDirectory(state.directory).disposeInstance();
          state.generation = generation;
        }
      } finally {
        state.reload = null;
      }
    })();
    return state.reload;
  }

  async function waitForDirectory(workdir) {
    const shared = sharedProcess;
    const state = directoryState(shared, workdir);
    try {
      if (state.reload || !state.turns) await reloadDirectory(shared, state);
      else await (state.idle ||= Promise.withResolvers()).promise;
    } catch (error) {
      if (sharedProcess !== shared) return;
      throw new AppError(503, "OpenCode could not load the changed AI connection for this work. Send your message again.", {
        cause: error, code: "assistant_opencode_connection_reload_failed", details: {}
      });
    }
  }

  async function currentDirectory(workdir) {
    while (!directoryCurrent(workdir)) await waitForDirectory(workdir);
  }

  // Holds a directory's credentials for a turn in flight there.
  function holdDirectory(workdir) {
    const shared = sharedProcess;
    if (!shared || !normalizeNullableText(workdir)) return () => {};
    const state = directoryState(shared, workdir);
    state.turns += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      state.turns -= 1;
      if (state.turns) return;
      state.idle?.resolve();
      state.idle = null;
      if (sharedProcess === shared) reloadDirectory(shared, state)?.catch(() => {});
    };
  }

  async function admitDirectory(workdir) {
    while (!directoryCurrent(workdir)) await waitForDirectory(workdir);
    return holdDirectory(workdir);
  }

  function reloadChangedCredentials(shared) {
    for (const directory of shared.server.client.instanceDirectories()) directoryState(shared, directory);
    shared.generation += 1;
    for (const state of shared.directories.values()) {
      if (!state.turns) reloadDirectory(shared, state)?.catch(() => {});
    }
  }

  function connectionRecord(connection) {
    return { canonicalUrl: connection.canonicalUrl, endpointCode: connection.endpointCode, fingerprint: connection.fingerprint };
  }

  function sameConnection(recorded, connection) {
    return recorded?.canonicalUrl === connection.canonicalUrl && recorded.fingerprint === connection.fingerprint &&
      recorded.endpointCode === connection.endpointCode;
  }

  // A key changes in place; a provider route belongs to the server's configuration.
  function inPlaceConnection(recorded, connection) {
    return Boolean(connection?.apiKey) && (recorded
      ? recorded.canonicalUrl === connection.canonicalUrl && recorded.endpointCode === connection.endpointCode
      : !normalizeNullableText(connection.canonicalUrl));
  }

  // The running server takes the host's saved connections without stopping its
  // turns. Reading them inside this queue applies the newest saved state last.
  function updateConnections(readConnections) {
    const update = connectionUpdate.then(async () => {
      const shared = sharedProcess;
      if (!shared) return;
      shared.connectionsCurrent = false;
      let changed = false;
      try {
        const saved = new Map((await readConnections()).map(connection => [connection.modelProviderId, connection]));
        for (const [providerId, connection] of saved) {
          const recorded = shared.connections.get(providerId);
          if (sameConnection(recorded, connection) || !inPlaceConnection(recorded, connection)) continue;
          await shared.server.client.authenticateApiKey(providerId, connection.apiKey);
          shared.connections.set(providerId, connectionRecord(connection));
          changed = true;
        }
        for (const providerId of [...shared.connections.keys()]) {
          if (saved.has(providerId)) continue;
          await shared.server.client.removeAuthentication(providerId);
          shared.connections.delete(providerId);
          changed = true;
        }
        shared.connectionsCurrent = true;
      } finally {
        if (changed) reloadChangedCredentials(shared);
      }
    });
    connectionUpdate = update.catch(() => {});
    return update;
  }

  // `readConnections` returns the host's saved connections. Without it, a changed
  // account needs a new server.
  async function ensure(selected, start, readConnections = null) {
    await sharedProcessStop;
    if (failedStartup) await stop("opencode-startup-cleanup");
    if (sharedProcess) {
      const recorded = sharedProcess.connections.get(selected?.modelProviderId);
      const current = !selected || sameConnection(recorded, selected);
      if (current || (readConnections && inPlaceConnection(recorded, selected))) {
        const probe = AbortSignal.timeout(1_000);
        let healthy = false;
        try {
          await sharedProcess.server.client.health({ signal: probe });
          healthy = true;
        } catch (error) {
          // A slow probe is not proof that the shared server stopped working.
          if (probe.aborted) throw error;
          await stop("opencode-health-check-failed");
        }
        if (healthy && sharedProcess) {
          if (readConnections && (!current || !sharedProcess.connectionsCurrent)) await updateConnections(readConnections);
          return sharedProcess;
        }
      } else {
        await stop("opencode-connection-changed");
      }
    }
    if (sharedProcessStart) return sharedProcessStart;
    sharedProcessStart = Promise.resolve().then(async () => {
      const { connections, server } = await start();
      const started = {
        connections: new Map(connections.map(connection => [connection.modelProviderId, connectionRecord(connection)])),
        connectionsCurrent: true, directories: new Map(), generation: 0, server
      };
      sharedProcess = started;
      // An unexpected exit retires the server's leftovers at once.
      void server.unexpectedExit?.then(() => sharedProcess === started ? stop("opencode-server-exited") : null)
        .catch(() => {});
      for (const target of processes.values()) {
        target.server = openCodeServerForDirectory(server, target.workdir);
        target.upstream = null;
        target.upstreamSelection = null;
      }
      return sharedProcess;
    }).catch(error => {
      // readable-check: allow method-probe - optional operation: a startup failure carries retryCleanup only when it kept a process to stop
      if (error.cleanupFailed && typeof error.retryCleanup === "function") failedStartup = error;
      throw error;
    });
    try {
      return await sharedProcessStart;
    } finally {
      sharedProcessStart = null;
    }
  }

  // Native storage inventory and retirement borrow the shared server; they are
  // not users that keep it running. A short idle after the last read lets one
  // maintenance pass share it, then it stops unless a conversation uses it.
  async function withStorageProcess(start, operation, failure = error => { throw error; }) {
    clearTimeout(storageIdle);
    storageIdle = null;
    storageReads += 1;
    try {
      return await operation(await ensure(null, start).catch(failure));
    } finally {
      storageReads -= 1;
      if (storageReads === 0 && !closed) {
        storageIdle = setTimeout(() => {
          storageIdle = null;
          if (storageReads === 0 && processes.size === 0 && processStarts.size === 0) {
            stop("opencode-storage-read-finished").catch(() => null);
          }
        }, storageIdleMs);
        storageIdle.unref();
      }
    }
  }

  function targetFor(key, prepared) {
    const current = processes.get(key);
    const nativeId = prepared.upstreamSessionId;
    if (current && current.upstreamSessionId !== nativeId) {
      current.upstreamSessionId = nativeId;
      current.upstream = null;
    }
    if (
      current && !current.abortController.signal.aborted &&
      current.canonicalUrl === prepared.connection.canonicalUrl &&
      current.connectionFingerprint === prepared.connection.fingerprint &&
      current.endpointCode === prepared.connection.endpointCode &&
      current.modelProviderId === prepared.connection.modelProviderId &&
      current.projectContextRoot === prepared.projectContextRoot &&
      current.workdir === prepared.workdir &&
      normalizeNullableText(current.selection?.catalogRevision) === normalizeNullableText(prepared.selection.catalogRevision) &&
      sameOpenCodeSelection(current.selection, prepared.selection)
    ) {
      current.helperModelId = prepared.helperModelId;
      current.server = openCodeServerForDirectory(prepared.server, prepared.workdir);
      return current;
    }
    const server = openCodeServerForDirectory(prepared.server, prepared.workdir);
    const created = (current && !current.abortController.signal.aborted ? current : null) || {
      abortController: new AbortController(),
      key,
      sessionId: prepared.sessionId,
      upstreamSessionId: nativeId
    };
    Object.assign(created, {
      helperModelId: prepared.helperModelId,
      canonicalUrl: prepared.connection.canonicalUrl,
      connectionFingerprint: prepared.connection.fingerprint,
      endpointCode: prepared.connection.endpointCode,
      modelProviderId: prepared.connection.modelProviderId,
      projectContextRoot: prepared.projectContextRoot,
      selection: prepared.selection,
      server,
      workdir: prepared.workdir
    });
    return created;
  }

  async function acquire(key, prepare, onFailure = async () => {}) {
    const pending = processStarts.get(key);
    if (pending) return pending;
    const start = Promise.resolve().then(async () => {
      const target = await prepare();
      processes.set(key, target);
      return target;
    }).catch(async error => {
      if (processStarts.get(key) === start) processStarts.delete(key);
      if (!processes.has(key)) {
        await onFailure();
        if (processes.size === 0 && processStarts.size === 0 && storageReads === 0 && !failedStartup) {
          await stop("opencode-session-start-failed").catch(() => null);
        }
      }
      throw error;
    });
    processStarts.set(key, start);
    try {
      return await start;
    } finally {
      if (processStarts.get(key) === start) processStarts.delete(key);
    }
  }

  async function release(target, { retainSharedProcess = false, onRemoved = ignoreTargetRemoval } = {}) {
    if (processes.get(target.key) === target) {
      processes.delete(target.key);
      await onRemoved();
    }
    return !retainSharedProcess && processes.size === 0 && processStarts.size === 0 && storageReads === 0
      ? stop()
      : { exited: true, sharedProcessRetained: true };
  }

  async function releaseTarget(target, { retainSharedProcess = false, onRemoved } = {}) {
    const activeThreads = new Set();
    // A turn the server's shutdown stops carries that mark: its observer
    // leaves the turn's end to the next server, which records it interrupted,
    // since the native abort this stop causes is not the turn's failure.
    const stopping = turn => {
      if (closed) turn.stoppedByShutdown = true;
    };
    const mainTurn = turns.get(target.key);
    if (mainTurn?.active) {
      stopping(mainTurn);
      activeThreads.add(target.upstreamSessionId);
    }
    for (const entry of temporaryConversations.values()) {
      if (entry.active && entry.target?.abortController === target.abortController) {
        stopping(entry);
        activeThreads.add(entry.conversationId);
      }
    }
    for (const threadId of activeThreads) await stopUnobservedSession(target, threadId);
    target.abortController.abort();
    turns.get(target.key)?.admission?.resolve();
    await monitors.get(target.key)?.catch(() => null);
    await Promise.all([...temporaryConversations.values()]
      .filter((entry) => entry.target?.abortController === target.abortController)
      .map((entry) => entry.completion?.catch(() => null)));
    return release(target, { retainSharedProcess, onRemoved });
  }

  async function releaseProcessTarget(target = null, { retainSharedProcess = false } = {}, application) {
    if (!target) {
      return { exited: true };
    }
    await application.beforeRelease(target);
    const proof = await releaseTarget(target, {
      retainSharedProcess,
      onRemoved: () => application.onRemoved(target)
    }).catch(application.failure);
    if (target.sessionId) {
      processExitProofs.set(target.sessionId, proof);
    }
    return proof;
  }

  async function closeSession(id, options, application) {
    const terminalClose = await application.closeTerminals();
    const pending = [...processStarts.entries()]
      .filter(([key]) => key.endsWith(`\0${id}`))
      .map(([, start]) => start.catch(() => null));
    await Promise.all(pending);
    const targets = [...processes.values()].filter((target) => target.sessionId === id);
    const proofs = await Promise.all(targets.map((target) => releaseProcessTarget(target, options, application)));
    await application.afterRelease();
    for (const key of [...turns.keys()]) {
      if (key.endsWith(`\0${id}`)) {
        turns.delete(key);
      }
    }
    for (const key of [...temporaryConversations.keys()]) {
      if (temporaryConversations.get(key)?.target?.sessionId === id) {
        temporaryConversations.delete(key);
      }
    }
    const result = {
      closed: targets.length,
      ok: proofs.every((proof) => proof?.exited !== false),
      processExitProof: proofs.at(-1) || processExitProofs.get(id) || { exited: true },
      processExitProofs: proofs
    };
    return {
      ...result,
      closed: result.closed + Number(terminalClose?.closed || 0),
      ok: terminalClose?.ok !== false && result.ok
    };
  }

  async function closeProject(input = {}, application) {
    await Promise.all([...processStarts.entries()]
      .filter(([key]) => key.includes("\0"))
      .map(([, start]) => start.catch(() => null)));
    const projectContextRoot = normalizeNullableText(input.projectContextRoot);
    const targets = [...processes.values()].filter((target) => (
      application.ownsTarget(target) && (!projectContextRoot || target.projectContextRoot === path.resolve(projectContextRoot))
    ));
    const results = await Promise.all(targets.map((target) => releaseProcessTarget(target, {}, application)));
    if (processes.size === 0 && storageReads === 0 && (sharedProcess || failedStartup)) {
      results.push(await stop(normalizeNullableText(input.reason) || "opencode-project-close").catch(application.failure));
    }
    return {
      closed: results.length,
      ok: results.every((result) => result?.exited !== false)
    };
  }

  async function invalidateRuntimes(input = {}, preparation) {
    if (normalizeNullableText(input.reason) === "server-shutdown") {
      closed = true;
      clearTimeout(storageIdle);
      storageIdle = null;
    }
    const application = preparation.release;
    // readable-check: allow method-probe - input validation: a connection change carries the publication of the application's saved connections
    if (typeof input.publish === "function") {
      // readable-check: allow method-probe - input validation: a connection change requires the application's saved connections
      if (typeof preparation.connections !== "function") {
        throw new TypeError("OpenCode connection changes require the host's saved connections.");
      }
      // Running turns, retained conversations and the shared server continue.
      // The server takes the saved connections at once, and each directory
      // reloads them as soon as it has no turn in flight.
      // readable-check: allow optional-call - optional operation: an application's release owner may refuse a connection change before it is published
      await application.assertConnectionChange?.();
      await input.publish();
      const update = () => updateConnections(preparation.connections).catch(() => null);
      void sharedProcessStart?.then(update, () => null);
      await update();
      return { closed: 0, ok: true };
    }
    await Promise.all([...processStarts.entries()]
      .filter(([key]) => key.includes("\0"))
      .map(([, start]) => start.catch(() => null)));
    const targets = [...processes.values()].filter(target => application.ownsTarget(target));
    const results = await Promise.all(targets.map((target) => releaseProcessTarget(target, {}, application)));
    if (processes.size === 0 && processStarts.size === 0 && (sharedProcess || failedStartup)) {
      results.push(await stop(normalizeNullableText(input.reason) || "opencode-runtime-invalidation").catch(application.failure));
    }
    return {
      closed: results.length,
      ok: results.every((result) => result?.exited !== false)
    };
  }

  async function closePreparedSession(prepared) {
    return closeSession(prepared.sessionId, prepared.options, prepared.application);
  }

  async function releaseRenewalPredecessorProcessExitProof(preparation) {
    const closed = await closePreparedSession(preparation.cleanup);
    const released = releaseProcessExitProof(preparation.sessionId);
    return {
      ...closed,
      ...released,
      ok: closed.ok !== false && released.ok !== false
    };
  }

  function releaseProcessExitProof(id) {
    const proof = processExitProofs.get(id) || null;
    processExitProofs.delete(id);
    return {
      ok: Boolean(proof?.exited),
      processExitProof: proof,
      released: Boolean(proof?.exited)
    };
  }

  async function startPreparedProcess(prepared) {
    const server = await prepared.create(prepared.options);
    return { connections: prepared.connections, server };
  }

  async function acquirePrepared(prepared) {
    return acquire(prepared.key, async () => {
      const configured = await prepared.configure();
      const shared = await ensure(prepared.connection,
        async () => startPreparedProcess(await configured.prepareServer()),
        async () => (await configured.prepareServer()).connections).catch(prepared.failure);
      configured.target.server = shared.server;
      return targetFor(prepared.key, configured.target);
    }, prepared.onFailure).catch(prepared.failure);
  }

  async function stopUnobservedSession(target, threadId) {
    const signal = AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS);
    try {
      const confirmed = await target.server.client.interrupt(threadId, { signal });
      const status = await target.server.client.sessionStatus(threadId, { signal });
      if (confirmed !== true || status?.type !== "idle") {
        throw new Error("OpenCode did not confirm that the session stopped.");
      }
    } catch (error) {
      // The process owns the final stop proof when its control channel cannot.
      // Stop this exact server, even if another connection has since replaced it.
      const server = target.server;
      const proof = sharedProcess?.server.stop === server.stop
        ? await stop("opencode-observation-lost")
        : await server.stop();
      if (proof?.exited !== true) {
        throw new Error("OpenCode observation was lost and process exit could not be verified.", { cause: error });
      }
      for (const affected of processes.values()) {
        if (affected.server.stop === server.stop) {
          affected.abortController.abort(new Error("OpenCode's shared service was stopped after observation failed. Send a message to continue."));
        }
      }
    }
  }

  return Object.freeze({
    get current() { return sharedProcess; },
    get closed() { return closed; },
    get cleanupPending() { return Boolean(failedStartup); },
    stop,
    ensure,
    withStorageProcess,
    currentDirectory,
    directoryCurrent,
    waitForDirectory,
    holdDirectory,
    admitDirectory,
    stopUnobservedSession,
    targetFor,
    acquire,
    acquirePrepared,
    startPreparedProcess,
    release,
    releaseTarget,
    releaseProcessTarget,
    closeSession,
    closeProject,
    invalidateRuntimes,
    releaseRenewalPredecessorProcessExitProof,
    releaseProcessExitProof
  });
}

/** @typedef {ReturnType<typeof createOpenCodeProcessOwner>} OpenCodeProcessOwner */
