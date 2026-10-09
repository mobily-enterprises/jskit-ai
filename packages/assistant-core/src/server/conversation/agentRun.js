import { isPlainObject, normalizeText } from "./normalize.js";
import { createReentrantConversationStorage } from "./storage.js";
import { normalizeCodexAppServerRunState, codexAppServerRunStateIsActive,
  codexAppServerRunStateIsTerminal } from "./codexTurn.js";

const normalizeRunState = state => normalizeCodexAppServerRunState(normalizeText(state));
const runStateIsActive = state => codexAppServerRunStateIsActive(normalizeText(state));
const runStateIsTerminal = state => codexAppServerRunStateIsTerminal(normalizeText(state));

export function conversationAgentRunRecord(record, normalizedRunId, {
  normalizeState = normalizeRunState,
  isActive = runStateIsActive
} = {}) {
  return isPlainObject(record)
    ? {
        ...record,
        active: isActive(record.state),
        events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
        id: normalizedRunId,
        state: normalizeState(record.state)
      }
    : null;
}

export function conversationAgentRunEvent(previous, normalizedRunId, {
  event = {},
  patch = {}
} = {}, {
  now = () => new Date(),
  normalizeState = normalizeRunState,
  isTerminal = runStateIsTerminal
} = {}) {
  const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
  const state = normalizeState(patch.state || event.state || previous.state);
  const terminalState = isTerminal(state);
  const eventRecord = {
    ...event,
    at: eventAt,
    kind: normalizeText(event.kind || state || "updated"),
    message: normalizeText(event.message || patch.message),
    state
  };
  const record = {
    ...previous,
    ...patch,
    active: !terminalState,
    events: [
      ...(Array.isArray(previous.events) ? previous.events : []),
      eventRecord
    ],
    finishedAt: terminalState
      ? normalizeText(patch.finishedAt || previous.finishedAt) || eventAt
      : "",
    id: normalizedRunId,
    startedAt: normalizeText(previous.startedAt || patch.startedAt) || eventAt,
    state,
    updatedAt: eventAt
  };
  if (!terminalState && !Object.hasOwn(patch, "error")) {
    record.error = "";
  }
  return record;
}

/** The original native run occupies its bound conversation segment. Reading a
 * binding without a run never constructs historical ownership or writes state.
 */
export function createCodexConversationRunStore({ storage, scope, segmentId, isCurrent, clock = () => new Date() } = {}) {
  if (typeof isCurrent !== "function") throw new TypeError("A native run store requires its provider ownership fence.");
  storage = createReentrantConversationStorage(storage);
  const runId = "codex_app_server";

  function assertScope(sessionId, requestedRunId = runId) {
    if (sessionId !== scope) throw new Error("The native run belongs to another conversation.");
    if (normalizeText(requestedRunId) !== runId) throw new TypeError("This binding stores only its Codex app-server run.");
    if (!isCurrent()) throw new Error("A retired provider cannot change a native binding.");
  }

  async function currentMetadata(transaction) {
    const metadata = await transaction.readMetadata();
    if (!isCurrent() || metadata.runtime?.segmentId !== segmentId || metadata.runtime?.engine !== "codex") {
      throw new Error("A retired native conversation cannot change the current binding.");
    }
    return metadata;
  }

  async function readAgentRun(sessionId, requestedRunId) {
    assertScope(sessionId, requestedRunId);
    return storage.read(scope, async transaction => {
      const metadata = await currentMetadata(transaction);
      return conversationAgentRunRecord(metadata.runtime.binding?.codexAppServerRun, runId);
    });
  }

  function mutateSession(sessionId, operation) {
    assertScope(sessionId);
    return storage.write(scope, async transaction => {
      await currentMetadata(transaction);
      return operation(transaction);
    });
  }

  return Object.freeze({
    readAgentRun,
    mutateSession,
    async getSession(sessionId) {
      const run = await readAgentRun(sessionId, runId);
      return { sessionId, agentRuns: run ? [run] : [] };
    },
    async writeAgentRunEvent(sessionId, requestedRunId, input = {}) {
      assertScope(sessionId, requestedRunId);
      return mutateSession(sessionId, async transaction => {
        const previous = await readAgentRun(sessionId, runId) || { events: [], id: runId };
        const record = conversationAgentRunEvent(previous, runId, input, { now: clock });
        const metadata = await currentMetadata(transaction);
        metadata.runtime.binding.codexAppServerRun = record;
        await transaction.writeMetadata(metadata);
        return record;
      });
    }
  });
}

/** The native owner uses the existing transcript and transient streams through
 * the same fenced transaction as its original run. Its private delivery read is
 * a projection of the one authored request, never another stored journal.
 */
export function createCodexConversationStore({ storage, scope, segmentId, isCurrent, transcript, streams } = {}) {
  const runStore = createCodexConversationRunStore({ storage, scope, segmentId, isCurrent });
  const assertCurrent = sessionId => {
    if (sessionId !== scope || !isCurrent()) throw new Error("A retired provider cannot change this conversation.");
  };
  const reader = name => (sessionId, ...args) => {
    assertCurrent(sessionId);
    return transcript[name](sessionId, ...args);
  };
  async function nativeAuthorship(transaction, identity) {
    if (!identity?.threadId || !identity.turnId) return undefined;
    const { runtime } = await transaction.readMetadata();
    const run = runtime.binding?.codexAppServerRun;
    if (runtime.segmentId !== segmentId || runtime.binding.threadId !== identity.threadId ||
        run?.providerThreadId !== identity.threadId || run.providerTurnId !== identity.turnId || !run.outerTurnId) return undefined;
    for (const turnId of (await transaction.listTurnIds()).reverse()) {
      const turn = await transaction.readTurn(turnId);
      if (turn?.metadata?.runtime?.segmentId !== segmentId) continue;
      if (turn.user?.messageId === run.outerTurnId) return { origin: "user", messageId: run.outerTurnId, turnId };
      if (turn.system?.messageId === run.outerTurnId && turn.system.origin === "application") {
        return { origin: "application", messageId: run.outerTurnId, turnId };
      }
    }
    const request = runtime.request;
    if (request?.messageId === run.outerTurnId && ["user", "application"].includes(request.origin)) {
      return { origin: request.origin, messageId: request.messageId };
    }
    return undefined;
  }
  const writer = name => (sessionId, input) => runStore.mutateSession(sessionId, async transaction => {
    const written = await transcript[name](sessionId, input);
    if (!written || written.metadata?.runtime?.segmentId) return written;
    const origin = (await nativeAuthorship(transaction, input.nativeIdentity))?.origin;
    await transaction.updateTurnMetadata(written.turnId, { runtime: {
      status: "complete", engine: "codex", segmentId, ...(origin ? { origin } : {}),
      ...(input.nativeIdentity?.turnId ? { nativeTurnId: input.nativeIdentity.turnId } : {})
    } });
    return transaction.readTurn(written.turnId);
  });
  return Object.freeze({
    ...runStore,
    readConversationLog: reader("readConversationLog"),
    conversationMessageIdExists: reader("conversationMessageIdExists"),
    writeConversationAssistantMessage: writer("writeConversationAssistantMessage"),
    writeConversationCommentaryMessage: writer("writeConversationCommentaryMessage"),
    writeConversationThinkingMessage: writer("writeConversationThinkingMessage"),
    upsertConversationAssistantMessage: writer("upsertConversationAssistantMessage"),
    async writeConversationUserMessage(sessionId, input = {}) {
      return runStore.mutateSession(sessionId, async transaction => {
        if (input.messageId && await transaction.hasMessage(input.messageId)) return null;
        const metadata = await transaction.readMetadata();
        const request = input.authoredRequest?.messageId === input.messageId ? input.authoredRequest
          : metadata.runtime.request?.messageId === input.messageId ? metadata.runtime.request : null;
        if (!request) {
          const written = await transcript.writeConversationUserMessage(sessionId, input);
          if (!written) return null;
          await transaction.updateTurnMetadata(written.turnId, { runtime: {
            status: "running", engine: "codex", segmentId, origin: "user",
            ...(input.nativeIdentity?.turnId ? { nativeTurnId: input.nativeIdentity.turnId } : {})
          } });
          return transaction.readTurn(written.turnId);
        }
        const turnId = await transaction.nextTurnId();
        await transaction.appendMessage(turnId, {
          role: request.origin === "application" ? "system" : "user",
          messageId: request.messageId, text: request.text, origin: request.origin || "user",
          attachments: request.attachments || input.attachments || [], at: request.at || new Date().toISOString(),
          ...(request.data !== undefined ? { data: request.data } : {}), ...(request.goal ? { goal: request.goal } : {}),
          turnMetadata: { ...input.turnMetadata, runtime: { ...input.turnMetadata?.runtime,
            status: "running", engine: "codex", segmentId, origin: request.origin || "user",
            ...(input.nativeIdentity?.turnId ? { nativeTurnId: input.nativeIdentity.turnId } : {}),
            ...(request.goal ? { goalMessageId: request.messageId } : {}) } }
        });
        return transaction.readTurn(turnId);
      });
    },
    readMetadataValue(sessionId, key) {
      assertCurrent(sessionId);
      if (key !== "assistant_delivery") throw new Error("The native conversation requested unknown delivery metadata.");
      return storage.read(sessionId, async transaction => {
        const { runtime } = await transaction.readMetadata();
        if (!isCurrent() || runtime.segmentId !== segmentId || runtime.engine !== "codex") {
          throw new Error("A retired native conversation cannot read current delivery metadata.");
        }
        const request = runtime.request;
        return JSON.stringify({ engines: { codex: { pending: request && { ...request,
          displayMessage: request.displayMessage ?? request.text,
          displayAttachments: request.displayAttachments ?? request.attachments } } } });
      });
    },
    updateConversationStream(sessionId, input) {
      return runStore.mutateSession(sessionId, async transaction => {
        const authorship = await nativeAuthorship(transaction, input.nativeIdentity);
        return streams.update(sessionId, { ...input, origin: authorship?.origin, authorship });
      });
    },
    completeConversationStreamMessage(sessionId, messageId, options) {
      assertCurrent(sessionId);
      if (options?.nativeIdentity) return runStore.mutateSession(sessionId, async transaction => {
        const authorship = await nativeAuthorship(transaction, options.nativeIdentity);
        return streams.complete(sessionId, messageId, { ...options, authorship,
          ...(!authorship ? { text: undefined } : {}) });
      });
      return streams.complete(sessionId, messageId, options);
    },
    clearConversationStream(sessionId) { assertCurrent(sessionId); return streams.clear(sessionId); }
  });
}
