import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createCodexAppServerProviderOwner } from "../src/server/conversation/codexProviderOwner.js";
import { createCodexConversationCommands } from "../src/server/conversation/codexConversations.js";
import { createCodexSessionCleanup } from "../src/server/conversation/codexSessionCleanup.js";
import { eventually } from "./fixtures/eventually.js";

// A Codex app-server runs only while it is used: reading a conversation's
// history or status, or stopping it, borrows the process; a running Temporary
// turn or goal holds it; and closing a project stops every one of its own.

// One native process per runtime directory, as the real app-server has per
// account and runtime scope. Each provider connection reports its own thread.
function codexFixture(t, { idleMs = 20 } = {}) {
  const runtimes = new Map();
  const listeners = new Set();
  const runtimeFor = runtimeDir => {
    if (!runtimes.has(runtimeDir)) runtimes.set(runtimeDir, { running: false, starts: 0, stops: 0 });
    return runtimes.get(runtimeDir);
  };
  const owner = createCodexAppServerProviderOwner({ transientIdleMs: idleMs, providerFactory: ({ runtimeDir, onObservationLost }) => {
    const runtime = runtimeFor(runtimeDir);
    return {
      observationFailure: null,
      failObservation(error) {
        this.observationFailure ||= error;
        return onObservationLost(this.observationFailure);
      },
      isHelperProvider: () => false,
      isAvailable: () => runtime.running,
      async ensureAvailable() {
        if (!runtime.running) { runtime.running = true; runtime.starts += 1; }
        return { ok: true };
      },
      async stopRuntime() { runtime.running = false; runtime.stops += 1; return { stopped: true }; },
      close() {},
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async readThreadStatus(threadId) { return { raw: { id: threadId, historyMode: "paginated", status: "idle" } }; },
      async listThreadTurns() { return { data: [{ id: "turn-1", status: "completed", items: [] }] }; },
      async readGoal() { return { goal: null }; },
      async resumeThread() { return {}; },
      async sendTurn() { return { id: "turn-2", status: "inProgress" }; },
      async stopThreadForObservationLoss() {}
    };
  } });
  t.after(() => owner.beginShutdown());
  const sessionKey = sessionId => `codex:project-a:${sessionId}`;
  const connection = (sessionId, keyPrefix = "codex:project-a:", observation = undefined) => ({
    sessionId, providerKey: `provider:${sessionId}`, providerOptions: { runtimeDir: `/tmp/jskit-codex-release-${sessionId}` },
    keyFields: key => ({ sessionId: key.slice("provider:".length) }), assertAdmission() {}, closing: false,
    runOwner: { runtimeLifecycle: { rememberManagedSession() {}, managedThreadId: () => "" } },
    async prepare() {
      return { parameters: { runtimeDir: `/tmp/jskit-codex-release-${sessionId}` }, owner: { sessionKey: `${keyPrefix}${sessionId}` },
        resources: null, controls: { available: false, subscribe: () => () => {} }, runInContext: operation => operation(), observation };
    }
  });
  const commands = createCodexConversationCommands({
    async checkpoint() {},
    // Outside shutdown, with no request contexts.
    isClosing: () => false, captureContext: () => null, runInContext: (_context, operation) => operation(),
    codexAppServerConversationMessageId: (...parts) => parts.join(":"),
    codexAppServerStreamMessage: () => ({}),
    conversationPreparation: {
      async context() {
        return { context: { session: {} }, helperTurn: false, projectRuntimeRoot: "/runtime", managedIdentity: {},
          providerOptions: {}, project: provider => ({ provider, workdir: "/work", agentSettings: {} }) };
      },
      admissionError: () => null,
      failure(error) { return { ok: false, error: error.message }; },
      response: text => ({ text }),
      execution() {
        return { executionProfile: null, threadPreparation: { settings: () => ({}) }, authorized: { turnSettings: {} },
          readOnly: false, onEvent: null, actorMetadata: {}, projectResult: result => result };
      },
      isolation: { assertCompatibility() {} }
    },
    ensureCodexAppServerProviderForActiveTurn: async () => null,
    errorPrefix: "",
    helperLifecycle: { async assertOrdinaryThreadAvailable() {}, inspectControl: () => undefined },
    namespace: sessionId => sessionKey(sessionId),
    providerSessions: { owner },
    ensureSessionProvider: sessionId => owner.ensureSession(connection(sessionId)),
    borrowSessionProvider: sessionId => owner.borrowSession(connection(sessionId)),
    turnOutcomes: { USER_CANCELLED: "cancelled" }
  });
  const emit = notification => [...listeners].forEach(listener => listener(notification));
  return { owner, commands, connection, emit, runtime: runtimeFor("/tmp/jskit-codex-release-session-1"), runtimeFor };
}

test("reading a Temporary chat's history leaves no Codex app-server running", async t => {
  const f = codexFixture(t);
  const read = await f.commands.readCodexAppServerConversation("session-1", { conversationId: "chat-1", persistent: true });
  assert.equal(read.ok, true);
  assert.equal(read.status, "completed");
  assert.equal(f.runtime.running, true, "the read itself uses the process");
  await eventually(() => !f.runtime.running, "an unused history read kept Codex running");
  assert.equal(f.runtime.stops, 1);
  assert.deepEqual([...f.owner.providers.keys()], []);
});

test("consecutive Temporary chat reads share one Codex process and the last releases it", async t => {
  const f = codexFixture(t, { idleMs: 40 });
  for (let read = 0; read < 3; read += 1) {
    await f.commands.readCodexAppServerConversation("session-1", { conversationId: "chat-1", persistent: true });
  }
  assert.equal(f.runtime.starts, 1);
  await eventually(() => !f.runtime.running, "the last read did not release Codex");
  assert.equal(f.runtime.stops, 1);
});

test("stopping an idle Temporary chat leaves no Codex app-server running", async t => {
  const f = codexFixture(t);
  const stopped = await f.commands.stopCodexAppServerConversation("session-1", { conversationId: "chat-1", persistent: true });
  assert.equal(stopped.status, "interrupted");
  await eventually(() => !f.runtime.running, "a Stop of idle work kept Codex running");
  assert.deepEqual([...f.owner.providers.keys()], []);
});

test("a running Temporary turn keeps Codex; it stops a short idle after the turn ends", async t => {
  const f = codexFixture(t);
  const started = await f.commands.startCodexAppServerConversationTurn("session-1", {
    conversationId: "chat-1", persistent: true, message: "Explain this file", messageId: "message-1"
  });
  assert.equal(started.status, "inProgress");
  // A history read while the turn runs must not release its process either.
  await f.commands.readCodexAppServerConversation("session-1", { conversationId: "chat-1", persistent: true });
  f.emit({ method: "turn/started", params: { threadId: "chat-1", turn: { id: "turn-2", status: "inProgress" } } });
  await delay(80);
  assert.equal(f.runtime.running, true, "the running turn's process was stopped");
  assert.equal(f.runtime.stops, 0);
  f.emit({ method: "turn/completed", params: { threadId: "chat-1", turn: { id: "turn-2", status: "completed" } } });
  await eventually(() => !f.runtime.running, "the finished turn kept Codex running");
  assert.equal(f.runtime.stops, 1);
});

test("an active Temporary goal keeps Codex between its turns until the goal ends", async t => {
  const f = codexFixture(t);
  await f.commands.startCodexAppServerConversationTurn("session-1", {
    conversationId: "chat-1", persistent: true, message: "Finish the migration", messageId: "message-1"
  });
  f.emit({ method: "thread/goal/updated", params: { threadId: "chat-1", goal: { status: "active" } } });
  f.emit({ method: "turn/completed", params: { threadId: "chat-1", turn: { id: "turn-2", status: "completed" } } });
  await delay(80);
  assert.equal(f.runtime.running, true, "the goal's process was stopped between its turns");
  f.emit({ method: "thread/goal/updated", params: { threadId: "chat-1", goal: { status: "complete" } } });
  await eventually(() => !f.runtime.running, "the finished goal kept Codex running");
});

test("closing a project stops a Codex app-server its Temporary chat read, and only that project's", async t => {
  const f = codexFixture(t, { idleMs: 60_000 });
  await f.commands.readCodexAppServerConversation("session-1", { conversationId: "chat-1", persistent: true });
  // Another project's session keeps its own conversation.
  const other = f.runtimeFor("/tmp/jskit-codex-release-session-9");
  await f.owner.ensureSession(f.connection("session-9", "codex:project-b:"));
  assert.equal(f.runtime.running, true);
  assert.equal(other.running, true);
  const cleanup = createCodexSessionCleanup({
    namespace: sessionId => `codex:project-a:${sessionId}`,
    runOwner: {},
    providerSessions: { owner: f.owner, managed: new Map(), keyFields: key => ({ sessionId: key.slice("provider:".length) }) },
    sessionClosures: new Map(),
    helperLifecycle: { async restoreThreads() { return { ok: true, failed: [] }; }, records: () => [] },
    journal: { clearSessionRecoveryTimers() {} },
    conversations: f.commands,
    debugLog() {},
    debugError: error => error?.message
  });
  const closed = await cleanup.closeProject({ projectContextRoot: "/project-a" }, {
    helpers: Promise.resolve({ projectRuntimeRoot: "/runtime", context: {} })
  });
  assert.equal(closed.ok, true);
  assert.equal(f.runtime.running, false, "project close left the Temporary chat's Codex running");
  assert.equal(other.running, true, "another project's Codex was stopped");
  assert.deepEqual([...f.owner.providers.keys()], ["provider:session-9"]);
});

// The stop a failed notification starts, whose last step saves the session's stopped work, held until the test
// releases it. As a notification queue does when it cannot save a notification, nothing awaits the stop.
async function heldObservationStop(f, order) {
  let release;
  const released = new Promise(resolve => { release = resolve; });
  const observation = {
    async prepare() { return new Map([["thread-1", "turn-1"]]); },
    async barrier() {},
    async complete() {
      await released;
      order.push("stopped work saved");
    }
  };
  const provider = await f.owner.ensureSession(f.connection("session-1", "codex:project-a:", observation));
  void provider.failObservation(new Error("Commentary storage failed"));
  return async closing => {
    // With fake providers the rest of a close is promise work, all done before the next event-loop turn.
    await new Promise(resolve => setImmediate(resolve));
    order.push("stopped work released");
    release();
    await closing;
  };
}

test("closing a session ends after the observation stop a failed notification started", async t => {
  const f = codexFixture(t, { idleMs: 60_000 });
  const order = [];
  const releaseDuring = await heldObservationStop(f, order);
  await releaseDuring(f.owner.releaseSession("codex:project-a:session-1", {
    sessionId: "session-1",
    runOwner: { notificationQueue: { async drain() {} } },
    session: { exists: false, unsubscribeParameters: {} }
  }).then(() => order.push("closed")));
  assert.deepEqual(order, ["stopped work released", "stopped work saved", "closed"]);
  assert.equal(f.runtime.running, false, "the close left the session's Codex running");
  assert.deepEqual([...f.owner.providers.keys()], []);
});

test("closing a project ends after the observation stop a failed notification of its session started", async t => {
  const f = codexFixture(t, { idleMs: 60_000 });
  const order = [];
  const releaseDuring = await heldObservationStop(f, order);
  await releaseDuring(f.owner.stopProvidersForProject({ projectContextRoot: "/project-a" }, {
    managed: new Map(), keyFields: key => ({ sessionId: key.slice("provider:".length) }),
    helperThreads: { records: () => [] }, sessionKeyPrefix: "codex:project-a:"
  }).then(() => order.push("closed")));
  assert.deepEqual(order, ["stopped work released", "stopped work saved", "closed"]);
  assert.equal(f.runtime.running, false, "the close left the project's Codex running");
});
