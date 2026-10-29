import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClaudeConversationOwner } from "../src/server/conversation/claudeTurn.js";
import { createClaudeConversationDriver } from "../src/server/conversation/providers/claudeDriver.js";

const MAIN_IDS = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
};
const TEMPORARY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const IDLE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// A host with Vibe64's storage rules: every save writes the session record, an
// archived session refuses writes, saved conversations are re-read from storage
// and a session whose workspace is gone cannot prepare a conversation context.
async function lifecycleFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-lifecycle-"));
  const sessions = new Map();
  const calls = { saves: [], reads: 0, stops: [] };
  const processes = [];
  const session = sessionId => {
    if (!sessions.has(sessionId)) {
      mkdirSync(path.join(root, sessionId));
      sessions.set(sessionId, { records: new Map(), archived: false, workspace: true });
    }
    return sessions.get(sessionId);
  };
  const contextFor = sessionId => ({ key: `${root}\0${sessionId}`, sessionId, workdir: path.join(root, sessionId), projectRoot: root });
  const store = {
    select() {},
    read: (ctx, id) => session(ctx.sessionId).records.get(id),
    async save(entry) {
      const { sessionId } = entry.context;
      calls.saves.push(sessionId);
      if (session(sessionId).archived) {
        throw Object.assign(new Error(`Vibe64 session is already archived: ${sessionId}`), { code: "vibe64_session_archived" });
      }
      session(sessionId).records.set(entry.id, JSON.stringify({ executionId: entry.process?.executionId || entry.executionId || "",
        state: entry.turn?.state || "ready", turnId: entry.turn?.id || "", main: entry.main }));
    },
    async hasMessage() { return false; },
    readSessionConversations(ctx) {
      calls.reads++;
      return { context: ctx, ids: [...session(ctx.sessionId).records.keys()] };
    },
    projectContextRoot: entry => entry.context.projectRoot,
    modelProviderId: () => "anthropic"
  };
  let owner;
  const create = () => createClaudeConversationOwner({ configRoot: root, store,
    preparation: {
      async context(context) {
        if (!session(context.sessionId).workspace) throw new Error("Claude requires a prepared session workspace.");
        return contextFor(context.sessionId);
      },
      entry: (ctx, _context, conversationId, { create }) => ({
        options: { conversationId, mainId: MAIN_IDS[ctx.sessionId], create }, check() {} }),
      check() {}, account: () => ({ identity: "account-a", providerId: "anthropic" }),
      async configuration() { return { systemPrompt: "Host instructions", settings: {}, model: "sonnet" }; },
      async message(_entry, _input, { message }) { return message; }
    },
    process: {
      configure() { return {}; },
      async stopExecution(executionId) { calls.stops.push(executionId); return { exited: true, scopeEmpty: true }; },
      async create(options) {
        const native = { executionId: `execution-${processes.length}`, options, proof: { exited: true, scopeEmpty: true },
          async stop() {
            calls.stops.push(native.executionId);
            await native.beforeStop?.();
            return native.proof;
          },
          client: { async request() { return {}; },
            async send(_message, input) { await options.onEvent({ type: "user", uuid: input.messageId, session_id: options.sessionId }); },
            async interrupt() {} } };
        processes.push(native);
        await options.onStarted(native.executionId, () => native.stop());
        return native;
      }
    },
    // As in Vibe64, the native turn's own checkpoints write the session record.
    async onEvent(entry, event) { if (event.type === "save") await store.save(entry); }
  });
  owner = create();
  const terminals = [];
  // The host's original cleanup reader still needs the session's workspace.
  const application = {
    async readContext(context) {
      if (!session(context.sessionId).workspace) throw new Error("Claude requires a prepared session workspace.");
      return contextFor(context.sessionId);
    },
    terminals: { async close(sessionId) { terminals.push(sessionId); return { ok: true, closed: 0 }; } }
  };
  const account = { queries: { invalidate: async () => {} }, failure: error => { throw error; } };
  async function running(sessionId) {
    const entry = await owner.acquire({ sessionId });
    await owner.send(entry, { message: "Work", messageId: `${sessionId}-work` });
    assert.ok(entry.process && entry.turn.active);
    return entry;
  }
  async function idle(sessionId) {
    return owner.acquire({ sessionId });
  }
  // A session closed without forgetting (changeover, renewal) and then archived.
  function archive(sessionId) {
    Object.assign(session(sessionId), { archived: true, workspace: false });
  }
  t.after(async () => {
    for (const entry of owner.entries.values()) if (entry.process) await entry.nativeTurn.stopProcess().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return { root, calls, processes, session, contextFor, application, account, terminals, running, idle, archive,
    get owner() { return owner; }, restart() { owner = create(); return owner; } };
}

test("a Claude account change stops every session's work although a stale archived session refuses writes", async t => {
  const f = await lifecycleFixture(t);
  await f.idle("a");
  f.archive("a");
  const b = await f.running("b");
  const c = await f.running("c");
  const before = f.calls.saves.length;
  const result = await f.owner.invalidateRuntimes({ provider: "claude", reason: "claude-auth-change" }, f.application, f.account);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(b.process, null);
  assert.equal(c.process, null);
  assert.ok(f.calls.stops.includes("execution-0") && f.calls.stops.includes("execution-1"));
  assert.deepEqual(f.calls.saves.slice(before).filter(id => id === "a"), [], "an idle chat has nothing to stop or save");
  assert.deepEqual(f.terminals.sort(), ["a", "b", "c"]);
});

test("a Claude session whose stop fails is reported by ID while every other session still stops", async t => {
  const f = await lifecycleFixture(t);
  const a = await f.running("a");
  a.process.proof = { exited: false, scopeEmpty: false };
  const b = await f.running("b");
  const result = await f.owner.invalidateRuntimes({ provider: "claude", reason: "claude-auth-change" }, f.application, f.account);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed.map(failure => failure.sessionId), ["a"]);
  assert.match(result.error, /Claude session a:/);
  assert.equal(b.process, null, "the healthy session's process stopped");
  a.process.proof = { exited: true, scopeEmpty: true };
});

test("a Claude provider connection change stops the matching live work past a stale archived chat", async t => {
  const f = await lifecycleFixture(t);
  await f.idle("a");
  f.archive("a");
  const b = await f.running("b");
  const result = await f.owner.invalidateRuntimes({ provider: "claude", modelProviderId: "anthropic", reason: "provider-key-change" },
    f.application, f.account);
  assert.deepEqual(result, { ok: true, closed: 1, failed: [] });
  assert.equal(b.process, null);
});

test("a failed Claude account query cleanup still stops the sessions' processes", async t => {
  const f = await lifecycleFixture(t);
  const b = await f.running("b");
  const queries = { invalidate: async () => { throw Object.assign(new Error("Account query cleanup failed."), { code: "claude_account_query_failed" }); } };
  await assert.rejects(f.owner.invalidateRuntimes({ provider: "claude", reason: "claude-auth-change" }, f.application,
    { ...f.account, queries }), /Account query cleanup failed/);
  assert.equal(b.process, null, "the session's process stopped on the previous account anyway");
});

test("Claude shutdown stops sessions together and never rewrites an idle chat", { timeout: 5_000 }, async t => {
  const f = await lifecycleFixture(t);
  const running = [await f.running("a"), await f.running("b"), await f.running("c")];
  // Each stop finishes only once every session's stop has started.
  const started = [];
  const all = Promise.withResolvers();
  for (const entry of running) entry.process.beforeStop = async () => {
    started.push(entry.context.sessionId);
    if (started.length === running.length) all.resolve();
    await all.promise;
  };
  let timer;
  const result = await Promise.race([
    f.owner.invalidateRuntimes({ reason: "server-shutdown" }, f.application, f.account),
    new Promise((_, reject) => { timer = setTimeout(() => { all.resolve(); reject(new Error("Sessions stopped one at a time")); }, 1_000); })
  ]).finally(() => clearTimeout(timer));
  assert.equal(result.ok, true);
  assert.deepEqual(running.map(entry => entry.process), [null, null, null]);
  const before = f.calls.saves.length;
  // Shutdown invalidates more than once; the chats are idle now.
  assert.equal((await f.owner.invalidateRuntimes({ reason: "server-shutdown" }, f.application, f.account)).ok, true);
  assert.equal(f.calls.saves.length, before, "idle chats were not written again");
});

test("Claude project close releases its sessions from memory without reopening saved conversations", async t => {
  const f = await lifecycleFixture(t);
  await f.idle("a");
  f.session("a").records.set(IDLE_ID, JSON.stringify({ state: "completed", main: false }));
  f.archive("a");
  const b = await f.running("b");
  const saves = f.calls.saves.length;
  const result = await f.owner.closeProject({ projectContextRoot: f.root }, f.application);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(b.process, null);
  assert.equal(f.calls.reads, 0, "no saved conversation was re-read");
  assert.deepEqual(f.calls.saves.slice(saves).filter(id => id === "a"), []);
  assert.equal(f.owner.entries.size, 0, "the closed project's conversations are forgotten");
  assert.equal(b.disposed, true, "a forgotten entry can never start a process again");
});

test("releasing an archived Claude renewal predecessor neither reopens nor rewrites it, also after a restart", async t => {
  const f = await lifecycleFixture(t);
  const driver = createClaudeConversationDriver({ host: { workdir: f.root, env: { HOME: f.root } } });
  await f.idle("a");
  f.archive("a");
  const release = () => driver.releaseRenewalPredecessorProcessExitProof({ native: { owner: f.owner, application: f.application },
    context: { sessionId: "a", renewalCleanup: { kind: "predecessor" } } });
  // The renewal transaction's own context still resolves its archived predecessor.
  f.session("a").workspace = true;
  const saves = f.calls.saves.length;
  const released = await release();
  assert.equal(released.ok, true);
  assert.equal(released.processExitProof.scopeEmpty, true);
  assert.equal(f.calls.saves.length, saves, "the archived record was not written");
  assert.equal(f.calls.reads, 0, "its saved conversations were not re-read");
  assert.equal(f.owner.entries.size, 0, "the released predecessor is forgotten");
  f.restart();
  assert.equal((await release()).ok, true, "a fresh server releases it too");
  assert.equal(f.calls.reads, 0);
  assert.equal(f.owner.entries.size, 0);
});

test("Claude temporary activity is the work this server runs, never a reopened saved chat", async t => {
  const f = await lifecycleFixture(t);
  const driver = createClaudeConversationDriver({ host: { workdir: f.root, env: { HOME: f.root } } });
  const records = f.session("a").records;
  records.set(TEMPORARY_ID, JSON.stringify({ executionId: "execution-before-restart", state: "active", turnId: "turn", main: false }));
  records.set(IDLE_ID, "{");
  const inspect = () => driver.inspectTemporaryActivity({ native: { owner: f.owner }, context: f.contextFor("a") });
  assert.equal(await inspect(), false, "a turn saved active by an earlier server ended with it");
  assert.equal(f.owner.entries.size, 0);
  assert.equal(f.calls.reads, 0);
  assert.deepEqual(f.calls.saves, []);
  records.delete(IDLE_ID);
  records.set(TEMPORARY_ID, JSON.stringify({ state: "completed", main: false }));
  const temporary = await f.owner.acquire({ sessionId: "a" }, TEMPORARY_ID);
  await f.owner.send(temporary, { message: "Look this up", messageId: "temporary-work" });
  assert.equal(await inspect(), true);
});

test("closing a Claude session reopens only the saved custody an earlier server left", async t => {
  const f = await lifecycleFixture(t);
  const records = f.session("a").records;
  records.set(MAIN_IDS.a, JSON.stringify({ state: "completed", turnId: "done", main: true }));
  records.set(IDLE_ID, JSON.stringify({ state: "completed", main: false }));
  records.set(TEMPORARY_ID, JSON.stringify({ executionId: "execution-before-restart", state: "active", turnId: "turn", main: false }));
  const closed = await f.owner.closeSession({ sessionId: "a" }, f.application);
  assert.equal(closed.ok, true);
  assert.deepEqual(f.calls.stops, ["execution-before-restart"], "the saved execution's exit was proven");
  assert.equal(JSON.parse(records.get(TEMPORARY_ID)).executionId, "");
  assert.equal(JSON.parse(records.get(TEMPORARY_ID)).state, "interrupted");
  assert.deepEqual([...f.owner.entries.values()].map(entry => entry.id), [TEMPORARY_ID], "idle saved chats stayed closed");
  assert.deepEqual([...new Set(f.calls.saves)], ["a"]);
  records.set(IDLE_ID, "{");
  f.restart();
  records.set(TEMPORARY_ID, JSON.stringify({ executionId: "execution-again", state: "active", main: false }));
  await assert.rejects(f.owner.closeSession({ sessionId: "a" }, f.application),
    new RegExp(`saved Claude conversation ${IDLE_ID} is unreadable`));
});

test("after shutdown invalidation a Claude session close reopens nothing", async t => {
  const f = await lifecycleFixture(t);
  await f.idle("a");
  f.session("a").records.set(TEMPORARY_ID, JSON.stringify({ executionId: "execution-before-restart", state: "active", main: false }));
  assert.equal((await f.owner.invalidateRuntimes({ reason: "server-shutdown" }, f.application, f.account)).ok, true);
  const saves = f.calls.saves.length;
  // The runtime's own close() disposes each retained Main handle through this close.
  assert.equal((await f.owner.closeSession({ sessionId: "a" }, f.application)).ok, true);
  assert.equal(f.calls.reads, 0, "no session was re-read");
  assert.equal(f.calls.saves.length, saves, "no record was written");
});
