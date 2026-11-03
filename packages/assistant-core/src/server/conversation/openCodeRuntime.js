import { projectOpenCodeConversationMessages } from "./openCodeTurn.js";
import { ensureOpenCodeSession } from "./openCodeNativeSession.js";
import { createOpenCodeProcessOwner } from "./openCodeProcessOwner.js";
import { createOpenCodeTemporaryConversations } from "./openCodeTemporaryConversations.js";
import {
  createOpenCodeTurnMonitor, openCodeProviderApiFailure, openCodeTurnSnapshot, writeConversationProjection
} from "./openCodeTurnMonitor.js";
import { createOpenCodeSessionTurns } from "./openCodeSessionTurns.js";
import { normalizeNullableText } from "./normalize.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const text = normalizeNullableText;
// One runtime per scope directory: the native server it owns is shared by the
// whole process.
const sharedRuntimes = new Map();

/** A stop of the shared server that no one observes. */
function ignoreRuntimeStop() {}

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

/**
 * The production provider's users and pending acquisitions share this owner.
 * Hosts supply authorized startup inputs and their own publication/cleanup work.
 * @param {{
 *   onStop?: (stop: { reason: string, sessions: number, startingSessions: number }) => void,
 *   scope?: string,
 *   storageIdleMs?: number
 * }} options
 */
export function createOpenCodeSharedRuntime({ onStop = ignoreRuntimeStop, scope, storageIdleMs = 60_000 }) {
  if (scope !== undefined && !path.isAbsolute(scope)) throw new TypeError("OpenCode runtime scopes require an absolute directory.");
  if (scope && sharedRuntimes.has(scope)) return sharedRuntimes.get(scope);
  const processes = new Map();
  const processStarts = new Map();
  const monitors = new Map();
  const turns = new Map();
  const temporaryConversations = new Map();
  const bindingScopes = new Map();
  let registryPath = "";
  let bindingWrite = Promise.resolve();
  const processOwner = createOpenCodeProcessOwner({
    processes,
    processStarts,
    monitors,
    turns,
    temporaryConversations,
    onStop,
    storageIdleMs
  });
  const conversations = createOpenCodeTemporaryConversations({ processes, temporaryConversations, processOwner });
  const turnMonitor = createOpenCodeTurnMonitor({ processes, monitors, turns, processOwner });
  const sessionTurns = createOpenCodeSessionTurns({ processes, monitors, turns, processOwner, turnMonitor });

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
    return processOwner.acquirePrepared(await preparation.process());
  }

  async function ensurePreparedTerminal(preparation) {
    const target = await acquirePreparedTerminal(preparation);
    // The native terminal starts its own turns there.
    await processOwner.currentDirectory(target.workdir);
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
    processes,
    processStarts,
    monitors,
    turns,
    temporaryConversations,
    get current() { return processOwner.current; },
    get closed() { return processOwner.closed; },
    get cleanupPending() { return processOwner.cleanupPending; },
    acquire: processOwner.acquire,
    targetFor: processOwner.targetFor,
    ensure: processOwner.ensure,
    withStorageProcess: processOwner.withStorageProcess,
    release: processOwner.release,
    releaseTarget: processOwner.releaseTarget,
    releaseProcessTarget: processOwner.releaseProcessTarget,
    closeSession: processOwner.closeSession,
    closeProject: processOwner.closeProject,
    startPreparedProcess: processOwner.startPreparedProcess,
    acquirePrepared: processOwner.acquirePrepared,
    createPreparedConversation: conversations.createPreparedConversation,
    runPreparedRenewalTurn: sessionTurns.runPreparedRenewalTurn,
    selectPreparedConversation: conversations.selectPreparedConversation,
    existingPreparedConversation: conversations.existingPreparedConversation,
    runPreparedConversationTurn: conversations.runPreparedConversationTurn,
    readPreparedConversation: conversations.readPreparedConversation,
    waitPreparedConversationTurn: conversations.waitPreparedConversationTurn,
    stopPreparedConversation: conversations.stopPreparedConversation,
    deletePreparedConversation: conversations.deletePreparedConversation,
    sendPreparedMessage: sessionTurns.sendPreparedMessage,
    inspectPreparedMessage: sessionTurns.inspectPreparedMessage,
    interruptPreparedTurn: sessionTurns.interruptPreparedTurn,
    invalidateRuntimes: processOwner.invalidateRuntimes,
    releaseRenewalPredecessorProcessExitProof: processOwner.releaseRenewalPredecessorProcessExitProof,
    releaseProcessExitProof: processOwner.releaseProcessExitProof,
    stop: processOwner.stop,
    stopUnobservedSession: processOwner.stopUnobservedSession,
    interruptTurn: sessionTurns.interruptTurn,
    ensurePreparedSessionReadiness: sessionTurns.ensurePreparedSessionReadiness,
    inspectSessionReadiness: sessionTurns.inspectSessionReadiness,
    recoverSessionReadiness: sessionTurns.recoverSessionReadiness,
    needsObservationRecovery: sessionTurns.needsObservationRecovery,
    recoverObservation: sessionTurns.recoverObservation,
    createConversation: conversations.createConversation,
    selectConversation: conversations.selectConversation,
    existingConversation: conversations.existingConversation,
    runConversationTurn: conversations.runConversationTurn,
    readConversation: conversations.readConversation,
    readPersistentConversation: conversations.readPersistentConversation,
    waitForConversationTurn: conversations.waitForConversationTurn,
    stopConversation: conversations.stopConversation,
    deleteConversation: conversations.deleteConversation,
    sendMessage: sessionTurns.sendMessage,
    hasActiveTemporaryConversation: conversations.hasActiveTemporaryConversation,
    reconcileSessions: sessionTurns.reconcileSessions,
    reconcilePreparedSession: sessionTurns.reconcilePreparedSession,
    recordStoppedObservation: sessionTurns.recordStoppedObservation,
    beginMessageMonitor: turnMonitor.beginMessageMonitor,
    beginMonitor: turnMonitor.beginMonitor,
    writeBindings,
    writeConversationProjection,
    readFinalAssistantResult: turnMonitor.readFinalAssistantResult,
    projectConversationMessages: projectOpenCodeConversationMessages,
    readSessionState,
    startPreparedTerminal,
    attachTerminal,
    closeTerminal,
    allowTerminalAttachments,
    turnSnapshot: openCodeTurnSnapshot,
    providerApiFailure: openCodeProviderApiFailure
  });
  if (scope) sharedRuntimes.set(scope, runtime);
  return runtime;
}
