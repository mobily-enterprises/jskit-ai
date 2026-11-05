import assert from "node:assert/strict";
import test from "node:test";
import { createCodexConversationCommands } from "../src/server/conversation/codexConversations.js";
import { createCodexRuntimeLifecycle } from "../src/server/conversation/codexRuntimeLifecycle.js";

// A Temporary chat's Codex turn that the server's shutdown stops, or that ends
// while the server is stopping, leaves its checkpoint to the next server: the
// application records it as owed, and that server's next read makes it once.

const turnOutcomes = { USER_CANCELLED: "user_cancelled", SERVICE_RESTART: "service_restart" };

// One server's observed conversation. `latest` is the turn Codex's history
// reports to a read; turn notifications reach the conversation's observer.
function server({ closing = false, latest = { id: "turn-1", status: "inProgress", items: [] }, threadError = null } = {}) {
  const checkpoints = [];
  const deferred = [];
  const listeners = new Set();
  const emit = notification => listeners.forEach(listener => listener(notification));
  const provider = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async readThreadStatus(threadId) {
      return { raw: { id: threadId, historyMode: "paginated", status: "idle", ...(threadError ? { error: threadError } : {}) } };
    },
    async listThreadTurns() { return { data: [latest] }; },
    async readGoal() { return { goal: null }; },
    async stopThreadForObservationLoss() {}
  };
  const lifecycle = { closing };
  const commands = createCodexConversationCommands({
    async checkpoint(sessionId, input) { checkpoints.push({ sessionId, ...input }); },
    async deferCheckpoint(sessionId, input) { deferred.push({ sessionId, ...input }); },
    isClosing: () => lifecycle.closing,
    captureContext: () => null,
    runInContext: (_context, operation) => operation(),
    codexAppServerConversationMessageId: (...parts) => parts.join(":"),
    conversationPreparation: { async context() { return { result: { provider } }; } },
    namespace: sessionId => sessionId,
    providerSessions: { owner: { providers: new Map([["provider", provider]]), holdProvider: () => () => {} } },
    turnOutcomes
  });
  const startTurn = () => {
    commands.observeCodexConversation("session", "thread", provider);
    emit({ method: "turn/started", params: { threadId: "thread", turn: { id: "turn-1", status: "inProgress" } } });
  };
  const complete = status => emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn-1", status } } });
  const read = stoppedByShutdown => commands.readPersistentCodexConversation("session", { conversationId: "thread", stoppedByShutdown },
    { provider }).then(({ status, error, runId }) => ({ status, error, runId }));
  return { checkpoints, deferred, commands, lifecycle, startTurn, complete, read };
}

const OWED = { sessionId: "session", outerTurnId: "codex:thread:turn-1", threadId: "thread", turnId: "turn-1" };

test("shutdown leaves a running Temporary turn's interrupted checkpoint to the next server, which makes it once on its read", async () => {
  const first = server();
  first.startTurn();
  first.lifecycle.closing = true;
  await first.commands.leaveRunningTurnsToNextServer();
  assert.deepEqual(first.checkpoints, [], "shutdown made no checkpoint");
  assert.deepEqual(first.deferred, [{ ...OWED, status: "interrupted", turnOutcome: "service_restart" }]);

  // The stopped process ends the turn natively as interrupted.
  const next = server({ latest: { id: "turn-1", status: "interrupted", items: [] }, threadError: { message: "Turn aborted." } });
  const ended = [];
  const mark = runId => ({ runId, async ended() { ended.push(runId); } });
  assert.deepEqual(await next.read(mark("turn-1")), { status: "interrupted", error: "", runId: "turn-1" });
  assert.deepEqual(ended, ["turn-1"], "recording the stopped run lets the application make its checkpoint");
  assert.deepEqual(await next.read(undefined), { status: "interrupted", error: "Turn aborted.", runId: "turn-1" },
    "an unmarked interruption keeps Codex's own report");
  await next.read(mark("turn-0"));
  assert.deepEqual(ended, ["turn-1"], "only the marked run is recorded as ended");
  assert.deepEqual(next.checkpoints, []);
});

test("a Temporary turn that ends on its own while the server stops leaves its checkpoint, with its own outcome, to the next server", async () => {
  const f = server();
  f.startTurn();
  f.lifecycle.closing = true;
  f.complete("completed");
  await Promise.all(f.commands.deferredCheckpoints);
  assert.deepEqual(f.checkpoints, []);
  assert.deepEqual(f.deferred, [{ ...OWED, status: "completed", turnOutcome: "" }]);
  assert.equal(f.commands.deferredCheckpoints.size, 0, "shutdown awaits each deferred record");

  // The next server reads the completed turn as completed, and makes its checkpoint.
  const next = server({ latest: { id: "turn-1", status: "completed", items: [] } });
  const ended = [];
  assert.equal((await next.read({ runId: "turn-1", async ended() { ended.push("turn-1"); } })).status, "completed");
  assert.deepEqual(ended, ["turn-1"]);
});

test("outside shutdown a Temporary turn's end still makes its checkpoint at once", async () => {
  const f = server();
  f.startTurn();
  f.complete("interrupted");
  assert.deepEqual(f.checkpoints, [{ ...OWED, status: "interrupted", turnOutcome: "" }]);
  assert.deepEqual(f.deferred, []);
  await f.commands.leaveRunningTurnsToNextServer();
  assert.deepEqual(f.deferred, [], "a finished turn owes nothing at shutdown");
});

// The run owner's runtime lifecycle, with the owner calls it makes recorded.
function runtimeLifecycle(calls, leaveTurnsToNextServer) {
  return createCodexRuntimeLifecycle({
    pendingWork: { conversationTurnStarts: new Map(), messageDeliveries: new Map(), reasoningPersistQueues: new Map(),
      resultFinalizations: new Map(), threadReconciliations: new Map(), notificationTasks: new Map(), deferredCheckpoints: new Set() },
    observer: { eventSubscriptions: new Map() },
    checkManagedConnection: async () => {},
    providerSessions: { managed: new Map(), assertOpen() {}, owner: {
      lifecycleTasks: new Set(), runtimeAcquisitions: new Set(),
      beginShutdown() { calls.push("owner-shutdown"); },
      async invalidateRuntimes() { calls.push("stop-runtimes"); return { failed: [], providerCount: 0, results: [], stopped: 0 }; }
    } },
    helperLifecycle: { projectOperations: new Map(), cleanups: new Map(), mutations: new Map(), restores: new Map(), turnStarts: new Map() },
    captureContext: () => null,
    runInContext: (_context, operation) => operation(),
    debugLog() {},
    debugError: error => error?.message,
    leaveTurnsToNextServer
  });
}

test("a Codex shutdown leaves the running turns to the next server before any runtime stops, and waits for their records", async () => {
  const calls = [];
  const recorded = Promise.withResolvers();
  const lifecycle = runtimeLifecycle(calls, async () => {
    calls.push("leave-turns");
    await recorded.promise;
    calls.push("turns-recorded");
  });
  const shutdown = lifecycle.invalidateRuntimes({ reason: "server-shutdown" }, { enabled: true });
  assert.equal(lifecycle.closing, true);
  await Promise.resolve();
  recorded.resolve();
  await shutdown;
  assert.equal(calls[0], "leave-turns");
  assert.ok(calls.indexOf("turns-recorded") < calls.lastIndexOf("stop-runtimes"), "shutdown waited for the records");
});

test("a begun Codex shutdown stops nothing, and a Temporary turn that then ends on its own leaves its checkpoint to the next server", async () => {
  const f = server();
  f.startTurn();
  const calls = [];
  const lifecycle = runtimeLifecycle(calls, () => f.commands.leaveRunningTurnsToNextServer());
  Object.defineProperty(f.lifecycle, "closing", { get: () => lifecycle.closing });
  lifecycle.beginShutdown();
  assert.equal(lifecycle.closing, true, "the closing fence is set before the call returns");
  assert.deepEqual(calls, ["owner-shutdown"], "beginning the shutdown stopped nothing");
  f.complete("completed");
  await Promise.all(f.commands.deferredCheckpoints);
  assert.deepEqual(f.checkpoints, [], "the turn's end made no checkpoint");
  assert.deepEqual(f.deferred.at(-1), { ...OWED, status: "completed", turnOutcome: "" }, "its own outcome is owed");

  // The full stop that follows still stops the runtimes, and leaves the turns only once.
  const deferred = f.deferred.length;
  await lifecycle.invalidateRuntimes({ reason: "server-shutdown" }, { enabled: true });
  assert.ok(calls.includes("stop-runtimes"));
  assert.equal(f.deferred.length, deferred);
  assert.deepEqual(f.checkpoints, []);

  // The next server's read makes the owed checkpoint once.
  const next = server({ latest: { id: "turn-1", status: "completed", items: [] } });
  const ended = [];
  assert.equal((await next.read({ runId: "turn-1", async ended() { ended.push("turn-1"); } })).status, "completed");
  assert.deepEqual(ended, ["turn-1"]);
});
