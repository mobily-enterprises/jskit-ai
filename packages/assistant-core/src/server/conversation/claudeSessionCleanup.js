import path from "node:path";
import { deleteClaudeConversationHistory } from "./claudeHistory.js";
import { hasPendingClaudeStartup } from "./claudeProcessStart.js";
import { normalizeNullableText } from "./normalize.js";

const ACTIVE_TURN_STATES = ["starting", "active", "finalizing"];

/**
 * Closes what an owner runs: sessions, projects, a connection change's work
 * and the whole owner at shutdown. It knows which sessions are closing and
 * whether the owner itself is.
 * @param {{
 *   entries: Map<string, import("./claudeTurn.js").ClaudeConversationEntry>,
 *   store: import("./claudeTurn.js").ClaudeConversationStore,
 *   configRoot: string,
 *   acquire: (context: Record<string, any>, conversationId?: string, options?: Record<string, any>) => Promise<import("./claudeTurn.js").ClaudeConversationEntry>,
 *   savedState: (saved: string | null, conversationId: string) => Record<string, any>,
 *   holdsNativeWork: (entry: import("./claudeTurn.js").ClaudeConversationEntry) => boolean,
 *   disconnectedMessage: string
 * }} options
 */
export function createClaudeSessionCleanup({
  entries,
  store,
  configRoot,
  acquire,
  savedState,
  holdsNativeWork,
  disconnectedMessage
}) {
  const closingSessions = new Set();
  let closing = false;

  // The owner is closing for shutdown, or the session this context key names is.
  function isClosing(contextKey) {
    return closing || closingSessions.has(contextKey);
  }

  // Reconciliation retires the work an earlier server left, as a session's
  // close does: it reopens only saved custody, then stops each of the
  // session's entries whose execution is unproven. Idle saved conversations
  // stay closed and unwritten.
  async function reconcileSessions(sessions, options = {}, application) {
    const results = [];
    for (const session of sessions) {
      const ctx = await application.readContext({ ...options, session, sessionId: session.sessionId });
      await recoverSavedCustody(ctx);
      await recover([...entries.values()].filter((entry) => entry.context.key === ctx.key));
      results.push({ ok: true, sessionId: session.sessionId, resumed: false });
    }
    return { ok: true, results, failed: [], sessionCount: results.length };
  }

  // A session's close stops what this server runs for it, then reopens only
  // saved custody an earlier server left. Once the owner is closing for an
  // account change or shutdown it reopens nothing.
  async function closeSession(context, application) {
    return closeRetained(await application.readContext(context), application,
      { recover: !closing, forget: context.forgetConversationBinding === true });
  }

  // Renewal proof release ends a session this server no longer uses. Its own
  // close already recovered saved custody while its record could be written.
  async function releaseSession(context, application) {
    return closeRetained(await application.readContext(context), application, { recover: false, forget: true });
  }

  async function closeRetained(ctx, application, { recover: recoverCustody, forget: forgetEntries }) {
    closingSessions.add(ctx.key);
    try {
      if (recoverCustody) await recoverSavedCustody(ctx);
      const proofs = await drain(ctx.key);
      const terminal = await application.terminals.close(ctx.sessionId);
      // A forgotten entry is drained: everything it held is in its saved record.
      if (terminal?.ok !== false && forgetEntries) forget(ctx.key);
      return { ok: terminal?.ok !== false, closed: proofs.length + Number(terminal?.closed || 0),
        processExitProof: proofs.at(-1) || { exited: true, scopeEmpty: true }, processExitProofs: proofs };
    } finally {
      closingSessions.delete(ctx.key);
    }
  }

  // Saved custody an earlier server left: an execution whose exit is still
  // unproven, or a turn saved as active. Only those conversations are reopened,
  // so a verified stop can retire them; idle saved conversations stay closed.
  async function recoverSavedCustody(ctx) {
    let saved = store.readSessionConversations(ctx);
    // readable-check: allow method-probe - data: a store lists a session's conversations synchronously or with a promise
    if (saved && typeof saved.then === "function") saved = await saved;
    for (const conversationId of saved.ids) {
      if (entries.has(`${ctx.key}\0${conversationId}`)) continue;
      let record = store.read(saved.context, conversationId);
      // readable-check: allow method-probe - data: a store reads a saved record synchronously or with a promise
      if (record && typeof record.then === "function") record = await record;
      const state = savedState(record, conversationId);
      if (state.executionId || ACTIVE_TURN_STATES.includes(state.state)) await acquire(saved.context, conversationId);
    }
  }

  // Project close releases what this server runs for the project's sessions,
  // from their retained entries alone, and forgets them: nothing uses them.
  function closeProject(input = {}, application) {
    const root = normalizeNullableText(input.projectContextRoot);
    return eachSession(entry => !root || path.resolve(store.projectContextRoot(entry)) === path.resolve(root),
      ctx => closeRetained(ctx, application, { recover: false, forget: true }));
  }

  async function invalidateRuntimes(input = {}, application, account) {
    if (input.provider && input.provider !== "claude") return { ok: true, closed: 0 };
    if (input.modelProviderId) {
      return stopSelected(entry => store.modelProviderId(entry) === input.modelProviderId,
        "The provider connection changed.");
    }
    if (input.reason !== "server-shutdown") {
      // An account change stops and waits on nothing. Claude Code reads its
      // credentials for every request, so running work continues on the newly
      // connected account or ends at once as signed out; each conversation
      // rebinds its account at its next idle admission. Only the account's
      // cached reads are dropped. A cancelled query's process stop that fails
      // stays owned and is retried before the next query.
      account.queries.invalidate().catch(() => {});
      return { ok: true, closed: 0 };
    }
    closing = true;
    // Neither waits for the other: a failed account query cleanup must not
    // leave the sessions' processes running.
    const [queries, retained] = await Promise.allSettled([account.queries.invalidate(), stopRetained(application)]);
    if (queries.status === "rejected") await account.failure(queries.reason);
    if (retained.status === "rejected") throw retained.reason;
    return retained.value;
  }

  // Shutdown stops only what this server runs: a Claude process cannot outlive
  // the server that started it, so retained entries hold every one. Saved
  // conversations are not reopened just to be stopped.
  function stopRetained(application) {
    return eachSession(() => true, ctx => closeRetained(ctx, application, { recover: false, forget: false }));
  }

  // Sessions close independently and together: one that fails is reported by
  // its ID while every other session still stops.
  async function eachSession(select, close) {
    const contexts = new Map([...entries.values()].filter(select).map(entry => [entry.context.key, entry.context]));
    const settled = await Promise.allSettled([...contexts.values()].map(ctx => close(ctx)));
    let closed = 0;
    const failed = [];
    [...contexts.values()].forEach((ctx, index) => {
      const result = settled[index];
      if (result.status === "fulfilled") closed += result.value.closed;
      const error = result.status === "rejected" ? result.reason?.message || String(result.reason)
        : result.value.ok === false ? "Its Claude Code terminal could not be closed." : "";
      if (error) failed.push({ sessionId: ctx.sessionId, error });
    });
    return { ok: failed.length === 0, closed, failed,
      ...(failed.length ? { error: failed.map(({ sessionId, error }) => `Claude session ${sessionId}: ${error}`).join(" ") } : {}) };
  }

  async function drain(key) {
    const selected = [...entries.values()].filter(entry => entry.context.key === key);
    // Fence configuration still in progress: it must not start a process later.
    for (const entry of selected) entry.preparationRevision++;
    const proofs = [];
    let failure;
    async function stop() {
      for (const entry of selected) if (holdsNativeWork(entry)) {
        try { proofs.push(await entry.nativeTurn.stopProcess()); }
        catch (error) { failure ||= error; }
      }
    }
    // Startup already lends cleanup before initialization completes. Stop it
    // first; waiting for the preparation queue first can exhaust host shutdown.
    await stop();
    await Promise.allSettled(selected.map(entry => entry.nativeTurn.whenIdle()));
    await stop();
    // Every other entry still stopped; the first failure keeps the close retryable.
    if (failure) throw failure;
    return proofs;
  }

  function forget(contextKey) {
    for (const [key, entry] of entries) if (entry.context.key === contextKey) {
      // Nothing would ever stop a process a forgotten entry started.
      entry.disposed = true;
      entries.delete(key);
    }
  }

  async function close(entry) {
    await entry.nativeTurn.stopProcess("Conversation closed.");
    entry.disposed = true;
    await entry.nativeTurn.whenIdle().catch(() => {});
    await entry.nativeTurn.stopProcess("Conversation closed.");
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  async function deleteConversation(entry) {
    await entry.nativeTurn.stopProcess();
    await deleteClaudeConversationHistory({ configRoot, workdir: entry.nativeWorkdir, conversationId: entry.id });
    await store.remove(entry);
    entries.delete(entry.key);
    return { ok: true, deleted: true, conversationId: entry.id };
  }

  async function recover(restoredEntries) {
    for (const entry of restoredEntries) {
      if (!entry.process && !hasPendingClaudeStartup(entry) && (entry.executionId || entry.turn?.active)) await entry.nativeTurn.stopProcess(disconnectedMessage);
    }
  }

  // A provider connection change stops the matching work this server runs.
  // Each entry stops on its own, so one failure is reported by ID.
  async function stopSelected(select, reason) {
    let closed = 0;
    const failed = [];
    for (const entry of [...entries.values()].filter(select)) {
      entry.preparationRevision++;
      if (!holdsNativeWork(entry)) continue;
      try {
        await entry.nativeTurn.stopProcess(reason);
        closed++;
      } catch (error) {
        failed.push({ sessionId: entry.context.sessionId, conversationId: entry.id, error: error.message });
      }
    }
    return { ok: failed.length === 0, closed, failed };
  }

  return Object.freeze({
    get closing() { return closing; },
    closingSessions,
    isClosing,
    reconcileSessions,
    closeSession,
    releaseSession,
    closeProject,
    invalidateRuntimes,
    drain,
    forget,
    close,
    deleteConversation,
    recover,
    stopSelected
  });
}
