import {
  OPENCODE_INTERRUPT_TIMEOUT_MS, waitForOpenCodeFinalResponse, openCodeLastAssistantResult, inspectOpenCodeMessageAdmission, observeOpenCodeEvents,
  openCodeMessageRows, openCodeRowsForInput, openCodePersistentConversationMessages, openCodeStructuredOutput, projectOpenCodeConversationMessages, waitForOpenCodeMessages, steerOpenCodeTurn, dispatchOpenCodeTurn, observeOpenCodeTurnCompletion, runOpenCodeConversationTurn
} from "./openCodeTurn.js";
import { openCodeAssistantMessageText as assistantMessageText } from "./openCodeClient.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const text = value => String(value ?? "").trim();
const sharedRuntimes = new Map();

function openCodeTurnSnapshot(turn = null, threadId = "") {
  const source = turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  const active = source.active === true;
  return active || text(source.id)
    ? {
        active,
        error: text(source.error),
        id: text(source.id),
        phase: active && !source.observationError ? text(source.phase) : "",
        startedAt: text(source.startedAt),
        state: text(source.state) || (active ? "active" : "completed"),
        status: source.observationError ? "observation_lost" : text(source.state) || (active ? "active" : "completed"),
        threadId: text(source.threadId || threadId),
        updatedAt: text(source.updatedAt)
      }
    : null;
}

function openCodeCredentialFailure(value = "") {
  const failure = text(value);
  return (
    /\b(?:401|403)\b/u.test(failure) ||
    (
      /(?:api[-_\s]?key|authentication|authorization|credential|access[-_\s]?token|unauthori[sz]ed|forbidden)/iu.test(failure) &&
      /(?:denied|expired|failed|forbidden|incorrect|invalid|missing|rejected|revoked|unauthori[sz]ed)/iu.test(failure)
    )
  );
}

function openCodeProviderApiFailure(error = {}) {
  return text(error?.name) === "APIError";
}


export function assertOpenCodeModelProvider(selected, input = {}) {
  if (selected?.modelProviderId && input.model?.providerID !== selected.modelProviderId) {
    throw new Error("Assistants must use the session's selected AI account.");
  }
}

export function limitOpenCodeModelOutput(input = {}, output = {}) {
  const advertisedOutputTokenLimit = input.model?.limit?.output;
  const supportedOutputTokenLimit = (
    Number.isSafeInteger(advertisedOutputTokenLimit) && advertisedOutputTokenLimit > 0
  ) ? advertisedOutputTokenLimit : 32_000;
  if (Number.isSafeInteger(output.maxOutputTokens) && output.maxOutputTokens > supportedOutputTokenLimit) {
    output.maxOutputTokens = supportedOutputTokenLimit;
  }
}

export async function readOpenCodeEnvironments(registryPath = "") {
  if (!registryPath) return [];
  const source = JSON.parse(await readFile(registryPath, "utf8"));
  return Array.isArray(source?.sessions) ? source.sessions : [];
}

function pathContains(root = "", candidate = "") {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function openCodeEnvironmentForDirectory(environments, cwd = "") {
  const normalizedCwd = path.resolve(text(cwd) || process.cwd());
  return environments
    .filter(entry => text(entry?.workdir) && pathContains(path.resolve(entry.workdir), normalizedCwd))
    .sort((left, right) => path.resolve(right.workdir).length - path.resolve(left.workdir).length)[0] || null;
}

export async function openCodeEnvironmentForSession(environments, sessionId = "", client = null) {
  const visited = new Set();
  let id = text(sessionId);
  while (id && !visited.has(id) && visited.size < 32) {
    const selected = environments.find(entry => text(entry?.upstreamSessionId) === id);
    if (selected) return selected;
    if (!client) return null;
    visited.add(id);
    const result = await client.session.get({ path: { id } });
    if (result.error) throw Object.assign(new Error("The subagent's parent session could not be verified."), {
      code: "assistant_opencode_parent_unverified"
    });
    id = text(result.data?.parentID);
  }
  return null;
}

export function openCodeServerForDirectory(server = {}, workdir = "") {
  return Object.freeze({
    ...server,
    client: typeof server.client?.forDirectory === "function"
      ? server.client.forDirectory(workdir)
      : server.client
  });
}

export function openCodeModel(selection = {}, executionProfile = null) {
  const modelId = text(executionProfile?.model) || text(selection.modelId);
  const variantId = executionProfile
    ? text(executionProfile.thinking)
    : text(selection.variantId);
  return {
    id: modelId,
    providerID: text(selection.modelProviderId),
    ...(variantId ? { variant: variantId } : {})
  };
}

export function sameOpenCodeSelection(left = {}, right = {}) {
  return ["agentId", "modelId", "modelProviderId", "variantId"]
    .every((name) => text(left?.[name]) === text(right?.[name]));
}

/** Native selection and identity publication share the same pending operation. */
export async function ensureOpenCodeSession(target, { selection, model, workdir = target.workdir, identity = {}, signal,
  invalidIdentity = () => new Error("OpenCode did not return a native conversation ID.") }) {
  if (target.upstreamStart) {
    return target.upstreamStart;
  }
  const start = Promise.resolve().then(async () => {
    await target.server.client.prepareDirectory({ signal });
    let upstream = (
      target.upstream &&
      sameOpenCodeSelection(target.upstreamSelection, selection)
    ) ? target.upstream : null;
    if (!upstream && target.upstreamSessionId) {
      upstream = await target.server.client.readSession(target.upstreamSessionId, { signal });
      await target.server.client.switchModel(target.upstreamSessionId, model, { signal });
      await target.server.client.switchAgent(target.upstreamSessionId, selection.agentId, { signal });
    } else if (!upstream) {
      upstream = await target.server.client.createSession({
        agent: selection.agentId,
        location: { directory: workdir },
        model
      }, { signal });
    }
    const nativeId = text(upstream?.id);
    if (!nativeId) {
      throw invalidIdentity();
    }
    await identity.write?.(nativeId);
    target.upstreamSessionId = nativeId;
    target.upstream = upstream;
    target.upstreamSelection = { ...selection };
    await identity.publish?.(nativeId);
    return target;
  });
  target.upstreamStart = start;
  try {
    return await start;
  } finally {
    if (target.upstreamStart === start) {
      delete target.upstreamStart;
    }
  }
}

// The production provider's users and pending acquisitions share this owner.
// Hosts supply authorized startup inputs and their own publication/cleanup work.
export function createOpenCodeSharedRuntime({ onStop = () => {}, scope } = {}) {
  if (scope !== undefined && !path.isAbsolute(scope)) throw new TypeError("OpenCode runtime scopes require an absolute directory.");
  if (scope && sharedRuntimes.has(scope)) return sharedRuntimes.get(scope);
  const processes = new Map();
  const processStarts = new Map();
  const monitors = new Map();
  const turns = new Map();
  const temporaryConversations = new Map();
  const processExitProofs = new Map();
  let sharedProcess = null;
  let sharedProcessStart = null;
  let sharedProcessStop = null;
  let failedStartup = null;
  let closed = false;
  const bindingScopes = new Map();
  let registryPath = "";
  let bindingWrite = Promise.resolve();

  function writeBindings(filename, scope, entries) {
    if (!path.isAbsolute(filename || "") || registryPath && registryPath !== filename) {
      throw new TypeError("An OpenCode runtime requires one absolute private binding registry path.");
    }
    registryPath = filename;
    if (entries.length) bindingScopes.set(scope, entries);
    else bindingScopes.delete(scope);
    const writing = bindingWrite.then(async () => {
      await mkdir(path.dirname(registryPath), { mode: 0o700, recursive: true });
      const temporaryPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify({
        sessions: [...bindingScopes.values()].flat()
      })}\n`, { mode: 0o600 });
      await rename(temporaryPath, registryPath);
    });
    bindingWrite = writing.catch(() => {});
    return writing;
  }

  async function stop(reason = "opencode-last-session-closed") {
    if (sharedProcessStop) return sharedProcessStop;
    const target = sharedProcess;
    const startup = failedStartup;
    if (!target && !startup) return { exited: true, reason };
    onStop({ reason, sessions: processes.size, startingSessions: processStarts.size });
    const stopping = (async () => {
      const proof = startup ? await startup.retryCleanup() : await target.server.stop();
      if (proof?.exited !== true) {
        throw Object.assign(new Error("OpenCode process exit could not be verified."), {
          code: "assistant_opencode_stop_unverified", details: {}, statusCode: 503
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

  async function ensure(selected, start) {
    await sharedProcessStop;
    if (failedStartup) await stop("opencode-startup-cleanup");
    if (sharedProcess) {
      const currentConnection = sharedProcess.connections.get(selected?.modelProviderId);
      if (!selected || (
        currentConnection?.canonicalUrl === selected.canonicalUrl &&
        currentConnection?.fingerprint === selected.fingerprint &&
        currentConnection?.endpointCode === selected.endpointCode
      )) {
        try {
          await sharedProcess.server.client.health({ signal: AbortSignal.timeout(1_000) });
          return sharedProcess;
        } catch {
          await stop("opencode-health-check-failed");
        }
      } else {
        await stop("opencode-connection-changed");
      }
    }
    if (sharedProcessStart) return sharedProcessStart;
    sharedProcessStart = Promise.resolve().then(async () => {
      const { connections, server } = await start();
      sharedProcess = {
        connections: new Map(connections.map(connection => [
          connection.modelProviderId,
          { canonicalUrl: connection.canonicalUrl, endpointCode: connection.endpointCode, fingerprint: connection.fingerprint }
        ])),
        server
      };
      for (const target of processes.values()) {
        target.server = openCodeServerForDirectory(server, target.workdir);
        target.upstream = null;
        target.upstreamSelection = null;
      }
      return sharedProcess;
    }).catch(error => {
      if (error.cleanupFailed && typeof error.retryCleanup === "function") failedStartup = error;
      throw error;
    });
    try {
      return await sharedProcessStart;
    } finally {
      sharedProcessStart = null;
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
      text(current.selection?.catalogRevision) === text(prepared.selection.catalogRevision) &&
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
        if (processes.size === 0 && processStarts.size === 0 && !failedStartup) {
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

  async function release(target, { retainSharedProcess = false, onRemoved } = {}) {
    if (processes.get(target.key) === target) {
      processes.delete(target.key);
      await onRemoved?.();
    }
    return !retainSharedProcess && processes.size === 0 && processStarts.size === 0
      ? stop()
      : { exited: true, sharedProcessRetained: true };
  }

  async function releaseTarget(target, { retainSharedProcess = false, onRemoved } = {}) {
    const activeThreads = new Set();
    if (turns.get(target.key)?.active) activeThreads.add(target.upstreamSessionId);
    for (const entry of temporaryConversations.values()) {
      if (entry.active && entry.target?.abortController === target.abortController) {
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
    const projectContextRoot = text(input.projectContextRoot);
    const targets = [...processes.values()].filter((target) => (
      application.ownsTarget(target) && (!projectContextRoot || target.projectContextRoot === path.resolve(projectContextRoot))
    ));
    const results = await Promise.all(targets.map((target) => releaseProcessTarget(target, {}, application)));
    if (processes.size === 0 && (sharedProcess || failedStartup)) {
      results.push(await stop(text(input.reason) || "opencode-project-close").catch(application.failure));
    }
    return {
      closed: results.length,
      ok: results.every((result) => result?.exited !== false)
    };
  }

  async function invalidateRuntimes(input = {}, preparation) {
    if (text(input.reason) === "server-shutdown") {
      closed = true;
    }
    const application = preparation.release;
    await Promise.all([...processStarts.entries()]
      .filter(([key]) => key.includes("\0"))
      .map(([, start]) => start.catch(() => null)));
    const targets = [...processes.values()].filter(target => application.ownsTarget(target));
    const results = await Promise.all(targets.map((target) => releaseProcessTarget(target, {}, application)));
    if (processes.size === 0 && processStarts.size === 0 && (sharedProcess || failedStartup)) {
      results.push(await stop(text(input.reason) || "opencode-runtime-invalidation").catch(application.failure));
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
        async () => startPreparedProcess(await configured.prepareServer())).catch(prepared.failure);
      configured.target.server = shared.server;
      return targetFor(prepared.key, configured.target);
    }, prepared.onFailure).catch(prepared.failure);
  }

  function scopedTarget(target, prepared) {
    const workdir = prepared.workdir;
    return workdir ? { ...target, server: openCodeServerForDirectory(target.server, workdir), workdir } : target;
  }

  async function runPreparedRenewalTurn(preparation) {
    const acquired = await acquirePrepared(await preparation.process());
    const target = await ensureOpenCodeSession(acquired, preparation.session());
    const turn = preparation.turn(target);
    const result = await runOpenCodeConversationTurn(target.server.client, target.upstreamSessionId, turn.input, {
      ...turn.options,
      ...(turn.release ? { close: () => releaseProcessTarget(target, {}, turn.release) } : {})
    });
    return turn.completeResult(result);
  }

  async function createPreparedConversation(prepared) {
    const target = scopedTarget(await acquirePrepared(prepared.process), prepared);
    const conversation = await createConversation(prepared.key, target, prepared.selection(), prepared.executionProfile);
    return { conversationId: conversation.id, ephemeral: prepared.ephemeral, ok: true, status: "ready" };
  }

  async function selectPreparedConversation(prepared) {
    const target = scopedTarget(await acquirePrepared(prepared.process), prepared);
    const selection = prepared.selection();
    const conversationId = selection.conversationId;
    const previous = conversationId ? temporaryConversations.get(`${prepared.key}\0${conversationId}`) : null;
    if (selection.scoped && previous && JSON.stringify(previous.executionProfile || null) !== JSON.stringify(prepared.executionProfile)) {
      throw selection.profileChanged();
    }
    if (!conversationId && !selection.createIfMissing) throw selection.identityRequired();
    const selected = await selectConversation(prepared.key, target, conversationId, selection.input, selection.registration);
    return { ...selected, executionProfile: prepared.executionProfile, target };
  }

  async function existingPreparedConversation(prepared) {
    return { conversationId: prepared.conversationId, ...await existingConversation(
      prepared.key, prepared.conversationId, prepared.persistent,
      async () => acquirePrepared(await prepared.process())
    ) };
  }

  async function runPreparedConversationTurn(prepared) {
    const selected = await selectPreparedConversation(prepared);
    const turn = prepared.turn(selected);
    return runConversationTurn(selected.target, selected.conversationId, selected.tracked,
      turn.input, turn.options).catch(prepared.failure);
  }

  async function readPreparedConversation(prepared, input) {
    const { conversationId, target, tracked } = await existingPreparedConversation(prepared);
    if (!target) throw prepared.readUnavailable();
    if (!input.persistent) return prepared.projectResult(
      await readConversation(target, conversationId, tracked, {}, prepared.readError), tracked?.executionProfile);
    return readPersistentConversation(target, conversationId, tracked, prepared.messages).catch(prepared.failure);
  }

  async function waitPreparedConversationTurn(prepared, input) {
    const { conversationId, target, tracked } = await existingPreparedConversation(prepared);
    if (!target) throw prepared.readUnavailable();
    return waitForConversationTurn(target, conversationId, tracked, input, prepared.readError);
  }

  async function stopPreparedConversation(prepared, input) {
    const { conversationId, target, tracked } = await existingPreparedConversation(prepared);
    return stopConversation(target, conversationId, tracked, { persistent: input.persistent }).catch(prepared.failure);
  }

  async function deletePreparedConversation(prepared, input) {
    const { conversationId, key, target, tracked } = await existingPreparedConversation(prepared);
    const result = await deleteConversation(key, target, conversationId, tracked, {
      allowMissing: Boolean(input.persistent || prepared.scoped), onRemoved: prepared.onRemoved
    });
    if (!result.deleted) return result;
    const cleanup = prepared.cleanupAfterDelete;
    const providerExit = cleanup ? await closeSession(cleanup.sessionId, cleanup.options, cleanup.application) : null;
    return { conversationId, deleted: true, ok: providerExit?.ok !== false,
      ...(providerExit ? { providerExit } : {}) };
  }

  async function sendPreparedMessage(prepared, options) {
    if (Object.hasOwn(prepared, "value")) return prepared.value;
    return prepared.project(await sendMessage(prepared.key, prepared.input, options, prepared.application));
  }

  async function inspectPreparedMessage(prepared) {
    const target = await acquirePrepared(prepared.process);
    const observation = await inspectOpenCodeMessageAdmission(target.server.client, prepared.threadId, prepared.inputMessageId);
    return prepared.project(observation);
  }

  async function interruptPreparedTurn(prepared) {
    const target = processes.get(prepared.key) || null;
    return interruptTurn(prepared.key, target, {
      threadId: target ? "" : prepared.threadId, writeRun: prepared.writeRun
    }).catch(prepared.failure);
  }

  function observePreparedEvents(target, turn, abortController, signal, projection) {
    const observation = observeOpenCodeEvents(target.server.client, target.upstreamSessionId, {
      abortController, signal,
      eventStartedAt: turn ? turn.eventStartedAt : null,
      readError: projection.readError,
      onEvent: summary => projection.onEvent(summary, target)
    });
    void observation.completion.then(() => {
      projection.failure(observation.readFailure());
      projection.closed();
    });
    return {
      close: observation.close,
      readFailure: observation.readFailure,
      waitUntilReady(options) {
        const ready = observation.waitUntilReady(options);
        void ready.catch(projection.failure);
        return ready;
      }
    };
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

  async function createConversation(key, target, input, executionProfile = null) {
    await target.server.client.prepareDirectory({ signal: target.abortController?.signal });
    const conversation = await target.server.client.createSession({
      agent: input.agent,
      location: { directory: target.workdir },
      model: input.model
    });
    temporaryConversations.set(`${key}\0${conversation.id}`, {
      active: false,
      executionProfile,
      target
    });
    return conversation;
  }

  async function selectConversation(parentKey, target, conversationId, input, registration) {
    await target.server.client.prepareDirectory({ signal: target.abortController?.signal });
    if (!conversationId) {
      const created = await target.server.client.createSession({
        agent: input.agent,
        location: { directory: target.workdir },
        model: input.model
      });
      conversationId = created.id;
    } else {
      await target.server.client.switchModel(conversationId, input.model);
      await target.server.client.switchAgent(conversationId, input.agent);
    }
    const key = `${parentKey}\0${conversationId}`;
    const tracked = temporaryConversations.get(key) || { active: false, target };
    tracked.target = target;
    tracked.executionProfile = registration.executionProfile;
    tracked.conversationId = conversationId;
    tracked.promptContext = registration.promptContext;
    temporaryConversations.set(key, tracked);
    await registration.onSelected();
    return { conversationId, key, tracked };
  }

  async function existingConversation(parentKey, conversationId, persistent, prepareTarget) {
    const key = `${parentKey}\0${conversationId}`;
    let tracked = temporaryConversations.get(key) || null;
    let target = tracked?.target || processes.get(parentKey) || null;
    if (persistent && (!target || target.abortController.signal.aborted)) {
      temporaryConversations.delete(key);
      tracked = null;
      target = await prepareTarget();
    }
    return { key, tracked, target };
  }

  async function readConversation(target = {}, conversationId = "", tracked = null, options = {}, readError) {
    const messages = await target.server.client.messages(conversationId, {
      limit: 100,
      order: "desc"
    }, options);
    options.signal?.throwIfAborted();
    const result = openCodeLastAssistantResult(messages, { readError });
    return {
      conversationId,
      error: text(tracked?.error?.message) || result.error,
      ok: !tracked?.error && !result.error,
      runId: tracked?.inputMessageId || "",
      status: tracked?.active ? "inProgress"
        : tracked?.interrupted ? "interrupted"
        : tracked?.error || result.error ? "failed" : "completed",
      text: result.text
    };
  }

  async function readPersistentConversation(target, conversationId, tracked, projection) {
    const { readError } = projection;
    let status = await target.server.client.sessionStatus(conversationId);
    if (!tracked && status.type !== "idle") {
      await stopUnobservedSession(target, conversationId);
      status = { type: "idle" };
    }
    const rows = openCodeMessageRows(await target.server.client.messages(conversationId));
    const result = openCodeLastAssistantResult(rows, { readError });
    const messages = openCodePersistentConversationMessages(rows, projection.messageId);
    let conversationStatus = "completed";
    if (status.type !== "idle" || tracked?.active) conversationStatus = "inProgress";
    else if (tracked?.interrupted) conversationStatus = "interrupted";
    else if (tracked?.error || result.error) conversationStatus = "failed";
    return {
      conversationId,
      ok: true,
      messages,
      text: result.text,
      admitted: Boolean(projection.inputMessageId && rows.some((row) => row.id === projection.inputMessageId)),
      error: text(tracked?.error?.message) || result.error,
      runId: tracked?.inputMessageId || [...rows].reverse().find((row) => row.type === "user")?.id || "",
      status: conversationStatus
    };
  }

  async function waitForConversationTurn(target, conversationId, tracked, input = {}, readError) {
    if (tracked?.completion && (tracked.executionProfile || !input.timeoutMs)) {
      return tracked.completion;
    }
    await waitForOpenCodeMessages(target.server.client, conversationId, tracked?.inputMessageId || "", {
      signal: input.timeoutMs ? AbortSignal.timeout(Number(input.timeoutMs)) : undefined,
      readError
    });
    return readConversation(target, conversationId, null, {}, readError);
  }

  async function runConversationTurn(target, conversationId, tracked, input, options) {
    if (tracked.active && tracked.error) {
      await stopUnobservedSession(tracked.target, conversationId);
      tracked.active = false;
    }
    if (tracked.active && input.steer === true) {
      const messageId = input.steeringId;
      await steerOpenCodeTurn(target.server.client, conversationId, tracked, {
        agent: input.agent,
        id: messageId,
        model: input.model,
        prompt: input.prompt,
        attachments: input.attachments
      }, { signal: AbortSignal.any([target.abortController.signal, tracked.abortController.signal]) });
      return {
        conversationId,
        ok: true,
        runId: tracked.inputMessageId,
        status: "inProgress",
        deliveryMode: "steer"
      };
    }
    if (tracked.active) {
      throw Object.assign(new Error("This conversation is still working."), {
        code: "assistant_opencode_conversation_busy", details: {}, statusCode: 409
      });
    }
    tracked.active = true;
    tracked.error = null;
    tracked.interrupted = false;
    const turnAbort = new AbortController();
    tracked.abortController = turnAbort;
    const inputMessageId = input.id;
    const observedTarget = { ...target, upstreamSessionId: conversationId };
    const signal = AbortSignal.any([target.abortController.signal, turnAbort.signal, ...(options.signal ? [options.signal] : [])]);
    const events = options.observation
      ? observePreparedEvents(observedTarget, null, turnAbort, signal, options.observation())
      : options.observe(observedTarget, turnAbort, signal);
    let admitted;
    try {
      admitted = await dispatchOpenCodeTurn(null, null, tracked, {
        get agent() { return input.agent; },
        id: inputMessageId,
        get model() { return input.model; },
        get prompt() { return input.prompt; },
        get attachments() { return input.attachments; }
      }, {
        get client() { return target.server.client; },
        get conversationId() { return conversationId; },
        events, signal,
        readiness: options.readiness,
        beforeDispatch: options.beforeDispatch
      });
    } catch (error) {
      await events.close();
      tracked.error = error;
      if (tracked.promptAttempted) await stopUnobservedSession(observedTarget, conversationId);
      tracked.active = false;
      throw error;
    }
    tracked.inputMessageId = text(admitted.id);
    tracked.completion = (async () => {
      const completion = options.completion;
      const onMessages = completion.onMessages;
      const result = await observeOpenCodeTurnCompletion(runtime, observedTarget, conversationId, tracked, {
        ...completion, events, signal,
        ...(onMessages ? {
          onMessages: (messages, inputMessageId) => onMessages(
            openCodePersistentConversationMessages(openCodeRowsForInput(messages, inputMessageId), completion.messageId),
            inputMessageId
          )
        } : {}),
        projectResult: async () => {
          const result = completion.projectResult(
            await readConversation(target, conversationId, null, { signal }, completion.readError)
          );
          return { ...result, text: input.outputSchema ? openCodeStructuredOutput(result.text) : result.text };
        }
      });
      if (result.interrupted) {
        return { conversationId, ok: true, runId: tracked.inputMessageId, status: "interrupted", text: "" };
      }
      return result;
    })();
    // Keep a failed admitted turn observable to the client's conversation reads.
    void tracked.completion.catch((error) => {
      if (tracked.abortController === turnAbort) tracked.error = error;
    });
    options.onCompletion(tracked.completion);
    return options.waitForCompletion ? tracked.completion : {
      conversationId,
      ok: true,
      runId: tracked.inputMessageId,
      status: "inProgress",
      threadId: conversationId,
      turnId: tracked.inputMessageId
    };
  }

  async function stopConversation(target, conversationId, tracked, { persistent = false } = {}) {
    if (!target) {
      return { conversationId, ok: true, stopped: false };
    }
    try {
      if (tracked?.active && tracked.error) {
        await stopUnobservedSession(target, conversationId);
      } else {
        const confirmed = await target.server.client.interrupt(conversationId, {
          signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
        });
        const status = persistent ? await target.server.client.sessionStatus(conversationId, {
          signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
        }) : null;
        if (confirmed !== true || status && status.type !== "idle") {
          throw Object.assign(new Error("OpenCode did not confirm Stop. Try Stop again."), {
            code: "assistant_opencode_interrupt_unconfirmed", details: {}, statusCode: 502
          });
        }
      }
    } catch (error) {
      if (persistent && error.statusCode === 404) return { conversationId, ok: true, stopped: true };
      if (error?.name === "TimeoutError") {
        throw Object.assign(new Error("OpenCode did not confirm Stop within 5 seconds. Try Stop again."), {
          code: "assistant_opencode_interrupt_timeout", details: {}, statusCode: 504
        });
      }
      throw error;
    }
    if (tracked) {
      tracked.interrupted = true;
      tracked.abortController?.abort();
      await tracked.completion?.catch(() => null);
      tracked.active = false;
    }
    return { conversationId, ok: true, stopped: true };
  }

  async function deleteConversation(key, target, conversationId, tracked, { allowMissing, onRemoved }) {
    if (!target) {
      temporaryConversations.delete(key);
      await onRemoved();
      return { conversationId, deleted: false, ok: true };
    }
    try {
      await target.server.client.deleteSession(conversationId);
    } catch (error) {
      if (!allowMissing || error.statusCode !== 404) throw error;
    }
    if (tracked) {
      tracked.interrupted = true;
      tracked.abortController?.abort();
      await tracked.completion?.catch(() => null);
    }
    temporaryConversations.delete(key);
    await onRemoved();
    return { conversationId, deleted: true, ok: true };
  }

  async function writeConversationProjection(sessionId, messages = null, {
    inputMessageId = "",
    streaming = false
  } = {}, projection) {
    let failure = "";
    let providerApiFailure = false;
    const rows = (inputMessageId
      ? openCodeRowsForInput(messages, inputMessageId)
      : openCodeMessageRows(messages)).filter((message) => message?.type === "assistant");
    for (const [index, message] of rows.entries()) {
      failure ||= projection.readError(message);
      providerApiFailure ||= openCodeProviderApiFailure(message.error);
      if (message.summary === true) continue;
      const assistantText = assistantMessageText(message);
      const messageId = assistantText ? projection.messageId(message.id, "assistant") : "";
      const outputId = assistantText ? projection.outputId?.(message.id, "assistant") : "";
      const inFlight = streaming && index === rows.length - 1;
      const reasoning = (message.content || []).filter((part) => part.type === "reasoning" && text(part.text))
        .map((part) => ({
          messageId: message.id,
          partId: part.id,
          text: part.text,
          createdAt: message.time?.created,
          complete: Boolean(part.time?.end)
        }));
      await projection.reasoning(reasoning, {
        complete: !inFlight || Boolean(message.time?.completed || message.finish),
        flush: !streaming || Boolean(assistantText && !inFlight)
      });
      if (streaming && assistantText && !inFlight) {
        // A completed round persists as soon as the next one starts, so
        // superseded narration never evaporates from the transcript.
        const turn = await projection.store.writeConversationAssistantMessage(sessionId, {
          messageId,
          ...(outputId ? { outputId } : {}),
          text: assistantText
        });
        projection.store.completeConversationStreamMessage(sessionId, messageId);
        await projection.publishTurn(turn);
        continue;
      }
      if (streaming && assistantText && inFlight) {
        const conversationStream = projection.store.updateConversationStream(sessionId, {
          turnId: inputMessageId,
          messageId,
          ...(outputId ? { outputId } : {}),
          text: assistantText
        });
        if (conversationStream) {
          await projection.publishStream(conversationStream);
        }
        continue;
      }
      if (assistantText && !streaming) {
        const turn = await projection.store.writeConversationAssistantMessage(sessionId, {
          messageId,
          ...(outputId ? { outputId } : {}),
          text: assistantText
        });
        projection.store.completeConversationStreamMessage(sessionId, messageId);
        await projection.publishTurn(turn);
      }
    }
    return { failure, providerApiFailure };
  }

  async function sendMessage(key, input, options, application) {
    if (input.duplicate) {
      const currentTurn = openCodeTurnSnapshot(turns.get(key));
      return {
        delivered: true,
        duplicate: true,
        ok: true,
        thread: { id: currentTurn?.threadId || input.threadId },
        turn: currentTurn
      };
    }
    const currentTurn = turns.get(key);
    if (currentTurn?.observationError) {
      await monitors.get(key);
    }
    if (currentTurn?.active && currentTurn.observationError) {
      // An explicit Send may retry stopping uncertain work, but cannot overlap it.
      try {
        await stopUnobservedSession(processes.get(key), currentTurn.threadId);
      } catch (error) {
        return { failure: { error, recovery: true } };
      }
      currentTurn.active = false;
      currentTurn.state = "interrupted";
      await application.writeRun(currentTurn, "interrupted", currentTurn.observationError);
    }
    let currentMonitor = monitors.get(key);
    let currentThreadId = input.threadId;
    const ownershipMatchesTurn = Boolean(
      currentMonitor &&
      options.turnOwnership &&
      text(options.turnOwnership.threadId) === currentThreadId &&
      text(options.turnOwnership.turnId) === text(currentTurn?.id)
    );
    if (ownershipMatchesTurn && options.turnOwnership.reusable !== true) {
      return { ownerConflict: true, threadId: currentThreadId,
        turn: openCodeTurnSnapshot(currentTurn, currentThreadId) };
    }
    const eventStartedAt = Date.now();
    const startedAt = new Date(eventStartedAt).toISOString();
    const providerMessageId = input.id;
    const startingTurn = currentMonitor
      ? null
      : {
          active: true,
          error: "",
          eventStartedAt,
          id: providerMessageId,
          inputMessageId: providerMessageId,
          startedAt,
          state: "starting",
          threadId: currentThreadId,
          updatedAt: startedAt
        };
    if (startingTurn) {
      turns.set(key, startingTurn);
      await application.writeRun(startingTurn, "starting");
    }
    let admitted = null;
    let target = null;
    let admission = null;
    let dispatchTurn = null;
    let dispatchMonitor = null;
    let previousInputMessageId = null;
    let previousAdmission;
    try {
      const preparation = await application.prepare({ overwrite: !currentMonitor, threadId: currentThreadId });
      const preparedTarget = preparation.process ? await acquirePrepared(preparation.process) : preparation.target;
      target = await ensureOpenCodeSession(preparedTarget, preparation.session);
      currentThreadId = target.upstreamSessionId;
      if (startingTurn) {
        startingTurn.threadId = currentThreadId;
      }
      const prompt = await application.prompt();
      // Preparation can outlive the preceding turn's final projection. Do not
      // attach a new input to a monitor that has already claimed retirement.
      currentMonitor = monitors.get(key);
      if (currentMonitor && !turns.get(key)?.active) {
        await currentMonitor;
        currentMonitor = monitors.get(key);
      }
      admission = Promise.withResolvers();
      // The observer may be between polls when dispatch or persistence fails.
      // Keep the raw promise rejectable without an unhandled rejection.
      void admission.promise.catch(() => {});
      let eventReady = null;
      if (currentMonitor) {
        dispatchTurn = turns.get(key);
        previousInputMessageId = dispatchTurn.inputMessageId;
        previousAdmission = dispatchTurn.admission;
        dispatchTurn.admission = admission;
        dispatchTurn.inputMessageId = providerMessageId;
        dispatchTurn.updatedAt = new Date().toISOString();
        dispatchMonitor = currentMonitor;
      } else {
        eventReady = Promise.withResolvers();
        dispatchMonitor = beginMessageMonitor(key, target, { id: providerMessageId, eventStartedAt, startedAt }, {
          ...options, admission, eventReady
        }, application.monitor);
        dispatchTurn = turns.get(key);
      }
      admitted = await dispatchOpenCodeTurn(null, null, dispatchTurn, {
        get agent() { return prompt.agent; },
        delivery: currentMonitor ? "steer" : "queue",
        id: providerMessageId,
        get model() { return prompt.model; },
        get prompt() { return prompt.prompt; },
        get attachments() { return prompt.attachments; }
      }, {
        get client() { return target.server.client; },
        get conversationId() { return target.upstreamSessionId; },
        events: eventReady ? { waitUntilReady: () => eventReady.promise } : null,
        get signal() {
          return AbortSignal.any([
            target.abortController.signal,
            turns.get(key).abortController.signal
          ]);
        },
        beforeDispatch: () => prompt.beforeDispatch(target.upstreamSessionId),
        promptTimeoutMs: options.promptTimeoutMs,
        authorizeAttachments: prompt.authorizeAttachments
      });
    } catch (error) {
      const rejected = error?.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408;
      const retainPreviousInput = previousInputMessageId !== null &&
        (dispatchTurn?.promptAttempted !== true || rejected);
      if (retainPreviousInput) {
        if (dispatchTurn.admission === admission && dispatchTurn.inputMessageId === providerMessageId) {
          dispatchTurn.inputMessageId = previousInputMessageId;
          dispatchTurn.admission = previousAdmission;
        }
        admission.resolve();
      } else {
        // Attempted unknown admission must retain the new input and use the
        // same observer's original Stop/error recovery, never roll back to A.
        admission?.reject(error);
        dispatchTurn?.abortController?.abort(error);
      }
      if (rejected) await input.onPromptRejected?.();
      if (admission && !retainPreviousInput) await dispatchMonitor;
      if (startingTurn && !admission && !monitors.has(key)) {
        startingTurn.active = false;
        startingTurn.error = text(error?.message) || "OpenCode prompt delivery failed.";
        startingTurn.state = "failed";
        startingTurn.updatedAt = new Date().toISOString();
        await application.writeRun(
          startingTurn,
          "failed",
          startingTurn.error
        ).catch(() => null);
      }
      return { failure: { error, attempted: dispatchTurn?.promptAttempted === true, threadId: currentThreadId,
        turn: openCodeTurnSnapshot(turns.get(key) || startingTurn, currentThreadId) } };
    }
    if (dispatchTurn.admission === admission && dispatchTurn.inputMessageId === providerMessageId) {
      dispatchTurn.inputMessageId = text(admitted.id);
      dispatchTurn.updatedAt = new Date().toISOString();
    }
    let conversationTurn;
    try {
      conversationTurn = await application.commit(admitted);
    } catch (error) {
      admission.reject(error);
      dispatchTurn.abortController.abort(error);
      // Preserve the persistence error while joining the original recovery.
      await dispatchMonitor.catch(() => null);
      throw error;
    }
    admission.resolve();
    const turn = openCodeTurnSnapshot(turns.get(key), target.upstreamSessionId);
    return {
      conversationTurn,
      delivered: true,
      deliveryMode: currentMonitor ? "steer" : "new_turn",
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn,
      workdir: input.workdir
    };
  }

  function hasActiveTemporaryConversation(sessionId) {
    return [...temporaryConversations.values()].some((entry) => (
      !entry.reasoningSummary && entry.active === true && entry.target?.sessionId === sessionId
    ));
  }

  async function reconcileSessions(sessions = [], options = {}, preparation) {
    const results = [];
    for (const session of sessions) {
      const sessionId = text(session?.sessionId || session?.id);
      try {
        const prepared = await preparation.session(sessionId, session, options);
        const resumed = await reconcilePreparedSession(prepared, prepared.activeRun, options);
        results.push({ ok: true, resumed, sessionId });
      } catch (error) {
        results.push({ error: text(error?.message), ok: false, sessionId });
      }
    }
    return {
      failed: results.filter((result) => result.ok === false),
      ok: results.every((result) => result.ok),
      results,
      sessionCount: results.length
    };
  }

  async function reconcilePreparedSession(prepared, activeRun, options) {
    const target = await acquirePrepared(await prepared.process());
    const current = await ensureOpenCodeSession(target, prepared.session());
    return reconcileSessionTurn(prepared.key, current, activeRun, options, prepared.observation).catch(prepared.failure);
  }

  async function reconcileSessionTurn(key, target, activeRun, options, application) {
    if (activeRun?.observationError) {
      await stopUnobservedSession(target, activeRun.threadId);
      await application.writeRun({ ...activeRun, id: activeRun.turnId }, "interrupted", activeRun.observationError);
    } else if (activeRun) {
      beginMessageMonitor(key, target, {
        restored: true,
        eventStartedAt: Date.parse(text(activeRun.startedAt)) || Date.now(),
        id: text(activeRun.turnId) || application.fallbackTurnId,
        startedAt: text(activeRun.startedAt)
      }, options, application.monitor);
    }
    return Boolean(activeRun && !activeRun.observationError);
  }

  function beginMessageMonitor(key, target, admitted, options, projection) {
    target = { ...target };
    const existing = monitors.get(key);
    if (existing) {
      return existing;
    }
    const metadata = projection.prepare(admitted, options);
    const eventStartedAt = Number(admitted.eventStartedAt) || Date.now();
    const startedAt = text(admitted.startedAt) || new Date(eventStartedAt).toISOString();
    const turn = {
      abortController: new AbortController(),
      admission: options.admission,
      active: true,
      error: "",
      eventStartedAt,
      id: text(admitted.id),
      inputMessageId: text(admitted.id),
      startedAt,
      state: options.admission ? "starting" : "active",
      ...metadata.fields,
      threadId: target.upstreamSessionId,
      updatedAt: startedAt
    };
    const monitor = beginMonitor(key, target, turn, projection.create(target, turn, metadata, options));
    void monitor.catch(error => projection.onError(error));
    return monitor;
  }

  function beginMonitor(key, target, turn, {
    observe, observation, eventReady, readiness, finalResponse,
    writeRun, projectMessages, completeResult, onRetired
  }) {
    turns.set(key, turn);
    const signal = AbortSignal.any([target.abortController.signal, turn.abortController.signal]);
    const monitor = Promise.resolve().then(async () => {
      const events = observation
        ? observePreparedEvents(target, turn, turn.abortController, signal, observation())
        : observe(turn, signal);
      if (eventReady) {
        void events.waitUntilReady(readiness).then(eventReady.resolve, eventReady.reject);
      }
      let finalState = "completed";
      let failure = "";
      let credentialFailure = false;
      let providerApiFailure = false;
      try {
        await turn.admission?.promise;
        signal.throwIfAborted();
        turn.state = "active";
        await writeRun(turn, "active");
        for (;;) {
          const completion = await waitForOpenCodeFinalResponse(
            target.server.client,
            target.upstreamSessionId,
            turn,
            {
              ...finalResponse,
              // Preserve the reasoning-only completion before the native recovery
              // input replaces the projection boundary. Replayed writes are no-ops.
              beforeRecovery: async completion => {
                await projectMessages(completion.messages, { inputMessageId: completion.inputMessageId });
                await finalResponse.beforeRecovery?.(completion);
              },
              onMessages: async (messages, inputMessageId) => {
                const latest = openCodeLastAssistantResult(messages, { readError: finalResponse.readError }).message;
                const phase = latest?.summary === true && Number(latest.time?.created) >= turn.eventStartedAt &&
                  !latest.time?.completed && !latest.finish && !latest.error ? "compacting" : "";
                if (turn.active && !signal.aborted && text(turn.phase) !== phase) {
                  turn.phase = phase;
                  turn.updatedAt = new Date().toISOString();
                  await writeRun(turn, turn.state);
                }
                return projectMessages(messages, { inputMessageId, streaming: true });
              },
              readFailure: events.readFailure,
              signal
            }
          );
          const admission = turn.admission;
          await admission?.promise;
          signal.throwIfAborted();
          if (admission !== turn.admission || completion.inputMessageId !== text(turn.inputMessageId)) {
            continue;
          }
          const projection = await projectMessages(completion.messages, {
            inputMessageId: completion.inputMessageId
          });
          await turn.admission?.promise;
          signal.throwIfAborted();
          if (admission !== turn.admission || completion.inputMessageId !== text(turn.inputMessageId)) {
            continue;
          }
          failure = projection.failure || text(events.readFailure()?.message);
          providerApiFailure = projection.providerApiFailure || openCodeProviderApiFailure(events.readFailure());
          if (!failure && !turn.interruptRequested && !text(completion.result?.text)) {
            failure = "OpenCode finished without a user-facing final response. Please send your message again.";
            finalState = "failed";
          } else if (failure) {
            credentialFailure = openCodeCredentialFailure(failure);
            finalState = "failed";
          } else if (turn.interruptRequested) {
            finalState = "interrupted";
          }
          break;
        }
      } catch (error) {
        if (turn.interruptAcknowledged) {
          finalState = "interrupted";
        } else {
          const cause = signal.aborted ? signal.reason : error;
          failure = text(cause?.message) || "OpenCode turn failed.";
          credentialFailure = openCodeCredentialFailure(failure);
          providerApiFailure = openCodeProviderApiFailure(cause);
          finalState = target.abortController.signal.aborted
            ? "cancelled"
            : "failed";
          if (!target.abortController.signal.aborted) {
            turn.observationError = failure;
            try {
              await writeRun(turn, turn.state, failure);
            } catch {
              // A failed store must not prevent stopping native work.
            }
            try {
              await stopUnobservedSession(target, turn.threadId);
            } catch (stopError) {
              failure = `${failure} ${stopError.message}`;
              finalState = "active";
            }
          }
        }
      } finally {
        // Claim retirement before awaited cleanup/checkpointing. A new Send
        // joins this monitor's cleanup instead of steering an unobserved turn.
        turn.active = finalState === "active";
        await events.close();
        if (credentialFailure || finalState === "failed") {
          failure = await completeResult(turn, { credentialFailure, providerApiFailure, finalState, failure });
        }
        turn.error = failure;
        turn.state = finalState;
        turn.updatedAt = new Date().toISOString();
        await writeRun(turn, finalState, failure).catch(() => null);
      }
      return openCodeTurnSnapshot(turn, target.upstreamSessionId);
    }).finally(() => {
      if (monitors.get(key) === monitor) {
        monitors.delete(key);
      }
      onRetired();
    });
    monitors.set(key, monitor);
    return monitor;
  }

  async function ensurePreparedSessionReadiness(prepared) {
    if (Object.hasOwn(prepared, "value")) return prepared.value;
    let target = processes.get(prepared.key);
    const connection = await prepared.connection();
    const { ready, unhealthyProcess, missingUpstream } = await inspectSessionReadiness(target, {
      selection: prepared.selection, workdir: prepared.workdir, connection,
      changed: prepared.changed, refresh: prepared.refresh
    });
    if (!ready) {
      const { value: recovered } = await prepared.prepare(recovery => recoverSessionReadiness(target, {
        unhealthyProcess, missingUpstream,
        get key() { return recovery.key; }
      }, async () => {
        const configuration = recovery.configuration();
        async function ensureProcess() {
          return acquirePrepared(await configuration.process());
        }
        const current = await ensureProcess();
        return ensureOpenCodeSession(current, configuration.session);
      }));
      if (recovered?.ok === false) return recovered;
      target = recovered;
    }
    const savedRun = prepared.observation.run;
    if (needsObservationRecovery(prepared.key, savedRun)) {
      await prepared.observation.write(async (run, commit) => {
        if (!needsObservationRecovery(prepared.key, run)) return;
        const threadId = text(run.threadId) || target.upstreamSessionId;
        await recoverObservation(target, threadId, () => commit(writeRun => (
          recordStoppedObservation(prepared.key, run, threadId, writeRun)
        )));
      });
    }
    return {
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn: openCodeTurnSnapshot(turns.get(prepared.key), target.upstreamSessionId),
      workdir: prepared.workdir
    };
  }

  async function inspectSessionReadiness(target, { selection, workdir, connection, refresh, changed }) {
    let ready = false;
    let unhealthyProcess = null;
    let missingUpstream = false;
    if (
      target?.upstream &&
      sameOpenCodeSelection(target.upstreamSelection, selection) &&
      target.workdir === workdir &&
      text(target.selection?.catalogRevision) === text(selection.catalogRevision) &&
      target.connectionFingerprint === connection.fingerprint &&
      target.canonicalUrl === connection.canonicalUrl &&
      target.endpointCode === connection.endpointCode
    ) {
      const observedProcess = sharedProcess;
      const observedServer = target.server;
      let healthy = false;
      try {
        await target.server.client.health({ signal: AbortSignal.timeout(1_000) });
        healthy = true;
        ready = Boolean(await target.server.client.readSession(target.upstreamSessionId));
      } catch (error) {
        if (healthy && error?.statusCode !== 404) {
          throw error;
        }
        if (!healthy) {
          unhealthyProcess = observedProcess;
        }
      }
      const current = await refresh();
      if (
        processes.get(current.key) !== target ||
        target.abortController.signal.aborted ||
        target.server !== observedServer ||
        target.workdir !== current.workdir ||
        !sameOpenCodeSelection(target.upstreamSelection, current.selection) ||
        text(target.selection?.catalogRevision) !== text(current.selection.catalogRevision)
      ) {
        throw changed();
      }
      missingUpstream = healthy && !ready;
    }
    return { ready, unhealthyProcess, missingUpstream };
  }

  async function recoverSessionReadiness(target, recovery, prepare) {
    if (recovery.unhealthyProcess && sharedProcess === recovery.unhealthyProcess) {
      await stop("opencode-health-check-failed");
    }
    if (recovery.missingUpstream && processes.get(recovery.key) === target) {
      target.upstream = null;
    }
    return prepare();
  }

  function needsObservationRecovery(key, run) {
    return Boolean(run?.active && run.observationError && !monitors.has(key));
  }

  async function recordStoppedObservation(key, run, threadId, writeRun) {
    const stopped = {
      ...turns.get(key),
      ...run,
      id: text(run.turnId),
      threadId,
      active: false,
      state: "interrupted",
      updatedAt: new Date().toISOString()
    };
    await writeRun(stopped, "interrupted", run.observationError);
    turns.set(key, stopped);
  }

  async function recoverObservation(target, threadId, commit) {
    if (threadId !== target.upstreamSessionId) return;
    const status = await target.server.client.sessionStatus(threadId, {
      signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
    });
    if (status?.type !== "idle") return;
    await commit();
  }

  async function interruptTurn(key, target, { threadId = "", writeRun } = {}) {
    const turn = turns.get(key);
    if (!target) {
      return {
        interrupted: false,
        ok: true,
        thread: { id: threadId },
        turn: openCodeTurnSnapshot(turn)
      };
    }
    if (turn?.observationError) {
      await monitors.get(key);
      if (turn.active) {
        await stopUnobservedSession(target, turn.threadId);
        turn.active = false;
        turn.state = "interrupted";
        await writeRun(turn, turn.state, turn.observationError);
      }
      return { ok: true, interrupted: true, thread: { id: turn.threadId }, turn: openCodeTurnSnapshot(turn) };
    }
    if (turn) {
      turn.interruptRequested = true;
    }
    const interrupted = Boolean(turn?.active);
    try {
      const confirmed = await target.server.client.interrupt(target.upstreamSessionId, {
        signal: AbortSignal.timeout(OPENCODE_INTERRUPT_TIMEOUT_MS)
      });
      if (confirmed !== true) {
        throw Object.assign(new Error("OpenCode did not confirm Stop. Try Stop again."), {
          code: "assistant_opencode_interrupt_unconfirmed", details: {}, statusCode: 502
        });
      }
    } catch (error) {
      if (turn) turn.interruptRequested = false;
      if (error?.name === "TimeoutError") {
        throw Object.assign(new Error("OpenCode did not confirm Stop within 5 seconds. Try Stop again."), {
          code: "assistant_opencode_interrupt_timeout", details: {}, statusCode: 504
        });
      }
      throw error;
    }
    if (turn?.active && turn.abortController) {
      turn.interruptAcknowledged = true;
      turn.abortController.abort();
      turn.admission?.resolve();
      await monitors.get(key);
    }
    return {
      interrupted,
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn: openCodeTurnSnapshot(turn, target.upstreamSessionId)
    };
  }

  async function readSessionState(current, application) {
    const context = await application.context(current);
    const target = processes.get(context.key);
    const threadId = target?.upstreamSessionId ||
      application.storedThreadId(context);
    return {
      ok: true,
      terminal: application.terminalHost.read(context.sessionId, target?.terminalSessionId),
      thread: { id: threadId },
      turn: openCodeTurnSnapshot(turns.get(context.key), threadId),
      workdir: context.workdir
    };
  }

  async function acquirePreparedTerminal(preparation) {
    return acquirePrepared(await preparation.process());
  }

  async function ensurePreparedTerminal(preparation) {
    const target = await acquirePreparedTerminal(preparation);
    return ensureOpenCodeSession(target, preparation.session());
  }

  async function startPreparedTerminal(preparation) {
    const target = await ensurePreparedTerminal(preparation);
    return attachTerminal(target, preparation.context, preparation.terminalHost);
  }

  async function attachTerminal(target, context, terminalHost) {
    const existing = terminalHost.read(context.sessionId, target.terminalSessionId);
    if (existing?.ok === true && existing.status !== "exited") {
      return existing;
    }
    const terminal = await target.server.startAttachedTerminal({
      metadata: {
        engineId: "opencode",
        sessionId: context.sessionId
      },
      namespace: terminalHost.namespace(context.sessionId),
      session: context.session,
      upstreamSessionId: target.upstreamSessionId,
      workdir: context.workdir
    });
    if (terminal?.ok === true && text(terminal.id)) {
      target.terminalSessionId = text(terminal.id);
    }
    return terminal;
  }

  async function closeTerminal(sessionId, terminalSessionId, terminalHost) {
    const id = text(terminalSessionId);
    const result = await terminalHost.close(id, {
      namespace: terminalHost.namespace(sessionId)
    });
    for (const target of processes.values()) {
      if (target.sessionId === sessionId && target.terminalSessionId === id) {
        target.terminalSessionId = "";
      }
    }
    return result;
  }

  function allowTerminalAttachments(sessionId, terminalSessionId, input) {
    const target = [...processes.values()].find((candidate) =>
      candidate.sessionId === sessionId && candidate.terminalSessionId === terminalSessionId);
    if (!target) throw new Error("Reopen the OpenCode terminal before attaching files.");
    return target.server.client.allowConversationAttachments(target.upstreamSessionId, input.attachments);
  }

  const runtime = Object.freeze({
    processes, processStarts, monitors, turns, temporaryConversations,
    get current() { return sharedProcess; },
    get closed() { return closed; },
    get cleanupPending() { return Boolean(failedStartup); },
    acquire, targetFor, ensure, release, releaseTarget, releaseProcessTarget, closeSession, closeProject,
    startPreparedProcess, acquirePrepared, createPreparedConversation, runPreparedRenewalTurn, selectPreparedConversation, existingPreparedConversation,
    runPreparedConversationTurn, readPreparedConversation, waitPreparedConversationTurn, stopPreparedConversation, deletePreparedConversation,
    sendPreparedMessage, inspectPreparedMessage, interruptPreparedTurn,
    invalidateRuntimes, releaseRenewalPredecessorProcessExitProof, releaseProcessExitProof, stop, stopUnobservedSession, interruptTurn,
    ensurePreparedSessionReadiness, inspectSessionReadiness, recoverSessionReadiness, needsObservationRecovery, recoverObservation,
    createConversation, selectConversation, existingConversation, runConversationTurn, readConversation, readPersistentConversation, waitForConversationTurn,
    stopConversation, deleteConversation, sendMessage, hasActiveTemporaryConversation, reconcileSessions, reconcilePreparedSession, recordStoppedObservation, beginMessageMonitor, beginMonitor, writeBindings,
    writeConversationProjection,
    projectConversationMessages: projectOpenCodeConversationMessages,
    readSessionState, startPreparedTerminal, attachTerminal, closeTerminal, allowTerminalAttachments,
    turnSnapshot: openCodeTurnSnapshot, providerApiFailure: openCodeProviderApiFailure
  });
  if (scope) sharedRuntimes.set(scope, runtime);
  return runtime;
}
