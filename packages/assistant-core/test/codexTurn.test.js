import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMemoryConversationStorage } from "../src/server/conversation/memoryStorage.js";
import { createConversationTranscript } from "../src/server/conversation/transcript.js";
import { createConversationStreams } from "../src/server/conversation/streams.js";
import { sendCodexAppServerPrompt, CodexAppServerAgentProvider } from "../src/server/conversation/codexProvider.js";
import { createCodexHelperThreadLedgerOwner } from "../src/server/conversation/codexHelperThreadLedger.js";
import {
  waitForCodexAppServerTurn,
  createCodexAppServerRunOwner,
  createCodexAppServerNotificationQueue,
  codexAppServerAgentRunPatch,
  codexAppServerPendingUserMessageOwnership,
  codexAppServerTurnState,
  CODEX_APP_SERVER_RUN_STATE
} from "../src/server/conversation/codexTurn.js";

// Original stable-outer-turn source assertions follow their native owners.
test("a new chat turn claims its client message id and preserves the stable outer identity", async () => {
  const messageSource = await readFile(new URL(
    "../src/server/conversation/codexMessageCommands.js", import.meta.url
  ), "utf8");
  const journalSource = await readFile(new URL(
    "../src/server/conversation/codexRunJournal.js", import.meta.url
  ), "utf8");

  assert.match(messageSource, /claimCodexAppServerMessageStart\(runtime, sessionId, messageId\)/u);
  assert.match(journalSource, /outerTurnId: normalizedOuterTurnId/u);
});

// The original public renewal tests retain the application retry, accepted
// handover, saved identity and structured acknowledgement assertions. These
// cases exercise the native wait sequence carried from that implementation.
function turn(id = "turn-1", status = "inProgress", text = "") {
  return {
    id,
    status,
    items: text ? [{ id: `answer-${id}`, type: "agentMessage", phase: "final_answer", text }] : []
  };
}

function fixture(turns = []) {
  const listeners = new Set();
  const operations = [];
  const provider = {
    subscribe(listener) {
      operations.push("subscribe");
      listeners.add(listener);
      return () => {
        operations.push("unsubscribe");
        listeners.delete(listener);
      };
    },
    async readThread(threadId) {
      assert.equal(threadId, "thread-1");
      operations.push("read");
      return { raw: { turns } };
    }
  };
  return { provider, listeners, operations };
}

// Joining fixture for the original detached coordinator. Native observation is
// the same provider/watcher fixture above; the host only prepares its policy.
async function detachedFixture(t, { refused = false, unavailable = null, contextError = null, dispatchError = null } = {}) {
  const f = fixture([turn("turn-1", "completed", "Original detached answer.")]);
  const stateRoot = await mkdtemp(join(tmpdir(), "codex-detached-"));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const runtime = { stateRoot };
  const session = { sessionId: "session-1" };
  const threadSettings = { model: "selected-model", cwd: "/authorized/workdir" };
  const turnSettings = { model: "selected-model", effort: "high", cwd: "/authorized/workdir" };
  f.events = [];
  f.releases = 0;
  Object.assign(f.provider, {
    async resumeThread(id, settings) {
      assert.equal(id, "thread-1");
      assert.equal(settings, threadSettings);
      f.operations.push("resume");
      return { id };
    },
    async startThread(settings) {
      assert.deepEqual(settings, { ...threadSettings, ephemeral: true });
      f.operations.push("create");
      return { response: { thread: { id: "thread-1" } } };
    },
    async sendTurn(id, input, settings) {
      assert.equal(id, "thread-1");
      assert.deepEqual(input, ["Original prompt"]);
      assert.deepEqual(settings, turnSettings);
      f.operations.push("dispatch");
      if (dispatchError) throw dispatchError;
      return turn("turn-1", "completed");
    }
  });
  const conversationPreparation = {
    detached(id) {
      assert.equal(id, "session-1");
      f.operations.push("admission");
      return {
        admission: refused ? { ok: false, code: "original_closing" } : { ok: true, release() { f.releases++; f.operations.push("release"); } },
        get result() { f.operations.push("input"); return unavailable; },
        get prompt() { return "Original prompt"; },
        execution(context) {
          assert.equal(context.provider, f.provider);
          return { threadPreparation: { settings: () => threadSettings }, authorized: { turnSettings },
            failure(error, status) { assert.equal(status, ""); return error; } };
        }
      };
    },
    context(id, input, options) {
      f.operations.push("context");
      assert.equal(id, "session-1");
      assert.equal(options, f.options);
      if (contextError) throw contextError;
      return { context: { session }, helperTurn: false, projectRuntimeRoot: stateRoot, providerOptions: {},
        project: provider => ({ provider, runtime, session, workdir: "/authorized/workdir", ok: true }) };
    },
    admissionError() { return null; },
    failure(error) { return { ok: false, error: error.message, code: error.code }; }
  };
  f.options = { runtime, session, onEvent(event) {
    f.events.push(event);
    f.operations.push(`event:${event.type}`);
    return f.onEvent?.(event);
  } };
  f.owner = createCodexAppServerRunOwner({ conversationPreparation,
    helperThreads: { ledgerOwner: createCodexHelperThreadLedgerOwner({ executionProfile: value => structuredClone(value) }) },
    providerSessions: { owner: { providers: new Map(), ensureSession: async () => f.provider }, context: () => ({}) }
  });
  return f;
}

test("original detached run coordinator joins ordinary create/resume, events and native completion without awaiting observers", async t => {
  for (const resume of [false, true]) await t.test(resume ? "resume" : "create", { timeout: 2_000 }, async t => {
    const f = await detachedFixture(t);
    const neverAwaited = Promise.withResolvers();
    f.onEvent = () => neverAwaited.promise;
    const result = await f.owner.runDetachedConversation("session-1", {
      prompt: "Original prompt", ...(resume ? { codexSessionId: "thread-1" } : { ephemeral: true })
    }, f.options);
    assert.deepEqual(result, { ok: true, text: "Original detached answer.", threadId: "thread-1", turnId: "turn-1" });
    assert.deepEqual(f.events, [
      { type: "thread", threadId: "thread-1" },
      { type: "turn", status: "completed", threadId: "thread-1", turnId: "turn-1" },
      { type: "completed", status: "completed", text: "Original detached answer.", threadId: "thread-1", turnId: "turn-1" }
    ]);
    assert.deepEqual(f.operations, ["admission", "input", "context", resume ? "resume" : "create",
      "event:thread", "subscribe", "dispatch", "event:turn", "read", "unsubscribe", "event:completed", "release"]);
    assert.equal(f.releases, 1);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.owner.conversations.size, 0, "Detached execution does not retain a Main/scoped conversation.");
  });
});

test("original detached admission/result boundary releases every early or dispatched failure", async t => {
  const failure = Object.assign(new Error("Original native failure"), { code: "original_native_failure" });
  for (const scenario of ["refused", "disabled", "empty", "context", "thread-event", "dispatch"]) await t.test(scenario, async t => {
    const unavailable = scenario === "disabled" ? { ok: false, code: "original_disabled" }
      : scenario === "empty" ? { ok: false, code: "original_empty" } : null;
    const f = await detachedFixture(t, { refused: scenario === "refused", unavailable,
      contextError: scenario === "context" ? failure : null, dispatchError: scenario === "dispatch" ? failure : null });
    if (scenario === "thread-event") f.onEvent = () => { throw failure; };
    const result = await f.owner.runDetachedConversation("session-1", { prompt: "Original prompt", ephemeral: true }, f.options);
    assert.deepEqual(result, scenario === "refused" ? { ok: false, code: "original_closing" }
      : unavailable || { ok: false, error: failure.message, code: failure.code });
    assert.equal(f.releases, scenario === "refused" ? 0 : 1);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.owner.conversations.size, 0);
    if (["refused", "disabled", "empty"].includes(scenario)) assert.equal(f.operations.includes("context"), false);
    if (scenario !== "dispatch") assert.equal(f.operations.includes("dispatch"), false);
    if (scenario === "dispatch") assert.equal(f.operations.includes("unsubscribe"), true);
  });
});

test("an already completed exact turn returns its saved answer without subscribing or rereading", async () => {
  const f = fixture();
  const result = await waitForCodexAppServerTurn(f.provider, " thread-1 ", turn("turn-1", "completed", "Approved handover."));
  assert.equal(result.turnId, "turn-1");
  assert.deepEqual(result, {
    status: "completed",
    text: "Approved handover.",
    threadId: "thread-1",
    turnId: "turn-1",
    usage: null
  });
  assert.deepEqual(f.operations, []);
});

test("missing native thread or turn identity fails before observation", async () => {
  for (const [threadId, nativeTurn, expectedTurnId] of [["", turn(), "turn-1"], [0, turn(), "turn-1"], [false, turn(), "turn-1"], ["thread-1", {}, ""]]) {
    const f = fixture();
    await assert.rejects(waitForCodexAppServerTurn(f.provider, threadId, nativeTurn), {
      code: "codex_app_server_turn_identity_missing",
      retryable: false,
      details: { threadId: String(threadId || "").trim(), turnId: expectedTurnId, retryable: false }
    });
    assert.deepEqual(f.operations, []);
  }
});

test("an already failed or interrupted exact turn retains its provider error and identity", async () => {
  for (const status of ["failed", "interrupted"]) {
    const f = fixture();
    await assert.rejects(waitForCodexAppServerTurn(f.provider, "thread-1", {
      ...turn("turn-1", status), error: { message: "Native failure detail." }
    }), {
      code: "codex_app_server_turn_failed",
      message: "Native failure detail.",
      retryable: true,
      details: { status, threadId: "thread-1", turnId: "turn-1", retryable: true }
    });
    assert.deepEqual(f.operations, []);
  }
});

test("observation subscribes before rereading and recovers only the exact completed turn", async () => {
  const f = fixture([
    turn("foreign-turn", "failed", "Unrelated response."),
    turn("turn-1", "completed", "Approved handover."),
    turn("later-turn", "completed", "A later response.")
  ]);
  const result = await waitForCodexAppServerTurn(f.provider, "thread-1", turn(), { timeoutMs: 1000 });
  assert.equal(result.turnId, "turn-1");
  assert.equal(result.text, "Approved handover.");
  assert.deepEqual(f.operations, ["subscribe", "read", "read", "unsubscribe"]);
  assert.equal(f.listeners.size, 0);
});

test("completed receipts without text recover their exact response through the subscribed watcher", async () => {
  const f = fixture([turn("turn-1", "completed", "Approved handover.")]);
  const result = await waitForCodexAppServerTurn(f.provider, "thread-1", turn("turn-1", "completed"), { timeoutMs: 1000 });
  assert.equal(result.text, "Approved handover.");
  assert.deepEqual(f.operations, ["subscribe", "read", "unsubscribe"]);
  assert.equal(f.listeners.size, 0);
});

test("a failed exact reread uses the host error factory and releases the original watcher", async () => {
  const f = fixture([{ ...turn("turn-1", "failed"), error: { message: "Native failure detail." } }]);
  const expected = new Error("Application failure.");
  const errors = [];
  await assert.rejects(waitForCodexAppServerTurn(f.provider, "thread-1", turn(), {
    timeoutMs: 1000,
    createError(...args) { errors.push(args); return expected; }
  }), error => error === expected);
  assert.deepEqual(errors, [["failed", {
    status: "failed", threadId: "thread-1", turnId: "turn-1"
  }, "Native failure detail."]]);
  assert.deepEqual(f.operations, ["subscribe", "read", "unsubscribe"]);
  assert.equal(f.listeners.size, 0);
});

test("completion delivered during the latest read is retained by the already registered observer", async () => {
  const f = fixture([turn("turn-1", "completed", "Approved handover.")]);
  const readThread = f.provider.readThread;
  let delivered = false;
  f.provider.readThread = async threadId => {
    if (!delivered) {
      delivered = true;
      assert.equal(f.listeners.size, 1);
      for (const listener of [...f.listeners]) {
        listener({ method: "turn/completed", params: { threadId, turn: turn("turn-1", "completed") } });
      }
    }
    return readThread(threadId);
  };
  const result = await waitForCodexAppServerTurn(f.provider, "thread-1", turn(), { timeoutMs: 1000 });
  assert.equal(result.turnId, "turn-1");
  assert.equal(result.text, "Approved handover.");
  assert.equal(f.operations[0], "subscribe");
  assert.equal(f.operations.filter(operation => operation === "unsubscribe").length, 1);
  assert.equal(f.listeners.size, 0);
});

test("a native wait deadline releases its subscription", async () => {
  const f = fixture([turn()]);
  await assert.rejects(waitForCodexAppServerTurn(f.provider, "thread-1", turn(), { timeoutMs: 1 }), {
    message: "Timed out waiting for Codex app-server response."
  });
  assert.deepEqual(f.operations, ["subscribe", "read", "unsubscribe"]);
  assert.equal(f.listeners.size, 0);
});

// The production public lifecycle cases remain unchanged. This small store
// fixture records the moved mutation boundary; public tests still prove the
// real lease, run file, receipt admission, publication and checkpoint behavior.
function runFixture(initial = {}) {
  let run = structuredClone({ id: "codex_app_server", state: "active", providerStatus: "inProgress",
    providerThreadId: "thread-1", providerTurnId: "turn-1", inputSource: "chat", outerTurnId: "request-1",
    startedAt: "2026-09-30T01:00:00.000Z", updatedAt: "2026-09-30T01:00:00.000Z", events: [{ kind: "claimed" }], ...initial });
  const operations = [];
  const writes = [];
  let locked = false;
  const runtime = {
    async getSession(sessionId) {
      assert.equal(sessionId, "session-1");
      assert.equal(locked, true, "The existing mutation lock owns each current-run read");
      operations.push("read");
      return { sessionId, agentRuns: [structuredClone(run)] };
    },
    store: {
      async mutateSession(sessionId, operation) {
        assert.equal(sessionId, "session-1");
        assert.equal(locked, false);
        locked = true;
        operations.push("lock");
        try { return await operation(); }
        finally { locked = false; operations.push("unlock"); }
      },
      async writeAgentRunEvent(sessionId, runId, { event, patch }) {
        assert.equal(locked, true);
        assert.equal(sessionId, "session-1");
        assert.equal(runId, "codex_app_server");
        operations.push("write");
        writes.push(structuredClone({ event, patch }));
        run = { ...run, ...structuredClone(patch), events: [...run.events, structuredClone(event)] };
        return structuredClone(run);
      },
      clearConversationStream(sessionId) {
        assert.equal(locked, true);
        assert.equal(sessionId, "session-1");
        operations.push("clear-stream");
        return { cleared: true };
      },
      async readAgentRun(sessionId, runId) {
        assert.equal(sessionId, "session-1");
        assert.equal(runId, "codex_app_server");
        return structuredClone(run);
      }
    }
  };
  return { runtime, operations, writes, read: () => structuredClone(run),
    replace: value => { run = structuredClone(value); } };
}

test("native run claims retain the original lock/read/write/read sequence and clear former goal ownership", async () => {
  const f = runFixture({ state: "completed", providerGoalStatus: "active", providerGoalThreadId: "old-thread",
    providerGoalUpdatedAt: "old-goal-time", pendingUserMessageClientIds: ["old-message"] });
  const owner = createCodexAppServerRunOwner();
  const result = await owner.claimTurnStart(f.runtime, " session-1 ", " request-2 ");
  assert.equal(result.claimed, true);
  const run = result.session.agentRuns[0];
  assert.equal(run.state, CODEX_APP_SERVER_RUN_STATE.STARTING);
  assert.equal(run.outerTurnId, "request-2");
  assert.equal(run.inputSource, "chat");
  assert.equal(run.providerGoalStatus, "");
  assert.equal(run.providerGoalThreadId, "");
  assert.equal(run.providerGoalUpdatedAt, "");
  assert.deepEqual(run.pendingUserMessageClientIds, []);
  assert.deepEqual(f.operations, ["lock", "read", "write", "read", "unlock"]);
  assert.equal(f.writes[0].event.kind, "codex-app-server-turn-claimed");
  assert.equal((await owner.claimTurnStart(f.runtime, "session-1", "request-3")).claimed, false);
  assert.equal(f.writes.length, 1);
  assert.equal(f.read().outerTurnId, "request-2");
});

test("the moved native run guard preserves Stop when an earlier provider read resolves", async () => {
  const f = runFixture();
  const owner = createCodexAppServerRunOwner();
  const observedRun = f.read();
  await owner.writeAgentRun(f.runtime, "session-1", { runState: CODEX_APP_SERVER_RUN_STATE.INTERRUPTED,
    status: "interrupted", threadId: "thread-1", turnId: "turn-1", publishReason: "codex-app-server-turn-interrupted" });
  const store = f.runtime.store;
  const sessionId = "session-1";
  // Same original assertions as the public pending-activity-read/Stop case.
  assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).state,
    CODEX_APP_SERVER_RUN_STATE.INTERRUPTED);
  const stopped = f.read();
  const result = await owner.writeAgentRun(f.runtime, sessionId, { observedRun,
    runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE, status: "inProgress", threadId: "thread-1", turnId: "turn-1" });
  assert.equal((await store.readAgentRun(sessionId, "codex_app_server")).state,
    CODEX_APP_SERVER_RUN_STATE.INTERRUPTED);
  assert.equal(result.wrote, false);
  assert.deepEqual(f.read(), stopped);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.operations, ["lock", "read", "write", "clear-stream", "read", "unlock", "lock", "read", "unlock"]);
});

test("native recovery requires the exact stopped revision and keeps its original start and outer owner", async () => {
  for (const state of ["failed", "interrupted"]) {
    const f = runFixture({ state, providerStatus: state });
    const observedRun = f.read();
    const result = await createCodexAppServerRunOwner().writeAgentRun(f.runtime, "session-1", { observedRun,
      runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE, status: "inProgress", threadId: "thread-1", turnId: "turn-1",
      updatedAt: "2026-10-01T01:00:00.000Z" });
    assert.equal(result.wrote, true);
    assert.equal(result.runPatch.startedAt, observedRun.startedAt);
    assert.equal(result.runPatch.outerTurnId, "request-1");
    assert.equal(f.read().inputSource, "chat");
    assert.equal(f.read().providerThreadId, "thread-1");
    assert.equal(f.read().providerTurnId, "turn-1");
    assert.equal(f.read().state, CODEX_APP_SERVER_RUN_STATE.ACTIVE);
    assert.deepEqual(f.operations, ["lock", "read", "write", "read", "unlock"]);
  }
});

test("durable processed results and observation loss prevent revival of an exact stopped native turn", async () => {
  for (const barrier of ["durable", "memory", "observation_lost"]) {
    const f = runFixture({ state: "interrupted", providerStatus: barrier === "observation_lost" ? barrier : "interrupted" });
    const owner = createCodexAppServerRunOwner({ namespace: sessionId => `project:${sessionId}` });
    if (barrier === "durable") {
      const run = f.read();
      run.events.push({ kind: "codex-app-server-result-processed", providerThreadId: "thread-1", providerTurnId: "turn-1" });
      f.replace(run);
    }
    if (barrier === "memory") owner.processedTurns.add(owner.resultFinalizationKey("session-1", "thread-1", "turn-1"));
    const observedRun = f.read();
    const result = await owner.writeAgentRun(f.runtime, "session-1", { observedRun,
      runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE, status: "inProgress", threadId: "thread-1", turnId: "turn-1" });
    assert.equal(result.wrote, false);
    assert.deepEqual(f.read(), observedRun);
    assert.deepEqual(f.writes, []);
    assert.equal(owner.resultFinalizationKey("session-1", "thread-1", "turn-1"), "project:session-1:thread-1:turn-1");
  }
});

test("native phase changes require the current exact turn and retain its active start", async () => {
  const f = runFixture({ providerPhase: "reasoning" });
  const owner = createCodexAppServerRunOwner();
  for (const turnId of ["", "foreign-turn"]) {
    assert.equal((await owner.writeAgentRun(f.runtime, "session-1", { phase: "compacting",
      runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE, status: "inProgress", threadId: "thread-1", turnId })).wrote, false);
  }
  const changed = await owner.writeAgentRun(f.runtime, "session-1", { phase: "compacting",
    runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE, status: "inProgress", threadId: "thread-1", turnId: "turn-1" });
  assert.equal(changed.runPatch.providerPhase, "compacting");
  assert.equal(changed.runPatch.startedAt, "2026-09-30T01:00:00.000Z");
  assert.equal(f.writes.length, 1);
});

test("original pending ownership and terminal outer identity are preserved without weakening run-state errors", () => {
  const run = { inputSource: "chat", pendingUserMessageClientIds: [0, false, " first ", "second"] };
  assert.deepEqual(codexAppServerPendingUserMessageOwnership(run, "first"), { clientId: "first", inputSource: "chat" });
  assert.equal(codexAppServerPendingUserMessageOwnership(run, "other"), null);
  const patch = codexAppServerAgentRunPatch({ inputSource: "terminal", runState: "active",
    session: { agentRuns: [{ id: "codex_app_server", outerTurnId: "old-owner", providerThreadId: "thread-1", providerTurnId: "old-turn" }] },
    threadId: "thread-1", turnId: "turn-2", status: "inProgress" });
  assert.equal(patch.outerTurnId, "codex:thread-1:turn-2");
  assert.deepEqual(patch.pendingUserMessageClientIds, []);
  const hostError = new Error("Existing application run-state error");
  assert.throws(() => codexAppServerTurnState({ agentRuns: [{ id: "codex_app_server", state: "invalid" }] }, () => { throw hostError; }),
    error => error === hostError);
});

test("native notification queues merge only waiting stream deltas and retain receipt order", async () => {
  const owner = createCodexAppServerNotificationQueue();
  const context = { sessionId: "session-1", sessionKey: "session-1", threadId: "thread-1", turnId: "turn-1" };
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const output = [];
  const stream = delta => ({ kind: "assistant_delta", itemId: "item-1", threadId: "thread-1", turnId: "turn-1", delta });
  const deliver = async (sessionId, classification) => {
    assert.equal(sessionId, "session-1");
    output.push(classification);
    if (output.length === 1) { started.resolve(); await release.promise; }
  };
  owner.stream(context, stream("First"), deliver);
  await started.promise;
  owner.stream(context, stream("Second"), deliver);
  owner.stream(context, stream(" part"), deliver);
  owner.run(context, () => { output.push({ receipt: "durable" }); });
  owner.stream(context, stream("After receipt"), deliver);
  assert.equal(output[0].delta, "First", "The running batch is immutable while its sink is pending");
  const drained = owner.drain("session-1");
  release.resolve();
  await drained;
  assert.deepEqual(output.map(value => value.delta || value.receipt), ["First", "Second part", "durable", "After receipt"]);
  assert.equal(owner.tasks.size, 0);
  assert.equal(owner.pendingStreams.size, 0);
});

test("native reasoning batches retain the original thousand-fragment commentary boundary", async () => {
  const owner = createCodexAppServerNotificationQueue();
  const context = { sessionId: "session-1", sessionKey: "session-1", threadId: "thread-1", turnId: "turn-1" };
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writes = [];
  const delivered = [];
  const deliver = async (sessionId, threadId, notifications) => {
    assert.equal(sessionId, "session-1");
    assert.equal(threadId, "thread-1");
    writes.push(notifications);
    delivered.push(notifications.map(({ delta }) => delta).join(""));
    if (writes.length === 1) { entered.resolve(); await release.promise; }
  };
  owner.reasoning(context, { delta: "Start " }, deliver);
  await entered.promise;
  for (let index = 0; index < 1_000; index++) owner.reasoning(context, { delta: "word " }, deliver);
  owner.run(context, () => { delivered.push("Checking the files."); });
  for (let index = 0; index < 1_000; index++) owner.reasoning(context, { delta: "next " }, deliver);
  assert.equal(writes[0].length, 1, "Waiting fragments cannot mutate the batch already in its sink");
  release.resolve();
  await owner.drain("session-1");
  assert.deepEqual(delivered, ["Start ", "word ".repeat(1_000), "Checking the files.", "next ".repeat(1_000)]);
  assert.equal(writes.length, 3, "queued fragments share a write; commentary remains between the two reasoning items");
  assert.equal(owner.pendingReasoning.size, 0);
});

test("native notification failure stops observation before reporting and preserves later queued work", async () => {
  const output = [];
  const failure = new Error("Original delivery failed");
  const projectContext = { targetRoot: "/authorized/project" };
  const owner = createCodexAppServerNotificationQueue({ namespace: id => `project:${id}`,
    runInContext(context, operation) { assert.equal(context, projectContext); return operation(); },
    reportError(error, context) { assert.equal(error, failure); assert.equal(context.method, "item/completed"); output.push("report"); }
  });
  const context = { sessionId: "session-1", projectContext, method: "item/completed",
    provider: { failObservation(error) { assert.equal(error, failure); output.push("stop-observation"); } } };
  owner.run(context, () => { throw failure; });
  owner.run(context, () => { output.push("next"); });
  await owner.drain("session-1");
  assert.deepEqual(output, ["stop-observation", "report", "next"]);
  assert.equal(owner.tasks.size, 0);
});

test("native notification draining follows same-scope successors while another scope remains independent", async () => {
  const owner = createCodexAppServerNotificationQueue();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const output = [];
  owner.run({ sessionId: "first" }, async () => {
    entered.resolve();
    await release.promise;
    output.push("first");
    owner.run({ sessionId: "first" }, () => { output.push("successor"); });
  });
  await entered.promise;
  owner.run({ sessionId: "second" }, () => { output.push("independent"); });
  await owner.drain("second");
  assert.deepEqual(output, ["independent"]);
  const draining = owner.drain("first");
  release.resolve();
  await draining;
  assert.deepEqual(output, ["independent", "first", "successor"]);
  assert.equal(owner.tasks.size, 0);
});

test("closing prevents new native notification batches while previously admitted queue work drains", async () => {
  let closing = false;
  const owner = createCodexAppServerNotificationQueue({ isClosing: () => closing });
  const context = { sessionId: "session-1", sessionKey: "session-1" };
  const output = [];
  owner.run(context, () => { output.push("accepted"); });
  closing = true;
  owner.run(context, () => { output.push("late-task"); });
  owner.stream(context, { itemId: "item-1", turnId: "turn-1" }, () => { output.push("late-stream"); });
  owner.reasoning(context, {}, () => { output.push("late-reasoning"); });
  await owner.drain("session-1");
  assert.deepEqual(output, ["accepted"]);
  assert.equal(owner.tasks.size, 0);
  assert.equal(owner.pendingStreams.size, 0);
  assert.equal(owner.pendingReasoning.size, 0);
});

// Native output assertions are carried from the original public lifecycle cases.
// The existing shared transcript/stream implementations replace only the public
// filesystem fixture; public tests retain subscription, Stop and restart coverage.
async function outputFixture({ persistCommentary } = {}) {
  const sessionId = "session-1";
  const threadId = "thread-1";
  const turnId = "turn-1";
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  const streams = createConversationStreams();
  const f = {
    sessionId, threadId, turnId, hydrations: 0, publications: [], pages: [], history: [],
    run: { id: "codex_app_server", state: "active", providerStatus: "inProgress",
      providerThreadId: threadId, providerTurnId: turnId, inputSource: "chat", outerTurnId: "request-1", events: [] },
    onPublish: null,
    historyError: null
  };
  let mutation = Promise.resolve();
  const store = {
    ...transcript,
    async readAgentRun(id, runId) {
      assert.equal(id, sessionId);
      assert.equal(runId, "codex_app_server");
      return structuredClone(f.run);
    },
    mutateSession(id, operation) {
      assert.equal(id, sessionId);
      const next = mutation.catch(() => null).then(operation);
      mutation = next;
      return next;
    },
    updateConversationStream: streams.update,
    completeConversationStreamMessage: streams.complete,
    clearConversationStream: streams.clear,
    readConversationStream: streams.read
  };
  const runtime = { store, async getSession(id) {
    assert.equal(id, sessionId);
    return { sessionId, agentRuns: [structuredClone(f.run)] };
  } };
  const provider = {
    async listThreadTurns(id, options) {
      assert.equal(id, threadId);
      f.pages.push(structuredClone(options));
      if (f.historyError) throw f.historyError;
      const offset = Number(options.cursor || 0);
      return { data: structuredClone(f.history.slice(offset, offset + 1)),
        nextCursor: offset + 1 < f.history.length ? String(offset + 1) : null };
    },
    async resumeThread() { throw new Error("History recovery must not resume native work"); },
    async startTurn() { throw new Error("History reads must not resend the prompt"); }
  };
  f.store = store;
  f.provider = provider;
  f.createOwner = () => createCodexAppServerRunOwner({
    persistCommentary,
    createRuntime: async () => { f.hydrations += 1; return runtime; },
    createStore: async id => { assert.equal(id, sessionId); return store; },
    async acquireProvider(input) {
      assert.equal(input.sessionId, sessionId);
      assert.equal(input.runtime, runtime);
      assert.equal(input.session.sessionId, sessionId);
      return provider;
    },
    async publish(id, event) {
      assert.equal(id, sessionId);
      await f.onPublish?.(id, event);
      f.publications.push(structuredClone(event));
    }
  });
  f.owner = f.createOwner();
  f.replies = async () => (await store.readConversationLog(sessionId)).filter(row => row.assistant);
  f.final = (itemId, text) => f.owner.recordFinalAssistantResult({
    sessionId, threadId, turnId, itemId, text, source: "notification"
  });
  await store.writeConversationUserMessage(sessionId, { messageId: "request-1", text: "Work" });
  return f;
}

function outputItem(id, text, phase = "final_answer") {
  return { id, type: "agentMessage", phase, text };
}

test("original output owner keeps chunk reads bounded and rejects output after Stop", async () => {
  const f = await outputFixture();
  const { sessionId, threadId, turnId, owner, store } = f;
  for (const delta of ["Hello", " ", "world"]) {
    await owner.writeStream(sessionId, { threadId, turnId, itemId: "stream-answer", role: "assistant", delta });
  }
  assert.equal(store.readConversationStream(sessionId).messages[0].text, "Hello world");
  assert.equal(f.hydrations, 0, "text chunks must not hydrate the session runtime");
  await owner.recordReasoningForSession(sessionId, threadId, [{ method: "item/reasoning/summaryTextDelta",
    params: { threadId, turnId, itemId: "stream-reasoning", delta: "**Checking the answer**" } }]);
  assert.equal(f.hydrations, 0, "reasoning chunks must not hydrate the session runtime");
  assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.thinking || []).map(message => message.text),
    ["Checking the answer"]);
  assert.equal((await store.readConversationLog(sessionId)).some(row => row.assistant), false);
  const messageId = store.readConversationStream(sessionId).messages[0].messageId;
  f.history = [{ id: turnId, status: "inProgress", items: [outputItem("stream-answer", "Hello world!")] }];
  await f.final("stream-answer", "Hello world!");
  assert.equal((await f.replies()).at(-1).assistant.messageId, messageId);
  assert.deepEqual(store.readConversationStream(sessionId).messages, []);
  await owner.writeStream(sessionId, { threadId, turnId, itemId: "stream-answer", role: "assistant", delta: "late" });
  assert.deepEqual(store.readConversationStream(sessionId).messages, []);
  f.run = { ...f.run, state: "interrupted", providerStatus: "interrupted" };
  store.clearConversationStream(sessionId);
  await owner.writeStream(sessionId, { threadId, turnId, itemId: "after-stop", role: "assistant", delta: "Wrong" });
  assert.deepEqual(store.readConversationStream(sessionId).messages, []);
  assert.equal((await store.readConversationLog(sessionId)).filter(row => row.assistant).length, 1);
});

test("original output owner retains readable reasoning channels and completed-item deduplication", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-01T00:00:00Z") });
  const f = await outputFixture();
  const { owner, sessionId, threadId, turnId, store } = f;
  const params = { threadId, turnId, itemId: "raw-thought", contentIndex: 0 };
  const record = async notification => {
    t.mock.timers.tick(1);
    await owner.recordReasoningForSession(sessionId, threadId, [notification]);
  };
  await record({ method: "item/reasoning/summaryPartAdded", params: { ...params, summaryIndex: 0 } });
  await record({ method: "item/reasoning/textDelta", params: { ...params, delta: "First " } });
  await record({ method: "item/reasoning/textDelta", params: { ...params, delta: "step." } });
  await record({ method: "item/reasoning/textDelta", params: { ...params, contentIndex: 1, delta: "Second step." } });
  await record({ method: "item/reasoning/summaryTextDelta", params: { ...params, delta: "Duplicate summary" } });
  await record({ method: "item/completed", params: {
    threadId, turnId, item: { id: params.itemId, type: "reasoning", summary: [], content: ["First step.", "Second step."] }
  } });
  await owner.writeLiveProgress(sessionId, threadId, { method: "item/completed", params: {
    threadId, turnId, item: outputItem("progress", "Checking the sources.", "commentary")
  } });
  await record({ method: "item/completed", params: {
    threadId, turnId, item: { id: "completed-thought", type: "reasoning", summary: [], content: ["Final check."] }
  } });
  assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.thinking || []).map(({ text }) => text),
    ["First step.", "Second step.", "Final check."]);
  assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.commentary || []).map(({ text }) => text),
    ["Checking the sources."]);
  assert.equal(f.hydrations, 0);
});

test("original output owner publishes native history identities once through correction and restart", async () => {
  const f = await outputFixture();
  const { sessionId, threadId, turnId, store } = f;
  const historyIds = { "msg-first": "item-4040", "msg-second": "item-4041" };
  const items = [];
  for (const [index, itemId] of Object.keys(historyIds).entries()) {
    await f.owner.writeStream(sessionId, { threadId, turnId, itemId, role: "assistant", delta: "Same answer." });
    const live = store.readConversationStream(sessionId);
    items.push(outputItem(historyIds[itemId], "Same answer."));
    f.history = [{ id: "successor", status: "inProgress", items: [outputItem("foreign", "Not this reply.")] },
      { id: turnId, status: "completed", items }];
    f.publications.length = 0;
    await f.final(itemId, "Same answer.");
    const saved = await f.replies();
    assert.equal(saved.length, index + 1);
    const savedMessageId = saved.at(-1).assistant.messageId;
    assert.notEqual(savedMessageId, live.messages[0].messageId);
    assert.deepEqual(store.readConversationStream(sessionId).messages, []);
    const bundles = f.publications.filter(event => event.payload?.conversationLogPatch);
    for (const event of bundles.filter(event => !event.payload.conversationStream.messages.length)) {
      assert.equal(event.payload.conversationLogPatch.turn.assistant.messageId, savedMessageId,
        "The stream must be retired with its saved reply, not an earlier reply");
    }
  }
  const ids = (await f.replies()).map(row => row.assistant.messageId);
  items[0] = outputItem("item-4040", "Corrected first answer.");
  await f.final("msg-first", "Corrected first answer.");
  assert.equal((await f.replies())[0].assistant.text, "Corrected first answer.");
  f.owner = f.createOwner();
  for (const [itemId, answer] of [["msg-first", "Corrected first answer."], ["msg-second", "Same answer."]]) {
    await f.final(itemId, answer);
  }
  assert.deepEqual((await f.replies()).map(row => row.assistant.messageId), ids);
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["Corrected first answer.", "Same answer."]);
  assert.ok(f.pages.length >= 2);
  assert.deepEqual(f.pages.slice(0, 2), [
    { limit: 1, itemsView: "full", sortDirection: "desc" },
    { limit: 1, itemsView: "full", sortDirection: "desc", cursor: "1" }
  ]);
});

test("original output owner carries proven live identity across distinct native history IDs", async () => {
  const f = await outputFixture();
  const { sessionId, threadId, turnId, store } = f;
  await f.owner.writeStream(sessionId, { threadId, turnId, itemId: "live-progress", role: "commentary", delta: "Checking the source." });
  const progress = store.readConversationStream(sessionId).messages[0];
  await f.owner.writeLiveProgress(sessionId, threadId, { method: "item/completed", params: {
    threadId, turnId, item: outputItem("live-progress", "Checking the source.", "commentary")
  } });
  const savedProgress = (await store.readConversationLog(sessionId))[0].commentary[0];
  assert.notEqual(savedProgress.messageId, progress.messageId);
  assert.equal(progress.outputId, progress.messageId);
  assert.equal(savedProgress.outputId, progress.outputId);

  await f.owner.writeStream(sessionId, { threadId, turnId, itemId: "live-answer", role: "assistant", delta: "The answer." });
  const live = store.readConversationStream(sessionId).messages[0];
  f.history = [{ id: turnId, status: "completed", items: [outputItem("history-answer", "The answer.")] }];
  await f.final("live-answer", "The answer.");
  const saved = (await f.replies())[0].assistant;
  assert.notEqual(saved.messageId, live.messageId);
  assert.equal(live.outputId, live.messageId);
  assert.equal(saved.outputId, live.outputId);
  assert.deepEqual(store.readConversationStream(sessionId).messages, []);

  f.history[0].items[0] = outputItem("history-answer", "The corrected answer.");
  await f.final("live-answer", "The corrected answer.");
  f.owner = f.createOwner();
  await f.final("live-answer", "The corrected answer.");
  const reopened = (await f.replies())[0].assistant;
  assert.equal(reopened.messageId, saved.messageId);
  assert.equal(reopened.outputId, live.outputId);
  assert.equal(reopened.text, "The corrected answer.");
});

for (const failure of ["storage", "realtime", "history"]) {
  test(`original output owner preserves a final reply through ${failure} failure and exact recovery`, async () => {
    const f = await outputFixture();
    const { owner, sessionId, threadId, turnId, store } = f;
    f.history = [{ id: turnId, status: "completed", items: [outputItem("recover-final", "The complete reply.")] }];
    const write = store.writeConversationAssistantMessage;
    let unavailable = true;
    if (failure === "history") f.historyError = new Error("Native history temporarily unavailable");
    store.writeConversationAssistantMessage = (...args) => {
      if (unavailable && failure === "storage") throw new Error("Transcript unavailable");
      return write(...args);
    };
    f.onPublish = (_id, event) => {
      if (unavailable && failure === "realtime" && event.payload?.conversationLogPatch?.turn?.assistant) {
        throw new Error("Realtime unavailable");
      }
    };
    await assert.rejects(f.final("live-final", "The complete reply."));
    assert.equal((await store.readConversationLog(sessionId)).filter(row => row.assistant).length,
      failure === "realtime" ? 1 : 0);
    assert.equal(owner.readFinalAssistantResult(sessionId, threadId, turnId), null);
    unavailable = false;
    f.historyError = null;
    f.run = { ...f.run, state: "interrupted", providerStatus: "observation_lost" };
    assert.equal((await owner.submitAssistantResult(sessionId, threadId, turnId, { recoverFromProvider: true })).processed, true);
    assert.equal((await owner.submitAssistantResult(sessionId, threadId, turnId, { recoverFromProvider: true })).processed, true);
    assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.assistant ? [row.assistant.text] : []),
      ["The complete reply."]);
    assert.equal(f.publications.filter(event => event.payload?.conversationLogPatch?.turn?.assistant).length, 1);
  });
}

async function settlementFixture() {
  const f = await outputFixture();
  f.operations = [];
  f.checkpoints = [];
  f.store.writeAgentRunEvent = async (sessionId, runId, { event, patch }) => {
    assert.equal(sessionId, f.sessionId);
    assert.equal(runId, "codex_app_server");
    f.operations.push(`event:${event.kind}`);
    f.run = { ...f.run, ...structuredClone(patch), events: [...f.run.events, structuredClone(event)] };
    return structuredClone(f.run);
  };
  const runtime = { store: f.store, getSession: async sessionId => {
    assert.equal(sessionId, f.sessionId);
    return { sessionId, agentRuns: [structuredClone(f.run)] };
  } };
  f.owner = createCodexAppServerRunOwner({
    namespace: sessionId => `project:${sessionId}`,
    createRuntime: async () => runtime,
    createStore: async () => f.store,
    acquireProvider: async () => f.provider,
    idlePublishPayload: { refreshOutputs: true },
    async publish(sessionId, event) {
      assert.equal(sessionId, f.sessionId);
      await f.onPublish?.(sessionId, event);
      f.operations.push(event.reason);
      f.publications.push(structuredClone(event));
    },
    async checkpoint(sessionId, input) {
      f.operations.push("checkpoint");
      f.checkpoints.push({ sessionId, ...structuredClone(input) });
      return { outcome: input.status, outerTurnId: f.run.outerTurnId };
    }
  });
  return f;
}

test("original settlement shares finalization and persists its receipt before idle publication and checkpoint", async () => {
  const f = await settlementFixture();
  const { owner, sessionId, threadId, turnId, store } = f;
  f.history = [{ id: turnId, status: "completed", items: [outputItem("final", "The complete reply.")] }];
  const writing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const write = store.writeConversationAssistantMessage;
  store.writeConversationAssistantMessage = async (...args) => {
    writing.resolve();
    await release.promise;
    return write(...args);
  };
  const first = owner.finalizeAssistantResult(sessionId, threadId, turnId, { recoverFromProvider: true });
  await writing.promise;
  const second = owner.finalizeAssistantResult(sessionId, threadId, turnId, { recoverFromProvider: true });
  assert.equal(owner.resultFinalizations.size, 1);
  release.resolve();
  assert.deepEqual(await first, { ok: true, processed: true, reason: "assistant_response" });
  assert.deepEqual(await second, await first);
  assert.deepEqual(f.operations, ["assistant-response-bundle", "event:codex-app-server-result-processed",
    "event:codex-app-server-turn-idle", "codex-app-server-turn-idle", "checkpoint"]);
  assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-result-processed").length, 1);
  assert.equal(f.run.state, "completed");
  assert.equal(f.run.outerTurnId, "request-1");
  assert.equal(f.run.inputSource, "chat");
  assert.equal((await f.replies()).length, 1);
  assert.deepEqual(f.checkpoints, [{ sessionId, status: "completed", turnOutcome: "", threadId, turnId }]);
  const idle = f.publications.find(event => event.reason === "codex-app-server-turn-idle");
  assert.equal(idle.payload.refreshOutputs, true);
  assert.equal(idle.payload.agentSession.turn.outerTurnId, "request-1");
  assert.equal(idle.payload.agentSession.turn.active, false);
  assert.equal(owner.resultFinalizations.size, 0);
  assert.equal(owner.processedTurns.size, 0);
  assert.deepEqual(await owner.finalizeAssistantResult(sessionId, threadId, turnId),
    { ok: true, processed: true, reason: "already_finalized" });
  assert.equal(f.checkpoints.length, 1);
});

test("original settlement uses durable processed-result evidence after restart without rereading or republishing output", async () => {
  const f = await settlementFixture();
  const { owner, sessionId, threadId, turnId, store } = f;
  await store.writeConversationAssistantMessage(sessionId, { messageId: "already-saved", text: "Saved before restart." });
  f.run = { ...f.run, state: "finalizing", providerStatus: "completed", events: [
    { kind: "codex-app-server-result-processed", providerThreadId: threadId, providerTurnId: turnId,
      resultReason: "assistant_response" }
  ] };
  f.historyError = new Error("Finalization must use its durable processed receipt");
  assert.deepEqual(await owner.finalizeAssistantResult(sessionId, threadId, turnId, { recoverFromProvider: true }),
    { ok: true, processed: true, reason: "assistant_response" });
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["Saved before restart."]);
  assert.equal(f.pages.length, 0);
  assert.equal(f.publications.filter(event => event.reason === "assistant-response-bundle").length, 0);
  assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-result-processed").length, 1);
  assert.equal(f.run.state, "completed");
  assert.equal(f.checkpoints.length, 1);
});

test("original settlement rereads the native owner after output and cannot release an adopted successor", async () => {
  const f = await settlementFixture();
  const { owner, sessionId, threadId, turnId } = f;
  f.history = [{ id: turnId, status: "completed", items: [outputItem("final", "Predecessor reply.")] }];
  const publishing = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.onPublish = async (_sessionId, event) => {
    if (event.reason !== "assistant-response-bundle") return;
    publishing.resolve();
    await release.promise;
  };
  const pending = owner.finalizeAssistantResult(sessionId, threadId, turnId, { recoverFromProvider: true });
  await publishing.promise;
  f.run = { ...f.run, providerTurnId: "successor", state: "active", providerStatus: "inProgress" };
  release.resolve();
  assert.deepEqual(await pending, { ok: true, processed: true, reason: "stale_turn_state" });
  assert.equal(f.run.providerTurnId, "successor");
  assert.equal(f.run.state, "active");
  assert.equal(f.run.outerTurnId, "request-1");
  assert.deepEqual(f.checkpoints, []);
  assert.equal(f.publications.some(event => event.reason === "codex-app-server-turn-idle"), false);
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["Predecessor reply."]);
  assert.equal(owner.processedTurns.size, 0);
  assert.equal(owner.finalizedTurns.has(owner.resultFinalizationKey(sessionId, threadId, turnId)), true);
});

test("original settlement clears the same recovery timers and skips stale idle checkpoints", async t => {
  const f = await settlementFixture();
  const { owner, sessionId, threadId, turnId } = f;
  const timers = [];
  const timer = () => { const value = setTimeout(() => {}, 60_000); value.unref(); timers.push(value); return value; };
  t.after(() => timers.forEach(clearTimeout));
  owner.activeTimers.set(`project:${sessionId}`, timer());
  owner.activeTimers.set("project:other", timer());
  owner.finalizingTimers.set(owner.resultFinalizationKey(sessionId, threadId, turnId), timer());
  owner.finalizingTimers.set(owner.resultFinalizationKey(sessionId, threadId, "older"), timer());
  owner.finalizingTimers.set(owner.resultFinalizationKey("other", threadId, turnId), timer());
  f.run = { ...f.run, state: "interrupted", providerStatus: "interrupted" };
  const result = await owner.markTurnIdle(sessionId, { threadId, turnId, status: "completed" });
  assert.equal(result.processed, false);
  assert.equal(result.reason, "stale_terminal_turn_state");
  assert.deepEqual(f.checkpoints, []);
  assert.deepEqual(f.publications, []);
  assert.equal(owner.activeTimers.has(`project:${sessionId}`), false);
  assert.equal(owner.finalizingTimers.has(owner.resultFinalizationKey(sessionId, threadId, turnId)), false);
  owner.clearSessionRecoveryTimers(sessionId);
  assert.deepEqual([...owner.activeTimers.keys()], ["project:other"]);
  assert.deepEqual([...owner.finalizingTimers.keys()], [owner.resultFinalizationKey("other", threadId, turnId)]);
});

async function receiptFixture(options = {}) {
  const f = await settlementFixture();
  f.metadata = new Map();
  f.listeners = new Set();
  f.observationFailures = [];
  f.generation = 1;
  f.subscriptions = 0;
  f.unsubscriptions = 0;
  f.store.readMetadataValue = async (sessionId, key) => {
    assert.equal(sessionId, f.sessionId);
    return f.metadata.get(key) ?? null;
  };
  const writeUser = f.store.writeConversationUserMessage;
  f.store.writeConversationUserMessage = async (...args) => {
    const written = await writeUser(...args);
    f.operations.push("authored-message");
    return written;
  };
  Object.assign(f.provider, {
    currentConnectionGeneration: () => f.generation,
    failObservation(error) { f.observationFailures.push(error); },
    subscribe(listener) {
      f.subscriptions += 1;
      f.listeners.add(listener);
      return () => { f.unsubscriptions += 1; f.listeners.delete(listener); };
    },
    async readThreadStatus() {
      return { raw: { status: f.run?.providerStatus || "idle" } };
    }
  });
  f.runtime = { store: f.store, getSession: async sessionId => {
    assert.equal(sessionId, f.sessionId);
    return { sessionId, agentRuns: f.run ? [structuredClone(f.run)] : [] };
  } };
  f.owner = createCodexAppServerRunOwner({
    namespace: sessionId => `project:${sessionId}`,
    createRuntime: async () => f.runtime,
    createStore: async () => f.store,
    acquireProvider: async () => f.provider,
    deliveryStateMetadataKey: "authorized-delivery",
    async publish(sessionId, event) {
      assert.equal(sessionId, f.sessionId);
      await f.onPublish?.(sessionId, event);
      f.operations.push(event.reason);
      f.publications.push(structuredClone(event));
    },
    ...options
  });
  f.emit = notification => { for (const listener of f.listeners) listener(notification); };
  f.observe = () => f.owner.subscribeEvents(f.sessionId, f.provider, f.threadId, { providerKey: "account-scope" });
  f.drain = () => f.owner.notificationQueue.drain(f.sessionId);
  f.receipt = (messageId, text = "Expanded private context") => ({
    method: "item/completed", params: {
      threadId: f.threadId, turnId: f.turnId,
      item: { type: "userMessage", id: `receipt-${messageId}`, clientId: messageId,
        content: [{ type: "text", text }] }
    }
  });
  return f;
}

test("original receipt owner persists authored metadata before releasing the receipt and queued answer", async () => {
  const decorating = Promise.withResolvers();
  const release = Promise.withResolvers();
  const actorContext = { id: "actor-1" };
  const metadataCalls = [];
  const f = await receiptFixture({ messageMetadata: {
    async actor(context) {
      assert.equal(context, actorContext);
      metadataCalls.push("actor");
      return { actorId: context.id, actorDisplayName: "Actor" };
    },
    async delivered(store, sessionId, value) {
      assert.equal(store, f.store);
      assert.equal(sessionId, f.sessionId);
      metadataCalls.push("delivered");
      decorating.resolve();
      await release.promise;
      return { ...value, engineId: "codex" };
    }
  } });
  const messageId = "authored-request";
  f.run = { ...f.run, state: "starting", providerTurnId: "", pendingUserMessageClientIds: [messageId] };
  const receipt = Promise.withResolvers();
  let received = false;
  receipt.promise.then(() => { received = true; f.operations.push("receipt"); });
  f.owner.pendingUserMessages.set(`project:${f.sessionId}\0${messageId}`, {
    attachments: [{ id: "attachment-1", name: "Diagram" }], actorContext,
    turnMetadata: { actorId: "saved-actor", label: "authored" }, receipt,
    text: "Review the diagram."
  });
  f.observe();
  f.emit(f.receipt(messageId));
  f.emit({ method: "item/completed", params: { threadId: f.threadId, turnId: f.turnId,
    item: outputItem("early-commentary", "I am reviewing the diagram.", "commentary") } });
  await decorating.promise;
  assert.equal(received, false);
  assert.equal(await f.store.conversationMessageIdExists(f.sessionId, messageId), false);
  assert.equal(f.publications.some(event => event.payload?.conversationLogPatch?.turn?.commentary), false);
  release.resolve();
  await f.drain();
  assert.deepEqual(await receipt.promise, { id: f.turnId });
  const turns = await f.store.readConversationLog(f.sessionId);
  const authored = turns.find(row => row.user?.messageId === messageId);
  assert.equal(authored.user.text, "Review the diagram.");
  assert.equal(authored.metadata.actorId, "saved-actor");
  assert.equal(authored.metadata.actorDisplayName, "Actor");
  assert.equal(authored.metadata.engineId, "codex");
  assert.equal(authored.metadata.label, "authored");
  assert.deepEqual(authored.user.attachments, [{ id: "attachment-1", name: "Diagram" }]);
  assert.equal(JSON.stringify(turns).includes("Expanded private context"), false);
  assert.deepEqual(turns.flatMap(row => row.commentary || []).map(value => value.text), ["I am reviewing the diagram."]);
  assert.deepEqual(metadataCalls, ["actor", "delivered"]);
  assert.deepEqual(f.run.pendingUserMessageClientIds, []);
  assert.ok(f.operations.indexOf("authored-message") < f.operations.indexOf("event:codex-app-server-user-message-consumed"));
  assert.ok(f.operations.indexOf("event:codex-app-server-user-message-consumed") < f.operations.indexOf("receipt"));
  assert.equal(f.observationFailures.length, 0);
});

test("original receipt owner recovers the exact saved authored request once after restart", async () => {
  const f = await receiptFixture();
  const messageId = "saved-request";
  f.run = { ...f.run, state: "starting", providerTurnId: "", pendingUserMessageClientIds: [] };
  f.metadata.set("authorized-delivery", JSON.stringify({ engines: { codex: { pending: {
    messageId, threadId: f.threadId,
    message: "Private prepared prompt", displayMessage: "Continue the saved request.",
    displayAttachments: [{ id: "saved-file", name: "Notes" }],
    turnMetadata: { actorId: "original-author", label: "frozen" }
  } } } }));
  f.observe();
  f.emit(f.receipt(messageId));
  await f.drain();
  f.emit(f.receipt(messageId));
  await f.drain();
  const rows = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === messageId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user.text, "Continue the saved request.");
  assert.deepEqual(rows[0].user.attachments, [{ id: "saved-file", name: "Notes" }]);
  assert.equal(rows[0].metadata.actorId, "original-author");
  assert.equal(rows[0].metadata.label, "frozen");
  assert.equal(JSON.stringify(rows).includes("Private prepared prompt"), false);
  assert.equal(f.operations.filter(value => value === "authored-message").length, 1);
  assert.equal(f.run.providerTurnId, f.turnId);
  assert.equal(f.run.inputSource, "chat");
  assert.deepEqual(f.run.pendingUserMessageClientIds, []);
  assert.equal(f.observationFailures.length, 0);
});

test("original receipt owner keeps successor ownership through goal completion and ignores the completed predecessor", async () => {
  const f = await receiptFixture();
  const predecessor = f.turnId;
  f.run = { ...f.run, state: "finalizing", providerStatus: "completed",
    providerGoalStatus: "active", providerGoalThreadId: f.threadId };
  f.observe();
  f.emit({ method: "turn/started", params: { threadId: f.threadId, turn: { id: "successor", status: "inProgress" } } });
  await f.drain();
  f.emit({ method: "turn/started", params: { threadId: f.threadId, turn: { id: predecessor, status: "inProgress" } } });
  await f.drain();
  assert.equal(f.run.providerTurnId, "successor");
  assert.equal(f.run.outerTurnId, "request-1");
  assert.equal(f.run.inputSource, "chat");
  assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-turn-continued").length, 1);
  f.run.providerStatus = "completed";
  f.history = [{ id: "successor", status: "completed", items: [outputItem("goal-reply", "The goal reply.")] }];
  f.emit({ method: "turn/completed", params: { threadId: f.threadId, turn: { id: "successor", status: "completed" } } });
  await f.drain();
  assert.equal(f.run.state, "finalizing");
  assert.equal(f.owner.finalizingTimers.size, 0);
  f.emit({ method: "thread/goal/cleared", params: { threadId: "another-thread" } });
  await f.drain();
  assert.equal(f.run.providerGoalStatus, "active");
  f.emit({ method: "thread/goal/cleared", params: { threadId: f.threadId } });
  await f.drain();
  assert.equal(f.run.state, "completed");
  assert.equal(f.run.providerTurnId, "successor");
  assert.equal(f.run.outerTurnId, "request-1");
  assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-result-processed").length, 1);
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["The goal reply."]);
  assert.equal(f.observationFailures.length, 0);
});

test("original receipt owner renews only stale subscriptions and attaches an idle binding without inventing a run", async () => {
  const f = await receiptFixture();
  f.run = null;
  assert.deepEqual(f.observe(), { ok: true, status: "subscribed" });
  await f.drain();
  assert.equal(f.run, null);
  assert.deepEqual(f.operations, []);
  assert.deepEqual(f.observe(), { ok: true, status: "alreadySubscribed" });
  assert.equal(f.subscriptions, 1);
  f.generation = 2;
  assert.deepEqual(f.observe(), { ok: true, status: "resubscribed" });
  await f.drain();
  assert.equal(f.subscriptions, 2);
  assert.equal(f.unsubscriptions, 1);
  assert.equal(f.listeners.size, 1);
  assert.equal(f.run, null);
  const failure = new Error("Subscription unavailable");
  f.provider.subscribe = () => { throw failure; };
  assert.throws(() => f.owner.subscribeEvents(f.sessionId, f.provider, f.threadId, { providerKey: "other-scope" }),
    error => error === failure);
  await f.drain();
  assert.deepEqual(f.observationFailures, [failure]);
  assert.equal(f.owner.eventSubscriptions.has(`other-scope:${f.threadId}`), false);
});

test("original receipt owner cannot undo Stop with a provider observation started before its durable revision", async () => {
  const f = await receiptFixture();
  const reading = Promise.withResolvers();
  const observed = Promise.withResolvers();
  f.provider.readThreadStatus = async () => {
    reading.resolve();
    return observed.promise;
  };
  const pending = f.owner.reconcileThreadStatus(f.sessionId, f.provider, f.threadId);
  await reading.promise;
  f.run = { ...f.run, state: "interrupted", providerStatus: "interrupted", events: [
    ...f.run.events, { kind: "user-stop", providerThreadId: f.threadId, providerTurnId: f.turnId }
  ] };
  observed.resolve({ raw: { status: "active", turnId: f.turnId } });
  await pending;
  assert.equal(f.run.state, "interrupted");
  assert.equal(f.run.providerStatus, "interrupted");
  assert.equal(f.run.providerTurnId, f.turnId);
  assert.equal(f.run.events.at(-1).kind, "user-stop");
  assert.equal(f.publications.some(event => event.payload?.agentRun?.state === "active"), false);
});

async function goalCommandContext(f, threadId = f.threadId) {
  return { runtime: f.runtime, session: await f.runtime.getSession(f.sessionId),
    provider: f.provider, threadId, providerKey: "account-scope" };
}

test("original goal command prepares the first conversation and subscribes before native activation", async () => {
  const f = await receiptFixture();
  const calls = [];
  f.run = null;
  const writeRun = f.store.writeAgentRunEvent;
  f.store.writeAgentRunEvent = (...args) => {
    f.run ||= { id: "codex_app_server", events: [] };
    return writeRun(...args);
  };
  f.provider.readGoal = async threadId => {
    assert.equal(threadId, f.threadId);
    calls.push("read-goal");
    return { goal: null };
  };
  f.provider.setGoal = async (threadId, input) => {
    assert.equal(f.listeners.size, 1, "A goal needs an observer before activation");
    calls.push("set-goal");
    return { goal: { ...input, threadId, status: "active", createdAt: 10 } };
  };
  const result = await f.owner.updateGoal(f.sessionId,
    { action: "set", threadId: "", objective: "Finish the fixture", tokenBudget: 5000 }, {
      context: await goalCommandContext(f, ""),
      async prepareConversation() {
        calls.push("prepare");
        return goalCommandContext(f);
      }
    });
  await f.drain();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.goal.objective, "Finish the fixture");
  assert.equal(result.goal.tokenBudget, 5000);
  assert.equal(result.threadId, f.threadId);
  assert.deepEqual(calls, ["prepare", "read-goal", "set-goal"]);
  assert.equal(f.run.providerGoalStatus, "active");
  assert.equal(f.run.state, "completed", "The native scheduler has not started a provider turn");
  assert.equal(Boolean(f.run.providerTurnId), false);
  assert.equal(f.subscriptions, 1);
  assert.equal(f.observationFailures.length, 0);
});

test("original goal command rejects stale identity and pauses or resumes without interrupting its turn", async () => {
  const f = await receiptFixture();
  const goal = { threadId: f.threadId, status: "active", objective: "Finish fixture", createdAt: 10, tokensUsed: 99 };
  const calls = [];
  f.provider.readGoal = async () => ({ goal: { ...goal } });
  f.provider.setGoalStatus = async (threadId, status) => {
    assert.equal(threadId, goal.threadId);
    assert.equal(f.listeners.size, 1);
    calls.push(status);
    goal.status = status;
    return { goal: { ...goal } };
  };
  f.provider.interruptTurn = async () => assert.fail("Pausing a goal must not interrupt its turn");
  f.provider.resumeThread = async () => assert.fail("Ordinary goal Resume must keep its current conversation");
  const input = { action: "pause", threadId: goal.threadId, objective: goal.objective, createdAt: goal.createdAt };
  const options = { context: await goalCommandContext(f) };
  for (const stale of [{ threadId: "another-thread" }, { objective: "older goal" }, { createdAt: 9 }]) {
    assert.equal((await f.owner.updateGoal(f.sessionId, { ...input, ...stale }, options)).ok, false);
  }
  assert.deepEqual(calls, []);
  const paused = await f.owner.updateGoal(f.sessionId, input, options);
  assert.equal(paused.ok, true, JSON.stringify(paused));
  assert.deepEqual(calls, ["paused"]);
  assert.equal(f.run.state, "active");
  const resumed = await f.owner.updateGoal(f.sessionId, { ...input, action: "resume" }, options);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.goal.tokensUsed, 99);
  assert.deepEqual(calls, ["paused", "active"]);
  assert.equal(f.subscriptions, 1, "Goal controls added another listener for the same provider");
  for (const status of ["complete", "budgetLimited"]) {
    goal.status = status;
    assert.equal((await f.owner.updateGoal(f.sessionId, { ...input, action: "resume" }, options)).ok, false);
    assert.equal((await f.owner.updateGoal(f.sessionId, input, options)).ok, false);
  }
  await f.drain();
  assert.deepEqual(calls, ["paused", "active"]);
  assert.equal(f.observationFailures.length, 0);
});

test("original goal command recovers saved output and clears the stopped barrier only for exact explicit Resume", async () => {
  const f = await receiptFixture();
  const goal = { threadId: f.threadId, status: "paused", objective: "Finish fixture", createdAt: 10, tokensUsed: 99 };
  f.run = { ...f.run, active: false, state: "interrupted", providerStatus: "observation_lost" };
  f.history = [{ id: f.turnId, status: "completed", items: [outputItem("before-loss", "Saved before observation was lost.")] }];
  f.provider.readGoal = async () => ({ goal: { ...goal } });
  const resumeOptions = { model: "authorized-model", cwd: "/authorized/project" };
  const context = await goalCommandContext(f);
  Object.defineProperty(context, "resumeOptions", { get() {
    f.operations.push("resume-options");
    assert.equal(f.run.events.at(-1).kind, "codex-observation-explicit-resume");
    return resumeOptions;
  } });
  f.provider.resumeThread = async (threadId, options) => {
    assert.equal(threadId, f.threadId);
    assert.equal(options, resumeOptions);
    assert.equal(f.listeners.size, 1, "Resume requires its observer first");
    assert.notEqual(f.run.providerStatus, "observation_lost");
    f.operations.push("resume-thread");
  };
  f.provider.setGoalStatus = async (_threadId, status) => {
    f.operations.push("set-goal-status");
    assert.equal(f.run.providerStatus, "interrupted");
    goal.status = status;
    return { goal: { ...goal } };
  };
  const result = await f.owner.updateGoal(f.sessionId,
    { action: "resume", threadId: f.threadId, objective: goal.objective, createdAt: goal.createdAt }, { context });
  await f.drain();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.goal.status, "active");
  assert.equal(result.goal.tokensUsed, 99);
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["Saved before observation was lost."]);
  const ordered = ["assistant-response-bundle", "event:codex-observation-explicit-resume",
    "resume-options", "resume-thread", "set-goal-status"].map(value => f.operations.indexOf(value));
  assert.ok(ordered.every(index => index >= 0));
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
  assert.equal(f.run.events.filter(event => event.kind === "codex-observation-explicit-resume").length, 1);
  assert.equal(f.run.providerThreadId, f.threadId);
  assert.equal(f.observationFailures.length, 0);
});

test("original goal command preserves a failed cancellation for retry without resuming or interrupting", async () => {
  const f = await receiptFixture();
  const goal = { threadId: f.threadId, status: "blocked", objective: "Finish fixture", createdAt: 10 };
  f.provider.readGoal = async () => ({ goal });
  f.provider.clearGoal = async () => { throw new Error("Codex unavailable"); };
  f.provider.resumeThread = async () => assert.fail("Cancel must not resume the conversation");
  f.provider.interruptTurn = async () => assert.fail("Cancel must preserve the current ordinary turn");
  const before = structuredClone(f.run);
  await assert.rejects(f.owner.updateGoal(f.sessionId, { ...goal, action: "cancel" }, {
    context: await goalCommandContext(f)
  }), /Codex unavailable/);
  await f.drain();
  assert.deepEqual((await f.provider.readGoal()).goal, goal);
  assert.deepEqual(f.run, before);
  assert.equal(f.publications.length, 0);
});

// Original start/steer assertions retain the public admission and Git fixtures.
// These bounded cases cover only the moved dispatch/receipt boundary and the
// ownership adaptations: supplied settings, Error identity and result projection.
function commandThreadFixture(f, providerAlreadyAvailable) {
  Object.assign(f.provider, {
    async ensureRuntime() { return {}; },
    async resumeThread(threadId) { return { id: threadId }; }
  });
  return {
    provider: f.provider,
    providerAlreadyAvailable,
    observerOptions: { providerKey: "account-scope" },
    preparation: {
      settings: async () => ({ threadSettings: {} }),
      identity: { read: () => f.threadId, async write() {} }
    }
  };
}

test("original main command keeps preparation order and returns only after its authored receipt", async t => {
  const actorContext = { id: "author-1" };
  const f = await receiptFixture({ messageMetadata: {
    async actor(actor) {
      assert.equal(actor, actorContext);
      f.operations.push("actor");
      return { actorId: actor.id };
    }
  } });
  t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
  f.run = { ...f.run, state: "completed", providerStatus: "completed", providerThreadId: "", providerTurnId: "" };
  const messageId = "main-command";
  const input = { messageId, message: "Transport input", displayMessage: "Authored input",
    turnMetadata: { label: "authored" },
    async onPromptSending() { f.operations.push("sending"); } };
  const prepare = {
    async readContext() {
      f.operations.push("context");
      const session = await f.runtime.getSession(f.sessionId);
      return { runtime: f.runtime, session, selection: { runtime: f.runtime, session, threadId: () => "" } };
    },
    threadPreparation(value, prepared) {
      assert.equal(value.messageId, messageId);
      assert.equal(f.run.state, "starting");
      assert.equal(f.run.outerTurnId, messageId);
      assert.equal(f.owner.promptDeliveries.has(`project:${f.sessionId}`), true);
      f.operations.push("thread-policy");
      prepared.activeThreadId = f.threadId;
      return { provider: async () => commandThreadFixture(f, true) };
    },
    async prepareMessage(value, prepared, { starting }) {
      assert.equal(starting, true);
      assert.equal(prepared.actorContext, actorContext);
      assert.equal(f.run.providerThreadId, f.threadId);
      assert.equal(f.run.providerStatus, "starting");
      f.operations.push("prompt-policy");
      return { renderedPrompt: "Expanded private context", get turnSettings() {
        f.operations.push("turn-settings");
        return { model: "authorized-model" };
      } };
    },
    async finishMessage(value, prepared, outcome) {
      assert.equal(Object.hasOwn(outcome, "error"), false);
      assert.equal(outcome.delivery.turn.id, f.turnId);
      f.operations.push("delivery-policy");
    }
  };
  f.provider.sendTurn = async (threadId, content, options) => {
    assert.equal(threadId, f.threadId);
    assert.deepEqual(content, ["Expanded private context"]);
    assert.equal(options.clientUserMessageId, messageId);
    assert.equal(options.model, "authorized-model");
    f.operations.push("native-send");
    return { id: f.turnId, status: "inProgress" };
  };
  const result = await f.owner.withMessageDelivery(f.sessionId, messageId, { text: input.displayMessage }, () =>
    f.owner.dispatchMessage(f.sessionId, input, { actorContext }, prepare));
  assert.equal(result.value.delivered, true);
  assert.equal(result.value.deliveryMode, "new_turn");
  assert.equal(result.value.connectionReused, true);
  assert.equal(result.value.turnId, f.turnId);
  assert.equal(result.value.conversationTurn.user.messageId, messageId);
  assert.equal(result.value.conversationTurn.user.text, "Authored input");
  assert.equal(result.value.conversationTurn.metadata.actorId, actorContext.id);
  assert.deepEqual(result.value.conversationTurns, [result.value.conversationTurn]);
  assert.equal(await f.store.conversationMessageIdExists(f.sessionId, messageId), true);
  assert.equal(f.owner.promptDeliveries.size, 0);
  assert.equal(f.owner.messageDeliveries.size, 0);
  assert.equal(f.owner.pendingUserMessages.size, 0);
  const expected = ["context", "actor", "context", "actor", "event:codex-app-server-turn-claimed",
    "codex-app-server-turn-claimed", "thread-policy", "prompt-policy",
    "event:codex-app-server-user-message-owned", "sending", "turn-settings", "native-send",
    "delivery-policy", "authored-message", "codex-app-server-message-delivered"];
  assert.deepEqual(f.operations.filter(value => expected.includes(value)), expected);

  f.operations.length = 0;
  const duplicate = await f.owner.dispatchMessage(f.sessionId, input, { actorContext }, prepare);
  assert.equal(duplicate.value.operationOutcome, "message_already_delivered");
  assert.equal(duplicate.value.duplicate, true);
  assert.deepEqual(f.operations, ["context"]);
});

test("original main command retains exact failure identity and prompt cleanup positions", async t => {
  for (const failureAt of ["thread-policy", "native-send", "unavailable-return"]) await t.test(failureAt, async () => {
    const f = await receiptFixture();
    t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
    f.run = { ...f.run, state: "completed", providerStatus: "completed", providerThreadId: "", providerTurnId: "" };
    const failure = Object.assign(new Error("Original failure"), { code: -32600 });
    const finishing = Promise.withResolvers();
    const release = Promise.withResolvers();
    const promptReleased = Promise.withResolvers();
    const deletePrompt = f.owner.promptDeliveries.delete.bind(f.owner.promptDeliveries);
    f.owner.promptDeliveries.delete = key => {
      const deleted = deletePrompt(key);
      promptReleased.resolve();
      return deleted;
    };
    const messageId = `main-${failureAt}`;
    const key = `project:${f.sessionId}`;
    const prepare = {
      async readContext() {
        const session = await f.runtime.getSession(f.sessionId);
        return { runtime: f.runtime, session, selection: { runtime: f.runtime, session, threadId: () => "" } };
      },
      threadPreparation(input, prepared) {
        prepared.activeThreadId = f.threadId;
        if (failureAt !== "native-send") throw failure;
        return { provider: async () => commandThreadFixture(f) };
      },
      async prepareMessage() { return { renderedPrompt: "Prompt" }; },
      async finishMessage(input, prepared, { error }) {
        assert.equal(error, failure);
        assert.equal(prepared.activeThreadId, f.threadId);
        finishing.resolve();
        if (failureAt === "unavailable-return") return { value: release.promise };
        await release.promise;
        throw error;
      }
    };
    f.provider.sendTurn = async () => { throw failure; };
    const delivery = f.owner.withMessageDelivery(f.sessionId, messageId, { text: "Authored" }, () =>
      f.owner.dispatchMessage(f.sessionId, { messageId, message: "Authored" }, {}, prepare));
    void delivery.catch(() => null);
    await finishing.promise;
    assert.equal(f.run.providerThreadId, f.threadId);
    assert.equal(f.run.state, "failed");
    assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-turn-idle").length, 1);
    if (failureAt === "unavailable-return") {
      // The original catch returns this policy Promise without awaiting it.
      await promptReleased.promise;
      assert.equal(f.owner.promptDeliveries.has(key), false);
      const unavailable = { ok: false, error: "Original worktree policy" };
      release.resolve(unavailable);
      assert.deepEqual(await delivery, { value: unavailable });
    } else {
      assert.equal(f.owner.promptDeliveries.has(key), true);
      release.resolve();
      await assert.rejects(delivery, error => error === failure);
    }
    assert.equal(f.owner.promptDeliveries.has(key), false);
    assert.equal(f.owner.messageDeliveries.size, 0);
    assert.equal(f.owner.pendingUserMessages.size, 0);
  });
});

test("original dispatch prompt keeps authored input and evaluates authorized settings after validation", async () => {
  const providerCalls = [];
  const provider = {
    async sendTurn(threadId, input, params) {
      providerCalls.push({ input, params, threadId });
      return { id: "turn-1" };
    }
  };
  const authorized = {
    get turnSettings() {
      return { sandboxPolicy: { networkAccess: "enabled", type: "externalSandbox" } };
    }
  };
  const authoredText = "  Do the work.\n";
  const result = await sendCodexAppServerPrompt({ prompt: authoredText, provider, threadId: "thread-1" }, authorized);
  assert.equal(result.turn.id, "turn-1");
  assert.deepEqual(result.input, [authoredText]);
  assert.deepEqual(providerCalls[0].input, [authoredText]);
  assert.equal(providerCalls[0].threadId, "thread-1");
  assert.deepEqual(providerCalls[0].params.sandboxPolicy, {
    networkAccess: "enabled",
    type: "externalSandbox"
  });
  assert.equal(providerCalls[0].params.outputSchema, undefined);

  const order = [];
  const outputSchema = { properties: { kind: { enum: ["continue", "complete"], type: "string" } }, required: ["kind"], type: "object" };
  const attachments = [{ contentType: "image/png", get path() { order.push("image"); return "/authorized/diagram.png"; } }];
  const settings = { get turnSettings() { order.push("settings"); return { model: "authorized-model", sandboxPolicy: { type: "externalSandbox" } }; } };
  await assert.rejects(sendCodexAppServerPrompt({ prompt: " \n", attachments, provider }, settings),
    { message: "Codex app-server prompt is empty." });
  assert.deepEqual(order, []);
  await sendCodexAppServerPrompt({ prompt: authoredText, attachments, clientUserMessageId: " request-1 ",
    outputSchema, readOnly: true, provider, threadId: "thread-1" }, settings);
  assert.deepEqual(order, ["image", "settings"]);
  assert.deepEqual(providerCalls[1].input, [authoredText, { type: "localImage", path: "/authorized/diagram.png" }]);
  assert.equal(providerCalls[1].params.outputSchema, outputSchema);
  assert.equal(providerCalls[1].params.clientUserMessageId, "request-1");
  assert.equal(providerCalls[1].params.model, "authorized-model");
  assert.deepEqual(providerCalls[1].params.sandboxPolicy, { networkAccess: false, type: "readOnly" });
  await sendCodexAppServerPrompt({ prompt: authoredText, provider, outputSchema: [] }, authorized);
  assert.equal(providerCalls[2].params.outputSchema, undefined);
});

function dispatchContext(f, messageId = "dispatch-request") {
  return {
    runtime: f.runtime, provider: f.provider, threadId: f.threadId, turnId: f.turnId,
    promptDeliveryKey: `project:${f.sessionId}`, messageId, clientUserMessageId: messageId,
    renderedPrompt: "Expanded private context", message: "Expanded private context",
    displayMessage: "Keep the change focused.", turnMetadata: { actorId: "original-author" },
    turnSettings: { model: "authorized-model" }
  };
}

test("original dispatch start waits for a persisted receipt and ignores its late RPC reply after successor adoption", async t => {
  const persisting = Promise.withResolvers();
  const persist = Promise.withResolvers();
  const acknowledgement = Promise.withResolvers();
  const f = await receiptFixture({ messageMetadata: { async delivered(_store, _sessionId, metadata) {
    persisting.resolve();
    await persist.promise;
    return metadata;
  } } });
  t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
  const context = dispatchContext(f);
  const messageId = context.messageId;
  const receipt = Promise.withResolvers();
  f.run = { ...f.run, state: "starting", providerTurnId: "", outerTurnId: messageId };
  f.owner.pendingUserMessages.set(`${context.promptDeliveryKey}\0${messageId}`, {
    text: context.displayMessage, turnMetadata: context.turnMetadata, receipt
  });
  let rpcReplies = 0;
  let returned = false;
  f.provider.sendTurn = async (threadId, input, params) => {
    assert.equal(threadId, f.threadId);
    assert.deepEqual(input, [context.renderedPrompt]);
    assert.equal(params.clientUserMessageId, messageId);
    assert.equal(params.model, "authorized-model");
    f.emit(f.receipt(messageId));
    await acknowledgement.promise;
    rpcReplies += 1;
    return { id: f.turnId, status: "inProgress" };
  };
  f.observe();
  const sending = f.owner.startTurn(f.sessionId, {
    async onPromptSending({ threadId }) {
      assert.equal(threadId, f.threadId);
      assert.deepEqual(f.run.pendingUserMessageClientIds, [messageId]);
    }
  }, context).then(value => { returned = true; return value; });
  await persisting.promise;
  assert.equal(returned, false);
  assert.equal(await f.store.conversationMessageIdExists(f.sessionId, messageId), false);
  persist.resolve();
  const result = await sending;
  await f.drain();
  assert.equal(result.deliveredTurnId, f.turnId);
  assert.equal(result.providerFailure, "");
  assert.equal(rpcReplies, 0);
  assert.equal((await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === messageId).length, 1);
  assert.equal(JSON.stringify(await f.store.readConversationLog(f.sessionId)).includes("Expanded private context"), false);
  f.run = { ...f.run, state: "finalizing", providerStatus: "completed",
    providerGoalStatus: "active", providerGoalThreadId: f.threadId };
  f.emit({ method: "turn/started", params: { threadId: f.threadId, turn: { id: "successor", status: "inProgress" } } });
  await f.drain();
  acknowledgement.resolve();
  await acknowledgement.promise;
  await f.drain();
  assert.equal(f.run.providerTurnId, "successor");
  assert.equal(f.run.state, "active");
  assert.equal(f.observationFailures.length, 0);
});

test("original dispatch start preserves the handled Error identity and leaves outer failures to its caller", async () => {
  const f = await receiptFixture();
  const context = dispatchContext(f);
  const failure = Object.assign(new Error("Native request rejected"), { code: -32600, method: "turn/start" });
  f.run = { ...f.run, state: "starting", providerTurnId: "" };
  f.provider.sendTurn = async () => { throw failure; };
  const result = await f.owner.startTurn(f.sessionId, {
    async onPromptRejected() {
      assert.deepEqual(f.run.pendingUserMessageClientIds, [context.messageId]);
      f.operations.push("rejected");
    }
  }, context);
  assert.equal(result.error, failure);
  assert.equal(result.turnFailureHandled, true);
  assert.deepEqual(f.run.pendingUserMessageClientIds, []);
  assert.equal(f.run.state, "failed");
  assert.equal(f.run.error, failure.message);
  const ordered = ["event:codex-app-server-user-message-owned", "rejected",
    "event:codex-app-server-user-message-released", "event:codex-app-server-turn-idle"]
    .map(value => f.operations.indexOf(value));
  assert.ok(ordered.every(index => index >= 0));
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);
  assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-turn-idle").length, 1);

  const unacknowledged = await receiptFixture();
  unacknowledged.run = { ...unacknowledged.run, state: "starting", providerTurnId: "" };
  unacknowledged.provider.sendTurn = async () => ({});
  await assert.rejects(unacknowledged.owner.startTurn(unacknowledged.sessionId, {}, dispatchContext(unacknowledged)),
    { message: "Codex app-server accepted the prompt without returning a turn id." });
  assert.equal(unacknowledged.run.state, "starting");
  assert.equal(unacknowledged.run.events.some(event => event.kind === "codex-app-server-turn-idle"), false);
});

test("original dispatch steering persists the authored receipt while its exact native RPC remains pending", async t => {
  const f = await receiptFixture();
  t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
  const context = dispatchContext(f);
  const receipt = Promise.withResolvers();
  const acknowledgement = Promise.withResolvers();
  f.owner.pendingUserMessages.set(`${context.promptDeliveryKey}\0${context.messageId}`, {
    text: context.displayMessage, turnMetadata: context.turnMetadata,
    attachments: [{ id: "diagram", name: "Diagram" }], receipt
  });
  let rpcReplies = 0;
  f.provider.steerTurn = async (threadId, turnId, input, params) => {
    assert.equal(threadId, f.threadId);
    assert.equal(turnId, f.turnId);
    assert.deepEqual(input, [context.message, { type: "localImage", path: "/authorized/diagram.png" }]);
    assert.equal(params.clientUserMessageId, context.messageId);
    f.emit(f.receipt(context.messageId));
    await acknowledgement.promise;
    rpcReplies += 1;
    return { ok: true };
  };
  f.observe();
  const response = await f.owner.steerTurn(f.sessionId, {
    attachments: [{ contentType: "image/png", path: "/authorized/diagram.png" }],
    displayAttachments: [{ id: "diagram", name: "Diagram" }],
    async onPromptSending({ threadId, displayAttachments, turnMetadata }) {
      assert.equal(threadId, f.threadId);
      assert.equal(turnMetadata, context.turnMetadata);
      assert.deepEqual(displayAttachments, [{ id: "diagram", name: "Diagram" }]);
      assert.deepEqual(f.run.pendingUserMessageClientIds, [context.messageId]);
    }
  }, context);
  await f.drain();
  assert.equal(response.value.ok, true, JSON.stringify(response.value));
  assert.equal(response.value.operationOutcome, "delivered_to_active_turn");
  assert.equal(response.value.conversationTurn.user.messageId, context.messageId);
  assert.equal(response.session.sessionId, f.sessionId);
  assert.equal(rpcReplies, 0);
  assert.deepEqual(f.run.pendingUserMessageClientIds, []);
  const rows = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === context.messageId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user.text, context.displayMessage);
  assert.deepEqual(rows[0].user.attachments, [{ id: "diagram", name: "Diagram" }]);
  assert.equal(rows[0].metadata.actorId, "original-author");
  acknowledgement.resolve();
  await acknowledgement.promise;
  assert.equal(f.observationFailures.length, 0);
});

test("original dispatch steering preserves deferred versus new-turn recovery and raw failure projection", async () => {
  for (const mode of ["invalid", "completed", "returned", "unrelated"]) {
    const f = await receiptFixture({ steerFailedCode: "authorized_steer_failure" });
    const context = dispatchContext(f);
    const failure = mode === "returned" ? { ok: false, error: "Native unavailable", retryable: false }
      : Object.assign(new Error("Native steer failed"), { code: mode === "unrelated" ? 5 : -32600, method: "turn/steer" });
    let rejections = 0;
    f.provider.readThreadStatus = async () => { throw new Error("Status temporarily unavailable"); };
    f.provider.steerTurn = async () => {
      if (mode === "completed") f.run = { ...f.run, state: "completed", providerStatus: "completed" };
      if (mode === "returned") return failure;
      throw failure;
    };
    const sending = f.owner.steerTurn(f.sessionId, { onPromptRejected() { rejections += 1; } }, context);
    if (mode === "unrelated") {
      await assert.rejects(sending, error => error === failure);
      assert.equal(rejections, 0);
    } else {
      const response = await sending;
      if (mode === "invalid") {
        assert.equal(response.value.operationOutcome, "active_turn_not_steerable");
        assert.equal(response.value.code, "authorized_steer_failure");
        assert.equal(response.value.retryable, true);
        assert.equal(response.session.sessionId, f.sessionId);
        assert.equal(rejections, 1);
      } else if (mode === "completed") {
        assert.equal(response.value.operationOutcome, "new_turn_required");
        assert.equal(response.value.reason, "active_turn_completed_before_delivery");
        assert.equal(response.value.threadId, f.threadId);
        assert.equal(response.value.turnId, f.turnId);
        assert.equal(response.session.sessionId, f.sessionId);
        assert.equal(rejections, 1);
      } else {
        assert.equal(response.value.operationOutcome, "steer_failed");
        assert.equal(response.value.result, failure);
        assert.equal(response.value.code, "authorized_steer_failure");
        assert.equal(Object.hasOwn(response, "session"), false);
        assert.equal(rejections, 0);
      }
    }
    assert.deepEqual(f.run.pendingUserMessageClientIds, []);
    assert.equal(f.operations.filter(value => value === "event:codex-app-server-user-message-released").length, 1);
    assert.equal((await f.store.readConversationLog(f.sessionId)).some(row => row.user?.messageId === context.messageId), false);
  }
});

function controlContext(f, overrides = {}) {
  return {
    runtime: f.runtime,
    admissionError: () => null,
    threadId: () => f.threadId,
    acquireProvider: async () => f.provider,
    observationOwner: () => null,
    ...overrides
  };
}

test("original control rechecks admission after preflight and before interrupt without adding a work lock", async () => {
  const f = await receiptFixture();
  const calls = [];
  let checks = 0;
  f.provider.readThreadStatus = async () => { calls.push("preflight"); return { status: "active", turnId: f.turnId }; };
  f.provider.interruptTurn = async () => assert.fail("Frozen admission must stop the native request");
  const response = await f.owner.interruptTurn(f.sessionId, { controlRequestId: "stop-1" }, controlContext(f, {
    admissionError() { checks += 1; calls.push(`admission-${checks}`); return checks === 3 ? new Error("Admission frozen") : null; },
    async acquireProvider() { calls.push("acquire"); return f.provider; }
  }));
  assert.deepEqual(calls, ["admission-1", "acquire", "preflight", "admission-2", "admission-3"]);
  assert.deepEqual(response, { value: { interrupted: false, ok: true, operationOutcome: "already_idle",
    status: "interrupted", threadId: f.threadId, turnId: f.turnId } });
  assert.equal(f.run.state, "active");
  assert.deepEqual(f.operations, []);
});

test("original control keeps an unverified stop blocked and retries only its retained observation owner", async () => {
  const f = await receiptFixture();
  f.run = { ...f.run, providerStatus: "observation_lost" };
  const context = controlContext(f, { acquireProvider: async () => assert.fail("Observation loss must not acquire a replacement") });
  const missing = await f.owner.interruptTurn(f.sessionId, {}, context);
  assert.equal(missing.value.ok, false);
  assert.equal(missing.value.error, "Codex's stop could not be verified. Its runtime owner is unavailable.");
  assert.equal(missing.session.agentRuns[0].providerStatus, "observation_lost");
  assert.equal(f.run.state, "active");
  const failure = new Error("Retained stop persistence failed");
  const observationFailure = new Error("Connection was lost");
  let available = false;
  const retained = {
    observationFailure,
    async failObservation(error) {
      assert.equal(error, observationFailure);
      if (!available) throw failure;
      f.run = { ...f.run, state: "interrupted" };
    }
  };
  context.observationOwner = threadId => { assert.equal(threadId, f.threadId); return retained; };
  await assert.rejects(f.owner.interruptTurn(f.sessionId, {}, context), error => error === failure);
  assert.equal(f.run.state, "active");
  available = true;
  const stopped = await f.owner.interruptTurn(f.sessionId, {}, context);
  assert.deepEqual(stopped.value, { ok: true, interrupted: true });
  assert.equal(stopped.session.agentRuns[0].state, "interrupted");
  assert.equal(f.run.providerStatus, "observation_lost");
});

test("original control preserves command-stop-unconfirmed even when preflight already reports idle", async () => {
  for (const providerPrefix of [undefined, "provider_"]) {
    const f = await receiptFixture({ errorPrefix: "host_" });
    if (providerPrefix !== undefined) f.provider.errorPrefix = providerPrefix;
    const failure = Object.assign(new Error("Owned command exit is unconfirmed"), {
      code: `${providerPrefix ?? "host_"}codex_command_stop_unconfirmed`
    });
    f.provider.readThreadStatus = async () => ({ status: "idle", turnId: f.turnId });
    f.provider.interruptTurn = async () => { throw failure; };
    await assert.rejects(f.owner.interruptTurn(f.sessionId, {}, controlContext(f)), error => error === failure);
    assert.equal(f.run.state, "active");
    assert.equal(f.run.events.some(event => event.kind === "codex-app-server-turn-idle"), false);
  }
});

test("original control follows native successors but bounds interrupt races to three attempts", async t => {
  const f = await receiptFixture();
  t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
  f.run = { ...f.run, providerGoalStatus: "active", providerGoalThreadId: f.threadId };
  let nativeTurnId = f.turnId;
  const interrupted = [];
  f.provider.readThreadStatus = async () => ({ status: "active", turnId: nativeTurnId });
  f.provider.interruptTurn = async (threadId, turnId) => {
    assert.equal(threadId, f.threadId);
    assert.equal(turnId, nativeTurnId);
    interrupted.push(turnId);
    nativeTurnId = `successor-${interrupted.length}`;
    throw Object.assign(new Error("Native turn changed"), { code: -32600, method: "turn/interrupt" });
  };
  const response = await f.owner.interruptTurn(f.sessionId, {}, controlContext(f));
  assert.deepEqual(interrupted, [f.turnId, "successor-1", "successor-2"]);
  assert.equal(f.run.providerTurnId, "successor-3");
  assert.equal(f.run.outerTurnId, "request-1");
  assert.equal(f.run.providerGoalStatus, "active");
  assert.equal(response.value.operationOutcome, "already_idle");
  assert.equal(response.value.turnId, "successor-2");
  assert.equal(response.session.agentRuns[0].providerTurnId, "successor-3");
});

test("original control settles a processed finalizing result before reporting an already idle turn", async () => {
  const f = await receiptFixture();
  f.run = { ...f.run, state: "finalizing", providerStatus: "completed", events: [
    { kind: "codex-app-server-result-processed", providerThreadId: f.threadId, providerTurnId: f.turnId,
      resultReason: "assistant_response" }
  ] };
  f.provider.readThreadStatus = async () => ({ status: "idle", turnId: f.turnId });
  f.provider.interruptTurn = async () => assert.fail("The saved processed result must settle without a new interrupt");
  const response = await f.owner.interruptTurn(f.sessionId, {}, controlContext(f));
  assert.equal(response.value.interrupted, false);
  assert.equal(response.value.operationOutcome, "already_idle");
  assert.equal(response.value.threadId, f.threadId);
  assert.equal(response.value.turnId, f.turnId);
  assert.equal(f.run.state, "completed");
  assert.equal(f.run.events.filter(event => event.kind === "codex-app-server-result-processed").length, 1);
  assert.equal(f.publications.some(event => event.reason === "assistant-response-bundle"), false);
});

test("original control stopped-proof recovery preserves the whole-run fence and never resumes work", async () => {
  for (const raced of [false, true]) {
    const f = await receiptFixture();
    f.run = { ...f.run, providerStatus: "observation_lost", error: "Native stop unavailable" };
    const observing = Promise.withResolvers();
    const release = Promise.withResolvers();
    f.provider.readGoal = async () => ({ goal: { status: "paused", createdAt: 10, tokensUsed: 20 } });
    f.provider.readThreadStatus = async () => { observing.resolve(); await release.promise; return { status: "idle" }; };
    f.provider.resumeThread = async () => assert.fail("Stopped proof must never resume a goal");
    f.provider.sendTurn = async () => assert.fail("Stopped proof must never send a new turn");
    const recovering = f.owner.recoverObservationLoss(f.runtime, await f.runtime.getSession(f.sessionId), controlContext(f));
    await observing.promise;
    if (raced) f.run = { ...f.run, error: "A newer stop proof owns this run" };
    release.resolve();
    const recovered = await recovering;
    if (raced) {
      assert.equal(recovered.agentRuns[0].error, "A newer stop proof owns this run");
      assert.equal(f.run.state, "active");
      assert.deepEqual(f.publications, []);
      assert.equal(f.run.events.some(event => event.kind === "codex-observation-stop-recovered"), false);
    } else {
      assert.equal(f.run.state, "interrupted");
      assert.equal(f.run.providerStatus, "observation_lost");
      assert.equal(f.run.providerThreadId, f.threadId);
      assert.equal(f.run.providerGoalThreadId, f.threadId);
      assert.equal(f.run.providerGoalStatus, "paused");
      assert.equal(f.run.error, "");
      assert.equal(f.run.events.at(-1).kind, "codex-observation-stop-recovered");
      assert.equal(f.publications.at(-1).reason, "codex-observation-stop-recovered");
      assert.deepEqual(f.publications.at(-1).payload.conversationStream.messages, []);
    }
  }
});

async function messageSelectionContext(f, overrides = {}) {
  return { runtime: f.runtime, session: await f.runtime.getSession(f.sessionId),
    threadId: () => f.threadId, acquireProvider: async () => ({ provider: f.provider, reused: true }), ...overrides };
}

test("original message selection preserves idle, goal-gap and finalizing decisions after native reconciliation", async () => {
  for (const state of ["idle", "goal-gap", "finalizing", "no-turn-id", "active"]) {
    const f = await receiptFixture();
    if (state === "idle" || state === "goal-gap") f.run = { ...f.run, state: "completed", providerStatus: "completed", providerTurnId: "" };
    if (state === "goal-gap") f.run = { ...f.run, providerGoalStatus: "active", providerGoalThreadId: f.threadId };
    if (state === "finalizing") f.run = { ...f.run, state: "finalizing", providerStatus: "completed" };
    if (state === "no-turn-id") f.run = { ...f.run, providerTurnId: "" };
    f.provider.readThreadStatus = async () => ({ status: "unknown" });
    const selected = await f.owner.selectMessageTurn(f.sessionId, { messageId: "request" }, await messageSelectionContext(f));
    if (state === "idle") {
      assert.equal(selected.value.newTurnRequired, true);
      assert.equal(selected.value.reason, "provider_idle");
    } else if (state === "active") {
      assert.equal(Object.hasOwn(selected, "value"), false);
      assert.equal(selected.provider, f.provider);
      assert.equal(selected.threadId, f.threadId);
      assert.equal(selected.turnId, f.turnId);
    } else {
      assert.equal(selected.value.operationOutcome, "active_turn_not_ready");
      assert.equal(selected.value.retryable, true);
      assert.equal(selected.value.ok, false);
    }
    assert.equal(selected.session.sessionId, f.sessionId);
  }
});

test("original message selection matches only the exact missing idle thread and preserves unrelated errors", async () => {
  for (const mode of ["missing", "other-thread", "unrelated", "active"]) {
    const f = await receiptFixture();
    if (mode !== "active") f.run = { ...f.run, state: "completed", providerStatus: "completed" };
    const failure = Object.assign(new Error(mode === "unrelated" ? "invalid thread/read configuration"
      : `thread not loaded: ${mode === "other-thread" ? "different-thread" : f.threadId}`), { code: -32600, method: "thread/read" });
    f.provider.readThreadStatus = async () => { throw failure; };
    const selecting = f.owner.selectMessageTurn(f.sessionId, {}, await messageSelectionContext(f));
    if (mode === "missing") {
      const selected = await selecting;
      assert.equal(selected.value.newTurnRequired, true);
      assert.equal(selected.value.reason, "provider_thread_missing");
      assert.equal(selected.value.threadId, f.threadId);
    } else await assert.rejects(selecting, error => error === failure);
    assert.equal(f.run.providerThreadId, f.threadId);
    assert.deepEqual(f.operations, []);
  }
});

test("original message selection rereads abandoned ownership before retained identity and blocks unconfirmed observation loss", async () => {
  let f;
  f = await receiptFixture({ async recoverAdmission(runtime, session, options) {
    assert.equal(runtime, f.runtime);
    assert.equal(session.agentRuns[0].state, "starting");
    assert.deepEqual(options, { promptDeliveryActive: false });
    f.run = { ...f.run, state: "failed", providerStatus: "delivery_failed" };
    return { recovered: true, session: { ...await runtime.getSession(f.sessionId), identityRevision: "fresh" } };
  } });
  f.run = { ...f.run, state: "starting", providerTurnId: "", providerThreadId: "" };
  let acquired = 0;
  const selected = await f.owner.selectMessageTurn(f.sessionId, {}, await messageSelectionContext(f, {
    threadId(session) { assert.equal(session.identityRevision, "fresh"); return ""; },
    async acquireProvider() { acquired += 1; assert.fail("Missing identity must not acquire a provider"); }
  }));
  assert.equal(selected.value.reason, "thread_missing");
  assert.equal(acquired, 0);
  const lost = await receiptFixture({ errorPrefix: "authorized_" });
  lost.run = { ...lost.run, providerStatus: "observation_lost" };
  await assert.rejects(lost.owner.selectMessageTurn(lost.sessionId, {}, await messageSelectionContext(lost, {
    threadId: () => assert.fail("Unconfirmed loss must stop before fallback identity"),
    acquireProvider: async () => assert.fail("Unconfirmed loss must not reconnect")
  })), { code: "authorized_codex_observation_lost" });
  assert.equal(lost.run.state, "active");
});

test("original command dispatch passes trusted attachment-only input without changing its empty-input default", async t => {
  for (const mode of ["start", "steer"]) await t.test(mode, async () => {
    const f = await receiptFixture();
    t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
    if (mode === "start") {
      f.run = { ...f.run, state: "completed", providerStatus: "completed", providerThreadId: "", providerTurnId: "" };
    }
    const messageId = `attachment-only-${mode}`;
    const attachments = [{ attachmentId: "picture", fileName: "picture.png", size: 10 }];
    const preparedInput = [{ type: "image", url: "data:image/png;base64,YXV0aG9yaXplZA==" }];
    const input = { messageId, message: "", displayMessage: "", displayAttachments: attachments };
    const empty = await f.owner.dispatchMessage(f.sessionId, input, {}, {
      readContext: () => assert.fail("The original empty-input default must reject before preparation")
    });
    assert.equal(empty.value.ok, false);
    assert.equal(empty.value.operationOutcome, "message_empty");
    const identities = [];
    const writeUser = f.store.writeConversationUserMessage;
    f.store.writeConversationUserMessage = (sessionId, value) => {
      identities.push(value.nativeIdentity);
      return writeUser(sessionId, value);
    };
    const prepare = {
      async readContext() {
        const session = await f.runtime.getSession(f.sessionId);
        return { runtime: f.runtime, session, selection: {
          runtime: f.runtime, session, threadId: () => mode === "start" ? "" : f.threadId,
          acquireProvider: async () => ({ provider: f.provider, reused: true })
        } };
      },
      threadPreparation(value, prepared) {
        prepared.activeThreadId = f.threadId;
        return { provider: async () => commandThreadFixture(f) };
      },
      async prepareMessage(value, prepared, { starting }) {
        return starting ? { renderedPrompt: "", turnSettings: {} } : null;
      },
      async finishMessage(value, prepared, outcome) {
        if (Object.hasOwn(outcome, "error")) throw outcome.error;
      }
    };
    const nativeInput = (threadId, content, options) => {
      assert.equal(threadId, f.threadId);
      assert.equal(content, preparedInput);
      assert.equal(options.clientUserMessageId, messageId);
    };
    f.provider.sendTurn = async (threadId, content, options) => {
      nativeInput(threadId, content, options);
      return { id: f.turnId, status: "inProgress" };
    };
    f.provider.steerTurn = async (threadId, turnId, content, options) => {
      assert.equal(turnId, f.turnId);
      nativeInput(threadId, content, options);
      return { ok: true };
    };
    const result = await f.owner.withMessageDelivery(f.sessionId, messageId, { text: "", attachments }, () =>
      f.owner.dispatchMessage(f.sessionId, input, { preparedInput }, prepare));
    assert.equal(result.value.delivered, true);
    assert.equal(result.value.turnId, f.turnId);
    if (mode === "start") assert.deepEqual(result.nativeIdentity, { threadId: f.threadId, turnId: f.turnId });
    const rows = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === messageId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user.text, "");
    assert.deepEqual(rows[0].user.attachments, attachments);
    assert.deepEqual(identities, [{ threadId: f.threadId, turnId: f.turnId }]);
    assert.equal(JSON.stringify(rows).includes("data:image"), false);
    assert.equal(f.owner.pendingUserMessages.size, 0);
    assert.equal(f.owner.promptDeliveries.size, 0);
  });
});

test("original authorized input supports an attachment-only receipt through the same native send and writer", async t => {
  const f = await receiptFixture();
  t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
  const context = dispatchContext(f, "image-only");
  context.renderedPrompt = "";
  context.preparedInput = [{ type: "image", url: "data:image/png;base64,YXV0aG9yaXplZA==" }];
  const attachments = [{ attachmentId: "picture", fileName: "picture.png", size: 10 }];
  const identities = [];
  const writeUser = f.store.writeConversationUserMessage;
  f.store.writeConversationUserMessage = (sessionId, input) => {
    identities.push(input.nativeIdentity);
    return writeUser(sessionId, input);
  };
  const receipt = Promise.withResolvers();
  const acknowledgement = Promise.withResolvers();
  f.run = { ...f.run, state: "starting", providerTurnId: "" };
  f.owner.pendingUserMessages.set(`${context.promptDeliveryKey}\0${context.messageId}`, {
    text: "", attachments, turnMetadata: context.turnMetadata, receipt
  });
  f.provider.sendTurn = async (threadId, input, params) => {
    assert.equal(threadId, f.threadId);
    assert.equal(input, context.preparedInput);
    assert.equal(params.clientUserMessageId, context.messageId);
    f.emit({ method: "item/completed", params: { threadId, turnId: f.turnId,
      item: { type: "userMessage", id: "native-image-receipt", clientId: context.messageId,
        content: [{ type: "image", url: "not-an-authority" }] } } });
    return acknowledgement.promise;
  };
  f.observe();
  const started = await f.owner.startTurn(f.sessionId, { displayAttachments: attachments }, context);
  await f.drain();
  assert.equal(started.deliveredTurnId, f.turnId);
  const rows = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === context.messageId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user.text, "");
  assert.deepEqual(rows[0].user.attachments, attachments);
  assert.equal(rows[0].metadata.actorId, "original-author");
  assert.deepEqual(identities, [{ threadId: f.threadId, turnId: f.turnId }]);
  assert.deepEqual(f.run.pendingUserMessageClientIds, []);
  assert.equal(JSON.stringify(rows).includes("not-an-authority"), false);
  assert.equal(JSON.stringify(rows).includes("data:image"), false);
  acknowledgement.resolve({ id: f.turnId });
  assert.equal(f.observationFailures.length, 0);
});

test("original authorized input ignores empty unowned native receipts and uses prepared steering input unchanged", async () => {
  const f = await receiptFixture();
  const before = structuredClone(f.run);
  const empty = { method: "item/completed", params: { threadId: f.threadId, turnId: f.turnId,
    item: { type: "userMessage", id: "empty", clientId: "unknown", content: [{ type: "image", url: "untrusted" }] } } };
  await f.owner.mirrorTerminalUserMessage(f.sessionId, f.threadId, empty);
  assert.deepEqual(f.run, before);
  assert.equal((await f.store.readConversationLog(f.sessionId)).some(row => row.user?.messageId === "unknown"), false);
  assert.equal(await f.store.writeConversationUserMessage(f.sessionId, { text: "", messageId: "empty", attachments: [] }), null);
  assert.equal(await f.store.writeConversationAssistantMessage(f.sessionId, { text: "", attachments: [{ attachmentId: "ignored" }] }), null);
  const context = dispatchContext(f, "prepared-steer");
  context.preparedInput = [{ type: "image", url: "data:image/png;base64,YQ==" }];
  context.message = "";
  context.displayMessage = "";
  f.provider.steerTurn = async (threadId, turnId, input) => {
    assert.equal(threadId, f.threadId);
    assert.equal(turnId, f.turnId);
    assert.equal(input, context.preparedInput);
    return { ok: true };
  };
  const response = await f.owner.steerTurn(f.sessionId, {
    displayAttachments: [{ attachmentId: "picture", fileName: "picture.png", size: 1 }]
  }, context);
  assert.equal(response.value.ok, true);
  assert.equal(response.value.conversationTurn.user.messageId, context.messageId);
  assert.equal(response.value.conversationTurn.user.text, "");
  assert.equal(response.value.conversationTurn.user.attachments.length, 1);
});

test("original native publication carries exact goal metadata without changing notification order", async t => {
  const f = await receiptFixture();
  t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
  const observed = [];
  f.onPublish = async (_sessionId, event) => {
    if (event.reason === "codex-goal") observed.push({ value: event.nativeGoal, priorStatus: f.run.providerGoalStatus });
  };
  const goal = { threadId: f.threadId, status: "active", objective: "Keep the original goal", createdAt: 10, tokensUsed: 20 };
  f.observe();
  f.emit({ method: "thread/goal/updated", params: { threadId: f.threadId, goal } });
  await f.drain();
  f.emit({ method: "thread/goal/cleared", params: { threadId: f.threadId } });
  await f.drain();
  assert.equal(observed[0].value.goal, goal);
  assert.deepEqual(observed[0].value, { threadId: f.threadId, goal });
  assert.equal(observed[0].priorStatus, undefined, "Updated notification publishes before reconciling");
  assert.deepEqual(observed[1].value, { threadId: f.threadId, goal: null });
  assert.equal(observed[1].priorStatus, "", "Cleared notification reconciles before publishing");
  assert.equal(f.publications.filter(event => event.reason === "codex-goal").some(event => Object.hasOwn(event.payload || {}, "goal")), false);
  assert.equal(f.observationFailures.length, 0);
});

test("original native publication carries the output record identity through correction after a newer run", async () => {
  const f = await receiptFixture();
  const identities = [];
  const write = f.store.writeConversationAssistantMessage;
  const upsert = f.store.upsertConversationAssistantMessage;
  f.store.writeConversationAssistantMessage = async (sessionId, input) => {
    identities.push(["append", input.nativeIdentity]);
    f.run = { ...f.run, providerTurnId: "newer-native-turn" };
    return write(sessionId, input);
  };
  f.store.upsertConversationAssistantMessage = async (sessionId, input) => {
    identities.push(["correct", input.nativeIdentity]);
    return upsert(sessionId, input);
  };
  const record = { threadId: f.threadId, turnId: f.turnId, itemId: "record-identity", text: "The original reply." };
  await f.owner.persistAssistantReply(f.runtime, f.sessionId, record);
  await f.owner.persistAssistantReply(f.runtime, f.sessionId, { ...record, conversationTurn: null, text: "The corrected reply." });
  assert.deepEqual(identities, [
    ["append", { threadId: f.threadId, turnId: f.turnId }],
    ["append", { threadId: f.threadId, turnId: f.turnId }],
    ["correct", { threadId: f.threadId, turnId: f.turnId }]
  ]);
  assert.equal(f.run.providerTurnId, "newer-native-turn");
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["The corrected reply."]);
  assert.equal(JSON.stringify(await f.replies()).includes("nativeIdentity"), false);
});

test("original live observation prepares only owned threads and saves every active main or goal barrier", async () => {
  for (const mode of ["active", "goal", "idle", "helper"]) {
    const projectContext = { project: mode };
    const contexts = [];
    const f = await receiptFixture({ runInContext(context, operation) {
      contexts.push(context);
      return operation();
    } });
    if (mode !== "active") f.run = { ...f.run, state: "completed", providerStatus: "completed" };
    if (mode === "goal") Object.assign(f.run, { providerGoalStatus: "active", providerGoalThreadId: f.threadId });
    const error = new Error("Observation failed");
    const entries = [
      { provider: f.provider, conversationId: "helper-running", runId: "helper-turn", status: "inProgress", error: "" },
      { provider: f.provider, conversationId: "helper-goal", runId: "goal-turn", status: "idle", goal: { status: "active" }, error: "" },
      { provider: f.provider, conversationId: "helper-idle", runId: "idle-turn", status: "idle", error: "" },
      { provider: {}, conversationId: "other-owner", runId: "other-turn", status: "inProgress", error: "" }
    ];
    let reads = 0;
    const getSession = f.runtime.getSession;
    f.runtime.getSession = (...args) => { reads += 1; return getSession(...args); };
    f.owner.conversations.set(`project:${f.sessionId}`, new Map(entries.map(entry => [entry.conversationId, entry])));
    const observation = f.owner.createObservation(f.sessionId, {
      projectContext,
      target(value) {
        assert.equal(value, error);
        return { threadId: mode === "helper" ? "" : f.threadId, pendingMessage: "Stop pending", message: "Stopped" };
      },
      retireProvider() { throw new Error("Preparation must not release a provider"); }
    });
    const threads = await observation.prepare({ provider: f.provider, error });
    assert.deepEqual([...threads], [
      ["helper-running", "helper-turn"], ["helper-goal", "goal-turn"], ["helper-idle", "idle-turn"],
      ...(mode === "helper" ? [] : [[f.threadId, f.turnId]])
    ]);
    assert.deepEqual(entries.map(entry => entry.error), ["Stop pending", "Stop pending", "", ""]);
    await observation.barrier({ provider: f.provider, error });
    const active = mode === "active" || mode === "goal";
    assert.deepEqual(f.run.events.map(event => event.kind), active ? ["observation-lost", "observation-lost"] : []);
    assert.equal(f.publications.length, active ? 1 : 0);
    if (active) {
      assert.equal(f.publications[0].reason, "codex-observation-lost");
      assert.equal(f.run.providerStatus, "observation_lost");
      assert.equal(f.run.error, "Stop pending");
    }
    assert.equal(reads, mode === "helper" ? 0 : 2);
    assert.deepEqual(contexts, [projectContext, projectContext]);
  }
});

test("original live observation retains its provider until stopped persistence and clears streams before retirement and publication", async () => {
  for (const sharedStop of [false, true]) {
    const f = await receiptFixture();
    const error = new Error("Observation failed");
    const saveError = new Error("Stop state could not be saved");
    f.provider.observationFailure = error;
    f.store.updateConversationStream(f.sessionId, { turnId: f.turnId, messageId: "live-answer", role: "assistant", text: "Draft" });
    const failures = [];
    const entries = [{ provider: f.provider, conversationId: "helper", runId: "helper-turn", status: "inProgress",
      watcher: { failNow(value) { failures.push(value); f.operations.push("helper-failed"); } } }];
    let retired = 0;
    f.owner.conversations.set(`project:${f.sessionId}`, new Map(entries.map(entry => [entry.conversationId, entry])));
    const observation = f.owner.createObservation(f.sessionId, {
      target: () => ({ threadId: f.threadId, pendingMessage: "Stop pending", message: "Stopped" }),
      async retireProvider(provider) {
        assert.equal(provider, f.provider);
        assert.equal(f.run.state, CODEX_APP_SERVER_RUN_STATE.INTERRUPTED);
        assert.equal(f.store.readConversationStream(f.sessionId).messages.length, 0);
        retired += 1;
        f.operations.push("retired");
      }
    });
    await observation.prepare({ provider: f.provider, error });
    const write = f.store.writeAgentRunEvent;
    f.store.writeAgentRunEvent = (...args) => {
      if (args[2].event.kind === "codex-observation-stopped") throw saveError;
      return write(...args);
    };
    await assert.rejects(observation.complete({ provider: f.provider, error, sharedStop }), value => value === saveError);
    assert.equal(f.run.state, CODEX_APP_SERVER_RUN_STATE.ACTIVE);
    assert.equal(f.provider.observationFailure, error);
    assert.equal(retired, 0);
    assert.equal(entries[0].status, "inProgress");
    assert.equal(f.store.readConversationStream(f.sessionId).messages.length, 1);
    assert.deepEqual(failures, []);
    assert.equal(f.publications.some(event => event.reason === "codex-observation-stopped"), false);
    f.store.writeAgentRunEvent = write;
    f.operations = [];
    f.onPublish = (_id, event) => {
      if (event.reason !== "codex-observation-stopped") return;
      assert.equal(retired, sharedStop ? 1 : 0);
      if (!sharedStop) assert.equal(f.provider.observationFailure, null);
      assert.equal(entries[0].status, "interrupted");
      assert.deepEqual(event.payload.conversationStream.messages, []);
    };
    await observation.complete({ provider: f.provider, error, sharedStop });
    assert.equal(f.run.state, CODEX_APP_SERVER_RUN_STATE.INTERRUPTED);
    assert.equal(f.run.providerStatus, "observation_lost");
    assert.equal(f.run.error, sharedStop ? "Stopped Its shared service was stopped, affecting other sessions using it." : "Stopped");
    assert.deepEqual(failures, [error]);
    assert.deepEqual(f.operations, ["event:codex-observation-stopped", ...(sharedStop ? ["retired"] : []),
      "helper-failed", "codex-observation-stopped"]);
  }
});

test("original live observation completion preserves a changed main run and reads the current helper registry", async () => {
  for (const changed of ["thread", "status"]) {
    const f = await receiptFixture();
    const error = new Error("Observation failed");
    const previous = { provider: f.provider, conversationId: "old-helper", runId: "old-turn", status: "inProgress" };
    let entries = [previous];
    f.owner.conversations.set(`project:${f.sessionId}`, new Map(entries.map(entry => [entry.conversationId, entry])));
    const observation = f.owner.createObservation(f.sessionId, {
      target: () => ({ threadId: f.threadId, pendingMessage: "Stop pending", message: "Stopped" }),
      retireProvider() { throw new Error("Independent stop must retain its shared provider"); }
    });
    await observation.prepare({ provider: f.provider, error });
    if (changed === "thread") f.run.providerThreadId = "new-thread";
    else f.run.providerStatus = "completed";
    const saved = structuredClone(f.run);
    const failures = [];
    const current = { provider: f.provider, conversationId: "current-helper", runId: "current-turn", status: "starting",
      watcher: { failNow(value) { failures.push(value); } } };
    entries = [current];
    f.owner.conversations.set(`project:${f.sessionId}`, new Map(entries.map(entry => [entry.conversationId, entry])));
    await observation.complete({ provider: f.provider, error, sharedStop: false });
    assert.deepEqual(f.run, saved);
    assert.equal(previous.status, "inProgress");
    assert.equal(current.status, "interrupted");
    assert.deepEqual(failures, [error]);
    assert.equal(f.provider.observationFailure, null);
    assert.equal(f.publications.some(event => event.reason === "codex-observation-stopped"), false);
  }
});

for (const [status, cause, explicit, expected] of [
  ["interrupted", "", "", "interrupted"],
  ["interrupted", "control_reconfiguration", "", "control_reconfiguration"],
  ["interrupted", "user_cancelled", "", "user_cancelled"],
  ["failed", "control_reconfiguration", "", "provider_failure"],
  ["interrupted", "control_reconfiguration", "service_restart", "service_restart"]
]) {
  test(`native ${status} preserves ${expected} outcome without inferring its cause`, async () => {
    const notices = [];
    const checkpoints = [];
    const f = await receiptFixture({
      outcomeNotice(_runtime, sessionId, threadId, turnId, outcome) { notices.push({ sessionId, threadId, turnId, outcome }); },
      checkpoint(sessionId, value) { checkpoints.push({ sessionId, ...value }); }
    });
    const provider = new CodexAppServerAgentProvider({}, { credentials: { assertCurrent() {} } });
    provider.client = { isOpen: () => true, close() {}, async request(method, input) {
      assert.equal(method, "turn/interrupt");
      assert.deepEqual(input, { threadId: f.threadId, turnId: f.turnId });
      assert.equal(provider.interruptionOutcome(f.threadId, f.turnId), cause, "Cause precedes the actual native request");
      return {};
    } };
    try {
      if (cause) await provider.interruptTurn(f.threadId, f.turnId, { outcome: cause });
      f.provider.interruptionOutcome = provider.interruptionOutcome.bind(provider);
      assert.equal(provider.interruptionOutcome("another-thread", f.turnId), "");
      assert.equal(provider.interruptionOutcome(f.threadId, "another-turn"), "");
      const result = await f.owner.stopTurnWithProviderFailure(f.sessionId, f.threadId, f.turnId, {
        status, provider: f.provider, verifyInactive: false, ...(explicit ? { outcome: explicit } : {})
      });
      assert.equal(result.status, status);
      if (expected === "control_reconfiguration") assert.match(result.error, /while its controls were restored/u);
      if (status === "interrupted") assert.doesNotMatch(result.error, /provider failed|app-server failed/u);
      assert.deepEqual(notices, [{ sessionId: f.sessionId, threadId: f.threadId, turnId: f.turnId, outcome: expected }]);
      assert.deepEqual(checkpoints, [{ sessionId: f.sessionId, status, turnOutcome: expected, threadId: f.threadId, turnId: f.turnId }]);
      assert.equal(f.run.providerStatus, status);
      assert.equal(f.run.providerThreadId, f.threadId);
      assert.equal(f.run.providerTurnId, f.turnId);
    } finally {
      provider.close();
      assert.equal(provider.interruptionOutcome(f.threadId, f.turnId), "");
      f.owner.clearSessionRecoveryTimers(f.sessionId);
    }
  });
}

test("user Stop records its exact cause before queued native completion while the interrupt reply is held", async () => {
  const notices = [];
  const f = await receiptFixture({ outcomeNotice(_runtime, sessionId, threadId, turnId, outcome) {
    notices.push({ sessionId, threadId, turnId, outcome });
  } });
  const issued = Promise.withResolvers();
  const release = Promise.withResolvers();
  const provider = new CodexAppServerAgentProvider({}, { credentials: { assertCurrent() {} } });
  provider.client = { isOpen: () => true, close() {}, async request(method, input) {
    assert.equal(method, "turn/interrupt");
    assert.deepEqual(input, { threadId: f.threadId, turnId: f.turnId });
    assert.equal(provider.interruptionOutcome(f.threadId, f.turnId), "user_cancelled");
    f.run.providerStatus = "interrupted";
    f.emit({ method: "turn/completed", params: { threadId: f.threadId, turn: { id: f.turnId, status: "interrupted" } } });
    issued.resolve();
    await release.promise;
    return {};
  } };
  f.provider.interruptTurn = provider.interruptTurn.bind(provider);
  f.provider.interruptionOutcome = provider.interruptionOutcome.bind(provider);
  f.observe();
  const stopped = f.owner.interruptTurn(f.sessionId, {}, controlContext(f));
  stopped.catch(() => {});
  try {
    await issued.promise;
    await f.drain();
    assert.deepEqual(notices, [{ sessionId: f.sessionId, threadId: f.threadId, turnId: f.turnId, outcome: "user_cancelled" }],
      "The queued completion cannot write a provider-failure or unknown-interruption notice first");
    assert.equal(f.run.state, "interrupted");
    assert.equal(f.run.providerThreadId, f.threadId);
    assert.equal(f.run.providerTurnId, f.turnId);
  } finally {
    release.resolve();
    await stopped;
    provider.close();
    f.owner.clearSessionRecoveryTimers(f.sessionId);
  }
  assert.equal(notices.length, 1);
});

test("native finalizing grace rejects invalid owner configuration", () => {
  for (const finalizingGraceMs of [0, -1, 0.5, NaN, Infinity, "500"]) {
    assert.throws(() => createCodexAppServerRunOwner({ finalizingGraceMs }), /Invalid Codex finalizing grace/);
  }
});

for (const policy of ["short-late-final", "short-expired", "default-late-final"]) {
  test(`native finalizing grace preserves exact recovery for ${policy}`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T00:00:00Z") });
    const f = await settlementFixture();
    const { sessionId, threadId, turnId } = f;
    const owner = createCodexAppServerRunOwner({
      ...(policy === "default-late-final" ? {} : { finalizingGraceMs: 500 }),
      createRuntime: async () => ({ store: f.store, getSession: async () => ({ sessionId, agentRuns: [structuredClone(f.run)] }) }),
      createStore: async () => f.store,
      acquireProvider: async () => f.provider,
      checkpoint: async (id, input) => { f.checkpoints.push({ sessionId: id, ...input }); }
    });
    t.after(() => owner.clearSessionRecoveryTimers(sessionId));
    f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: new Date().toISOString() };
    f.history = [turn(turnId, "completed")];
    t.mock.timers.tick(499);
    assert.equal((await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false })).processed, false);
    assert.equal(f.run.state, "finalizing");
    assert.equal(owner.finalizingTimers.size, 1);
    assert.deepEqual(await f.replies(), []);
    if (policy === "short-late-final") {
      f.history = [turn(turnId, "completed", "Exact late reply.")];
      assert.equal((await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false })).processed, true);
    } else {
      t.mock.timers.tick(1);
      await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
      if (policy === "short-expired") {
        assert.deepEqual(f.checkpoints, [{ sessionId, threadId, turnId,
          status: "completed", turnOutcome: "response_delivery_failure" }]);
        assert.equal(f.run.state, "completed");
        assert.deepEqual(await f.replies(), []);
        f.history = [turn(turnId, "completed", "Too late to revive this waiter.")];
        assert.equal((await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false })).processed, false);
        assert.deepEqual(await f.replies(), []);
      } else {
        assert.equal(f.run.state, "finalizing");
        assert.equal(owner.finalizingTimers.size, 1);
        t.mock.timers.tick(501);
        f.history = [turn(turnId, "completed", "Exact late reply.")];
        assert.equal((await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false })).processed, true);
      }
    }
    assert.equal(f.run.providerThreadId, threadId);
    assert.equal(f.run.providerTurnId, turnId);
    assert.equal(owner.finalizingTimers.size, 0);
    assert.deepEqual((await f.replies()).map(row => row.assistant.text),
      policy === "short-expired" ? [] : ["Exact late reply."]);
  });
}


test("native after-history grace rejects nonboolean owner policy", () => {
  for (const finalizingGraceAfterHistoryRead of [0, 1, "true", null]) {
    assert.throws(() => createCodexAppServerRunOwner({ finalizingGraceAfterHistoryRead }), /Invalid Codex finalizing grace clock/);
  }
});

for (const policy of ["late-final", "expiry", "read-error", "default-expiry"]) {
  test(`native after-history grace starts after the first held read for ${policy}`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T00:00:00Z") });
    const f = await settlementFixture();
    const { sessionId, threadId, turnId } = f;
    const owner = createCodexAppServerRunOwner({
      ...(policy === "default-expiry" ? {} : { finalizingGraceMs: 500, finalizingGraceAfterHistoryRead: true }),
      createRuntime: async () => ({ store: f.store, getSession: async () => ({ sessionId, agentRuns: [structuredClone(f.run)] }) }),
      createStore: async () => f.store,
      acquireProvider: async () => f.provider,
      checkpoint: async (id, input) => { f.checkpoints.push({ sessionId: id, ...input }); }
    });
    t.after(() => owner.clearSessionRecoveryTimers(sessionId));
    const completedAt = new Date().toISOString();
    f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: completedAt };
    f.history = [turn(turnId, "completed")];
    const reading = Promise.withResolvers();
    const release = Promise.withResolvers();
    const list = f.provider.listThreadTurns;
    let first = true;
    f.provider.listThreadTurns = async (...args) => {
      const snapshot = await list(...args);
      if (first) {
        first = false; reading.resolve(); await release.promise;
        if (policy === "read-error") throw new Error("Controlled first history read failure");
      }
      return snapshot;
    };
    const pending = owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
    await reading.promise;
    t.mock.timers.tick(20_000);
    release.resolve();
    await pending;
    if (policy === "default-expiry") {
      assert.equal(f.run.state, "completed", "Main/default retains the completion-based clock");
      assert.equal(f.checkpoints.length, 1);
      assert.equal(f.checkpoints[0].turnOutcome, "response_delivery_failure");
      assert.equal(owner.finalizingTimers.size, 0);
      return;
    }
    assert.equal(f.run.state, "finalizing", "The held read must not consume Colleague's late-final grace");
    assert.equal(f.run.finishedAt, completedAt, "Do not rewrite native completion to start a local timer");
    assert.equal(owner.finalizingTimers.size, 1);
    assert.deepEqual(f.checkpoints, []);
    t.mock.timers.tick(499);
    await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
    assert.equal(f.run.state, "finalizing", "A repeated read must retain the first deadline");
    assert.deepEqual(f.checkpoints, []);
    if (policy === "late-final" || policy === "read-error") {
      f.history = [turn(turnId, "completed", "Late after the held history read.")];
      assert.equal((await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false })).processed, true);
      assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["Late after the held history read."]);
    } else {
      t.mock.timers.tick(1);
      await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
      assert.equal(f.run.state, "completed");
      assert.equal(f.checkpoints.length, 1);
      assert.equal(f.checkpoints[0].turnOutcome, "response_delivery_failure");
      f.history = [turn(turnId, "completed", "Too late to revive the old waiter.")];
      assert.equal((await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false })).processed, false);
      assert.deepEqual(await f.replies(), []);
    }
    assert.equal(owner.finalizingTimers.size, 0);
    assert.equal(f.checkpoints.length, 1);
    assert.equal(f.run.providerThreadId, threadId);
    assert.equal(f.run.providerTurnId, turnId);
  });
}

for (const change of ["stop", "successor", "goal"]) {
  test(`native after-history grace does not arm after ${change} during the first read`, async t => {
    const f = await settlementFixture();
    const { sessionId, threadId, turnId } = f;
    const owner = createCodexAppServerRunOwner({ finalizingGraceMs: 500, finalizingGraceAfterHistoryRead: true,
      createRuntime: async () => ({ store: f.store, getSession: async () => ({ sessionId, agentRuns: [structuredClone(f.run)] }) }),
      createStore: async () => f.store, acquireProvider: async () => f.provider,
      checkpoint: async (id, input) => { f.checkpoints.push({ sessionId: id, ...input }); }
    });
    t.after(() => owner.clearSessionRecoveryTimers(sessionId));
    f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: new Date().toISOString() };
    f.history = [turn(turnId, "completed")];
    const reading = Promise.withResolvers(); const release = Promise.withResolvers();
    const list = f.provider.listThreadTurns;
    f.provider.listThreadTurns = async (...args) => { const snapshot = await list(...args); reading.resolve(); await release.promise; return snapshot; };
    const pending = owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
    await reading.promise;
    if (change === "stop") f.run = { ...f.run, state: "interrupted", providerStatus: "interrupted" };
    if (change === "successor") f.run = { ...f.run, state: "active", providerStatus: "inProgress", providerTurnId: "successor" };
    if (change === "goal") f.run = { ...f.run, providerGoalStatus: "active", providerGoalThreadId: threadId };
    const protectedRun = structuredClone(f.run);
    release.resolve(); await pending;
    assert.equal(owner.finalizingTimers.size, 0, "The old read cannot arm recovery for obsolete or goal-owned work");
    assert.deepEqual(f.run, protectedRun);
    assert.deepEqual(f.checkpoints, []);
    assert.deepEqual(await f.replies(), []);
  });
}


for (const change of ["concurrent", "cleanup", "successor"]) {
  test(`native after-history grace keeps the fired expiry while its read is held for ${change}`, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T00:00:00Z") });
    const f = await settlementFixture();
    const { sessionId, threadId, turnId } = f;
    const owner = createCodexAppServerRunOwner({ finalizingGraceMs: 20, finalizingGraceAfterHistoryRead: true,
      createRuntime: async () => ({ store: f.store, getSession: async () => ({ sessionId, agentRuns: [structuredClone(f.run)] }) }),
      createStore: async () => f.store, acquireProvider: async () => f.provider,
      checkpoint: async (id, input) => { f.checkpoints.push({ sessionId: id, ...input }); }
    });
    t.after(() => owner.clearSessionRecoveryTimers(sessionId));
    f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: new Date().toISOString() };
    f.history = [turn(turnId, "completed")];
    await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
    const reading = Promise.withResolvers(); const release = Promise.withResolvers();
    const list = f.provider.listThreadTurns;
    f.provider.listThreadTurns = async (...args) => { const snapshot = await list(...args); reading.resolve(); await release.promise; return snapshot; };
    t.mock.timers.tick(20);
    await reading.promise;
    assert.equal(owner.finalizingTimers.size, 1, "Firing does not discard the first post-read clock");
    const expiry = [...owner.finalizingTimers.values()][0].finalizingRecovery;
    assert.ok(expiry instanceof Promise);
    let pending;
    if (change === "concurrent") pending = owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
    if (change === "cleanup") owner.clearSessionRecoveryTimers(sessionId);
    if (change === "successor") f.run = { ...f.run, providerTurnId: "successor", state: "active", providerStatus: "inProgress" };
    t.mock.timers.tick(1000);
    release.resolve();
    await expiry;
    await pending;
    assert.equal(owner.finalizingTimers.size, 0, "A held expiry read cannot grant another interval or leave a predecessor timer");
    assert.deepEqual(await f.replies(), []);
    assert.equal(f.checkpoints.length, change === "concurrent" ? 1 : 0);
    if (change === "successor") assert.equal(f.run.providerTurnId, "successor");
  });
}


test("native after-history grace retries a rejected expiry read without granting another interval", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-07T00:00:00Z") });
  const f = await settlementFixture();
  const { sessionId, threadId, turnId } = f;
  const failedRead = Promise.withResolvers();
  const release = Promise.withResolvers();
  let rejectNextRead = false;
  const errors = [];
  const owner = createCodexAppServerRunOwner({ finalizingGraceMs: 20, finalizingGraceAfterHistoryRead: true,
    createRuntime: async () => ({ store: f.store, getSession: async () => {
      if (rejectNextRead) {
        rejectNextRead = false;
        failedRead.resolve();
        await release.promise;
        throw new Error("Controlled transient session read failure");
      }
      return { sessionId, agentRuns: [structuredClone(f.run)] };
    } }),
    createStore: async () => f.store, acquireProvider: async () => f.provider,
    debugLog: (event, input) => { if (event === "appServerFinalizingRecovery.error") errors.push(input); },
    checkpoint: async (id, input) => { f.checkpoints.push({ sessionId: id, ...input }); }
  });
  t.after(() => owner.clearSessionRecoveryTimers(sessionId));
  f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: new Date().toISOString() };
  f.history = [turn(turnId, "completed")];
  await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
  rejectNextRead = true;
  t.mock.timers.tick(20);
  await failedRead.promise;
  const timer = [...owner.finalizingTimers.values()][0];
  const expiry = timer.finalizingRecovery;
  const rejected = assert.rejects(expiry, /Controlled transient session read failure/);
  release.resolve();
  await rejected;
  assert.equal(owner.finalizingTimers.size, 1, "A rejected attempt retains the original expired deadline");
  assert.deepEqual(f.checkpoints, []);
  assert.deepEqual(await f.replies(), []);
  t.mock.timers.tick(1000);
  await owner.completeTurn(sessionId, threadId, turnId, { verifyInactive: false });
  assert.equal(f.run.state, "completed", "A fresh read settles against the original expired clock");
  assert.equal(errors.length, 1, "The recovery error remains observable");
  assert.equal(f.checkpoints.length, 1);
  assert.equal(f.checkpoints[0].turnOutcome, "response_delivery_failure");
  assert.equal(owner.finalizingTimers.size, 0);
  assert.deepEqual(await f.replies(), []);
});

for (const status of ["failed", "interrupted"]) {
  test(`original detached ${status} notification retains the late exact provider detail`, async t => {
    const f = fixture([turn("turn-1", "inProgress")]);
    const pending = waitForCodexAppServerTurn(f.provider, "thread-1", turn("turn-1"), { timeoutMs: 2000 });
    const rejected = assert.rejects(pending, { message: "Exact later native failure detail." });
    // Finish the original initial history reread before terminal notification.
    await Promise.resolve();
    const emit = notification => { for (const listener of f.listeners) listener(notification); };
    emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status } } });
    assert.equal(f.listeners.size, 1, "The original 500ms detail wait retains observation");
    const detail = setTimeout(() => emit({ method: "error", params: {
      threadId: "thread-1", turnId: "turn-1", error: { message: "Exact later native failure detail." }, willRetry: false
    } }), 100);
    t.after(() => clearTimeout(detail));
    await rejected;
    assert.equal(f.listeners.size, 0);
    assert.equal(f.operations.filter(operation => operation === "unsubscribe").length, 1);
  });
}

test("native failure detail grace rejects invalid duration", () => {
  for (const failureDetailGraceMs of [-1, 0.5, NaN, Infinity, "500", null]) {
    assert.throws(() => createCodexAppServerRunOwner({ failureDetailGraceMs }), /Invalid Codex failure detail grace/);
  }
});

for (const change of ["detail", "expiry", "repeat", "cleanup", "successor", "foreign-error", "user-stop"]) {
  test(`native failure detail grace preserves the existing notification owner for ${change}`, { timeout: 2000 }, async t => {
    const settled = Promise.withResolvers();
    const notices = [];
    const f = await receiptFixture({ failureDetailGraceMs: 30,
      checkpoint: async (_id, input) => { f.checkpoints.push(input); settled.resolve(); },
      outcomeNotice: async (_runtime, _id, _threadId, _turnId, _outcome, error) => { notices.push(error); }
    });
    t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
    f.run.providerStatus = change === "user-stop" ? "interrupted" : "failed";
    f.history = [turn(f.turnId, f.run.providerStatus)];
    if (change === "user-stop") f.provider.interruptionOutcome = () => "user_cancelled";
    f.observe();
    const notification = { method: "turn/completed", params: { threadId: f.threadId,
      turn: { id: f.turnId, status: f.run.providerStatus }, error: { message: "Original failure status." } } };
    f.emit(notification);
    await f.drain();
    if (change === "user-stop") {
      assert.equal(f.owner.finalizingTimers.size, 0);
      assert.equal(f.run.state, "interrupted");
      assert.equal(f.checkpoints.length, 1, "Explicit user cancellation never waits for provider detail");
      return;
    }
    assert.equal(f.owner.finalizingTimers.size, 1);
    assert.equal(f.run.state, "active", "Waiting for detail does not fabricate native completion");
    assert.equal(notices.length, 0, "The failure task returns so the following error can be processed");
    const timer = [...f.owner.finalizingTimers.values()][0];
    if (change === "repeat") {
      f.emit(notification); await f.drain();
      assert.equal([...f.owner.finalizingTimers.values()][0], timer, "Repeated status preserves the first deadline");
    }
    if (change === "foreign-error") {
      await f.owner.recoverActiveTurn(f.sessionId, { provider: f.provider, retryOnError: false,
        providerError: { threadId: f.threadId, turnId: "another-turn", error: "Foreign detail." } });
      assert.equal(f.owner.finalizingTimers.size, 1);
      assert.deepEqual(notices, []);
    }
    if (change === "cleanup") f.owner.clearSessionRecoveryTimers(f.sessionId);
    if (change === "successor") f.run = { ...f.run, providerTurnId: "successor", providerStatus: "inProgress" };
    if (["cleanup", "successor"].includes(change)) {
      await new Promise(resolve => setTimeout(resolve, 60));
      await f.drain();
      assert.equal(f.owner.finalizingTimers.size, 0);
      assert.deepEqual(f.checkpoints, []);
      assert.deepEqual(notices, []);
      return;
    }
    if (["detail", "foreign-error"].includes(change)) {
      await f.owner.recoverActiveTurn(f.sessionId, { provider: f.provider, retryOnError: false,
        providerError: { threadId: f.threadId, turnId: f.turnId, error: "Exact provider detail." } });
    } else await settled.promise;
    await f.drain();
    assert.equal(f.owner.finalizingTimers.size, 0);
    assert.equal(f.run.state, "failed");
    assert.equal(f.checkpoints.length, 1);
    assert.deepEqual(notices, [["detail", "foreign-error"].includes(change) ? "Exact provider detail." : "Original failure status."]);
    assert.deepEqual(await f.replies(), []);
  });
}

for (const finalizingGraceAfterHistoryRead of [false, true]) for (const finalizingGraceMs of [500, 200]) for (const heldExpiry of [false, true]) {
  test(`native failure detail grace retains the first successful-final ${finalizingGraceMs}ms deadline with held expiry ${heldExpiry} and post-read clock ${finalizingGraceAfterHistoryRead}`, { timeout: 2000 }, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T00:00:00Z") });
    const notices = [];
    const settled = Promise.withResolvers();
    const f = await receiptFixture({ finalizingGraceMs, finalizingGraceAfterHistoryRead,
      failureDetailGraceMs: 500,
      checkpoint: async (_id, input) => { f.checkpoints.push(input); settled.resolve(); },
      outcomeNotice: async (_runtime, _id, _thread, _turn, _outcome, error) => notices.push(error)
    });
    t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
    f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: new Date().toISOString() };
    f.history = [turn(f.turnId, "completed")];
    await f.owner.completeTurn(f.sessionId, f.threadId, f.turnId, { verifyInactive: false });
    assert.equal(f.owner.finalizingTimers.size, 1);
    const reading = Promise.withResolvers();
    const release = Promise.withResolvers();
    const list = f.provider.listThreadTurns;
    let recovery;
    if (heldExpiry) {
      f.provider.listThreadTurns = async (...args) => { const snapshot = await list(...args); reading.resolve(); await release.promise; return snapshot; };
      recovery = f.owner.completeTurn(f.sessionId, f.threadId, f.turnId, { verifyInactive: false });
      await reading.promise;
      f.provider.listThreadTurns = list;
    }
    t.mock.timers.tick(finalizingGraceMs - 1);
    f.run.providerStatus = "failed";
    f.history = [turn(f.turnId, "failed")];
    f.observe();
    f.emit({ method: "turn/completed", params: { threadId: f.threadId,
      turn: { id: f.turnId, status: "failed" }, error: { message: "First failure detail." } } });
    await f.drain();
    if (heldExpiry) { release.resolve(); await recovery; }
    await new Promise(resolve => { const timer = setTimeout(resolve, 60); t.after(() => clearTimeout(timer)); });
    await f.drain();
    assert.equal(f.run.state, "failed", "Failed status must not grant another 500ms or revive successful-final recovery");
    await settled.promise;
    assert.equal(f.owner.finalizingTimers.size, 0);
    assert.deepEqual(notices, ["First failure detail."]);
    assert.equal(f.checkpoints.length, 1);
    assert.deepEqual(await f.replies(), []);
  });
}

for (const finalizingGraceMs of [500, 200]) {
  test(`native failure detail survives a held post-history state read with ${finalizingGraceMs}ms first deadline`, { timeout: 2000 }, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T00:00:00Z") });
    const notices = [];
    const f = await receiptFixture({ finalizingGraceMs, finalizingGraceAfterHistoryRead: true,
      failureDetailGraceMs: 500,
      outcomeNotice: async (_runtime, _id, _thread, _turn, _outcome, error) => notices.push(error)
    });
    t.after(() => f.owner.clearSessionRecoveryTimers(f.sessionId));
    f.run = { ...f.run, state: "finalizing", providerStatus: "completed", finishedAt: new Date().toISOString() };
    f.history = [turn(f.turnId, "completed")];
    await f.owner.completeTurn(f.sessionId, f.threadId, f.turnId, { verifyInactive: false });
    const reading = Promise.withResolvers(); const release = Promise.withResolvers();
    const list = f.provider.listThreadTurns; const getSession = f.runtime.getSession;
    let holdState = false;
    f.provider.listThreadTurns = async (...args) => { const snapshot = await list(...args); holdState = true; return snapshot; };
    f.runtime.getSession = async (...args) => {
      const snapshot = await getSession(...args);
      if (holdState) { holdState = false; reading.resolve(); await release.promise; }
      return snapshot;
    };
    const recovery = f.owner.completeTurn(f.sessionId, f.threadId, f.turnId, { verifyInactive: false });
    await reading.promise;
    f.provider.listThreadTurns = list;
    t.mock.timers.tick(finalizingGraceMs - 1);
    f.run.providerStatus = "failed"; f.history = [turn(f.turnId, "failed")];
    f.observe();
    f.emit({ method: "turn/completed", params: { threadId: f.threadId,
      turn: { id: f.turnId, status: "failed" }, error: { message: "Failure during canonical read." } } });
    await f.drain();
    release.resolve(); await recovery;
    await new Promise(resolve => { const timer = setTimeout(resolve, 60); t.after(() => clearTimeout(timer)); });
    await f.drain();
    assert.equal(f.run.state, "failed", "The resumed canonical read must not overwrite the pending failure operation");
    assert.equal(f.owner.finalizingTimers.size, 0);
    assert.deepEqual(notices, ["Failure during canonical read."]);
    assert.deepEqual(await f.replies(), []);
  });
}

for (const asynchronous of [false, true]) {
  test(`output acquisition validates host context before provider reuse (async ${asynchronous})`, async () => {
    const f = await outputFixture();
    const runtime = { store: f.store, getSession: async id => ({ sessionId: id, agentRuns: [structuredClone(f.run)] }) };
    const entered = Promise.withResolvers(); const release = Promise.withResolvers(); const order = [];
    const options = { threadExecutionRoot: "/trusted/private/native", threadWorkdir: "/trusted/private/native" };
    const prepared = { managedIdentity: { executionRoot: options.threadExecutionRoot, workdir: options.threadWorkdir },
      providerOptions: async () => { order.push("options"); return options; } };
    const owner = createCodexAppServerRunOwner({ createRuntime: async () => runtime, createStore: async () => f.store,
      providerSessions: { managed: new Map(), owner: { providers: new Map(), ensureSession: async context => {
        assert.deepEqual(context, { sessionId: f.sessionId, options }); order.push("provider"); return f.provider;
      } }, context: (sessionId, options) => ({ sessionId, options }), outputContext(context) {
        assert.equal(context.runtime, runtime); assert.equal(context.sessionId, f.sessionId); assert.equal(context.session.sessionId, f.sessionId);
        order.push("context"); entered.resolve();
        return asynchronous ? release.promise.then(() => { order.push("validated"); return prepared; }) : prepared;
      } }
    });
    const reading = owner.submitAssistantResult(f.sessionId, f.threadId, f.turnId, { recoverFromProvider: true });
    await entered.promise;
    if (asynchronous) {
      assert.deepEqual(order, ["context"]); assert.equal(f.pages.length, 0, "No native history read precedes trusted context validation"); release.resolve();
    }
    assert.equal((await reading).reason, "empty");
    assert.deepEqual(order, asynchronous ? ["context", "validated", "options", "provider"] : ["context", "options", "provider"]);
    assert.equal(f.pages.length, 1);
  });
}

test("a rejected async output context does not acquire a provider or read native history", async () => {
  const f = await outputFixture();
  const runtime = { store: f.store, getSession: async () => ({ sessionId: f.sessionId, agentRuns: [f.run] }) };
  let acquired = false;
  const owner = createCodexAppServerRunOwner({ createRuntime: async () => runtime, createStore: async () => f.store,
    providerSessions: { managed: new Map(), owner: { providers: new Map(), ensureSession() { acquired = true; throw new Error("Unexpected acquisition"); } },
      context: () => ({}), outputContext: async () => { throw new Error("The learning scope is no longer active"); } }
  });
  const result = await owner.submitAssistantResult(f.sessionId, f.threadId, f.turnId, { recoverFromProvider: true });
  assert.equal(result.reason, "error"); assert.match(result.error, /learning scope is no longer active/u);
  assert.equal(acquired, false); assert.equal(f.pages.length, 0);
});

test("native receipt keeps admitted application data with the original authored message", async () => {
  const f = await receiptFixture();
  const messageId = "application-data-live";
  const data = { association: { reference: "issued-reference", delivery: { turnId: "question-turn" } } };
  f.run = { ...f.run, state: "starting", providerTurnId: "", pendingUserMessageClientIds: [messageId] };
  const receipt = Promise.withResolvers();
  f.owner.pendingUserMessages.set(`project:${f.sessionId}\0${messageId}`, {
    text: "These are my actual words.", attachments: [], authoredInput: { messageId, data }, receipt
  });
  f.observe();
  f.emit(f.receipt(messageId, "Prepared model context must not replace authored words"));
  await f.drain();
  await receipt.promise;
  const turns = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === messageId);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].user.messageId, messageId);
  assert.equal(turns[0].user.text, "These are my actual words.");
  assert.deepEqual(turns[0].user.data, data);
  assert.ok(f.operations.indexOf("authored-message") < f.operations.indexOf("event:codex-app-server-user-message-consumed"));
  data.association.reference = "later-mutated-reference";
  assert.equal((await f.store.readConversationLog(f.sessionId)).find(row => row.user?.messageId === messageId).user.data.association.reference, "issued-reference");
});

test("native receipt recovery keeps saved application data without recapture or duplication", async () => {
  const f = await receiptFixture();
  const messageId = "application-data-restart";
  const data = { association: { reference: "original-saved-reference" } };
  f.run = { ...f.run, state: "starting", providerTurnId: "", pendingUserMessageClientIds: [] };
  f.metadata.set("authorized-delivery", JSON.stringify({ engines: { codex: { pending: {
    messageId, threadId: f.threadId, message: "Private prepared prompt", displayMessage: "My retained answer.",
    displayAttachments: [], data
  } } } }));
  f.observe();
  f.emit(f.receipt(messageId));
  await f.drain();
  f.emit(f.receipt(messageId));
  await f.drain();
  const rows = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === messageId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user.text, "My retained answer.");
  assert.deepEqual(rows[0].user.data, data);
  assert.equal(f.operations.filter(value => value === "authored-message").length, 1);
  assert.equal(JSON.stringify(rows).includes("Private prepared prompt"), false);
});

test("native receipt does not borrow application data from another authored identity", async () => {
  const f = await receiptFixture();
  const messageId = "application-data-matching";
  f.run = { ...f.run, state: "starting", providerTurnId: "", pendingUserMessageClientIds: [messageId] };
  const receipt = Promise.withResolvers();
  f.owner.pendingUserMessages.set(`project:${f.sessionId}\0${messageId}`, {
    text: "Unassociated actual words.", attachments: [],
    authoredInput: { messageId: "other-message", data: { association: "foreign" } }, receipt
  });
  f.observe();
  f.emit(f.receipt(messageId));
  await f.drain();
  await receipt.promise;
  const rows = (await f.store.readConversationLog(f.sessionId)).filter(row => row.user?.messageId === messageId);
  assert.equal(rows.length, 1);
  assert.equal(Object.hasOwn(rows[0].user, "data"), false);
});

test("native changeover retries retain original application data including its absence", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  for (const data of [undefined, { association: "original" }]) {
    const pending = { messageId: "retained-request", message: "Prepared original prompt", displayMessage: "Actual original words.",
      displayAttachments: [], attachmentIds: [], seen: {}, attempted: false,
      ...(data !== undefined ? { data } : {}) };
    let sent;
    const changeover = createConversationChangeover({
      state: { async read() { return { lastEngine: "codex", engines: { codex: { seen: {}, pending } } }; }, async write() {} },
      transcript: { async hasMessage() { return false; } },
      agent: { async sendMessage(input) { sent = input; return { ok: false, delivered: false }; } }
    });
    await changeover.send({ engineId: "codex", messages: [], input: {
      messageId: pending.messageId, message: "Actual original words.", data: { association: "newer-reference" }
    } });
    assert.equal(sent.message, pending.message);
    assert.equal(sent.displayMessage, pending.displayMessage);
    assert.deepEqual(sent.data, data);
  }
});

test("initial native seed limits preserve generic history, full returning corrections and delivery ownership", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  const attachment = { attachmentId: "retained-file", name: "retained.txt" };
  const messages = Array.from({ length: 31 }, (_, index) => ({
    id: `stored-${index}`, messageId: `authored-${index}`, role: index % 2 ? "assistant" : "user",
    text: `${index}:` + "x".repeat(2_100), version: `version-${index}`, engineId: "claude",
    ...(index === 30 ? { attachments: [attachment] } : {})
  }));
  const original = structuredClone(messages);
  const words = "My current words remain complete: " + "y".repeat(2_100);
  const input = { messageId: "current-input", message: words, displayAttachments: [attachment], data: { reference: "current" } };
  for (const scenario of ["generic", "one-current", "two-current", "wake", "empty", "returning"]) {
    const allowance = scenario === "two-current" ? 22 : scenario === "wake" ? 24 : scenario === "empty" ? 0 : 23;
    let value = { lastEngine: "claude", engines: { codex: { seen: scenario === "returning"
      ? { "stored-0": "old-version", removed: "removed-version" } : {} } } };
    let sent;
    const changeover = createConversationChangeover({
      state: { async read() { return value; }, async write(next) { value = next; } },
      transcript: { async hasMessage() { return false; } },
      agent: { async sendMessage(actual) { sent = actual; return { ok: true, delivered: true }; } },
      captureContext: true,
      ...(scenario !== "generic" ? { maximumInitialMessages: allowance, maximumInitialMessageCharacters: 2_000 } : {})
    });
    assert.equal((await changeover.send({ engineId: "codex", messages, input })).delivered, true);
    const carried = sent.contextText.split("\n").filter(line => line.startsWith("{")).map(JSON.parse)[0];
    const selected = scenario === "returning" ? messages : scenario === "empty" ? []
      : messages.slice(scenario === "generic" ? -30 : -allowance);
    assert.deepEqual(carried.messages.map(message => [message.id, message.text]), selected.map(message => [message.id,
      scenario !== "generic" && scenario !== "returning" ? message.text.slice(0, 2_000) : message.text]));
    assert.equal(carried.messages.some(message => message.messageId === input.messageId), false);
    if (scenario !== "empty") assert.deepEqual(carried.messages.at(-1).attachments, [attachment]);
    assert.deepEqual(sent.contextAttachments, scenario === "empty" ? [] : [attachment]);
    assert.deepEqual(sent.displayAttachments, input.displayAttachments);
    assert.deepEqual(sent.data, input.data);
    assert.ok(sent.message.endsWith(words));
    assert.deepEqual(carried.removedMessageIds, scenario === "returning" ? ["removed"] : []);
    if (scenario === "returning") assert.equal(carried.messages[0].corrected, true);
    assert.deepEqual(value.engines.codex.seen, Object.fromEntries(messages.map(message => [message.id, message.version])));
    assert.equal(value.engines.codex.pending, undefined);
    assert.equal(value.lastEngine, "codex");
    assert.deepEqual(messages, original, "clipping a fresh seed must not edit stored history or its fingerprints");
  }
});

test("initial native seed options refuse invalid limits before delivery", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  for (const name of ["maximumInitialMessages", "maximumInitialMessageCharacters"]) {
    for (const value of [...(name === "maximumInitialMessageCharacters" ? [0] : []), -1, 1.5, "24", NaN]) {
      assert.throws(() => createConversationChangeover({ [name]: value }), /non-negative message limit and a positive text limit/);
    }
  }
});

// Original Colleague first-progress test261 requires transient intent even
// while the application effect waits. Other consumers keep default persistence.
test("original output owner can publish transient commentary without losing native deduplication", async () => {
  const f = await outputFixture({ persistCommentary: false });
  const { owner, sessionId, threadId, turnId, store } = f;
  const progress = "Checking the source.";
  await owner.writeStream(sessionId, { threadId, turnId, itemId: "transient-progress", role: "commentary", delta: progress });
  const complete = itemId => owner.writeLiveProgress(sessionId, threadId, { method: "item/completed", params: {
    threadId, turnId, item: outputItem(itemId, progress, "commentary")
  } });
  await complete("transient-progress");
  assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.commentary || []), []);
  assert.deepEqual(store.readConversationStream(sessionId).messages, []);
  assert.equal(f.publications.at(-1).reason, "codex-app-server-commentary");
  assert.ok(f.publications.at(-1).payload.conversationStream);
  assert.equal(f.publications.at(-1).payload.conversationLogPatch, undefined);
  assert.equal(owner.liveProgressItems.size, 1);
  assert.equal(owner.liveProgressFingerprints.size, 1);
  await complete("transient-progress");
  await complete("same-progress-another-item");
  assert.equal(owner.liveProgressItems.size, 1, "repeated completed item and matching text do not lose their native deduplication");
  assert.equal(owner.liveProgressFingerprints.size, 1);
  assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.commentary || []), []);
  f.history = [{ id: turnId, status: "completed", items: [
    outputItem("transient-progress", progress, "commentary"), outputItem("final-answer", "Checked.")
  ] }];
  await f.final("final-answer", "Checked.");
  assert.deepEqual((await f.replies()).map(row => row.assistant.text), ["Checked."]);
  assert.deepEqual((await store.readConversationLog(sessionId)).flatMap(row => row.commentary || []), []);
  assert.equal(f.history[0].items[0].text, progress, "canonical policy does not change native history");
});

test("completed envelope carriers stay raw while native history versions and API briefings use product rows", async () => {
  const { conversationNativeMessages, conversationHistoryVersions, conversationContinuity } = await import("../src/server/conversation/continuity.js");
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await storage.write("projection", async tx => {
    await tx.appendMessage("000001", { role: "user", messageId: "actual-user", text: "My visible words", at: "2026-10-10" });
    await tx.appendMessage("000001", { role: "assistant", messageId: "actual-reply", text: "My plain answer", at: "2026-10-10" });
    await tx.appendMessage("000002", { role: "system", messageId: "internal-native-input", text: "Private generated prompt", at: "2026-10-10",
      turnMetadata: { runtime: { engine: "codex", origin: "application", completedEnvelope: true, status: "complete" },
        applicationTools: [{ id: "internal-native-input:operation", status: "unknown" }] } });
    await tx.appendMessage("000002", { role: "assistant", messageId: "internal-final", text: '{"kind":"tool","arguments":"private"}', at: "2026-10-10" });
    await tx.appendMessage("000003", { role: "user", messageId: "authored-json", text: '{"completedEnvelope":true}',
      data: { completedEnvelope: true }, at: "2026-10-10" });
  });
  const raw = await transcript.readConversationLog("projection");
  const before = structuredClone(raw);
  assert.deepEqual(conversationNativeMessages(raw).map(row => row.messageId), ["actual-user", "actual-reply", "authored-json"]);
  assert.deepEqual(Object.keys(conversationHistoryVersions(raw)), ["000001/user/", "000001/assistant/", "000003/user/"]);
  const briefing = conversationContinuity({ history: raw }).text;
  assert.match(briefing, /My visible words/);
  assert.match(briefing, /My plain answer/);
  assert.equal(briefing.includes("Private generated prompt"), false);
  assert.equal(briefing.includes("internal-final"), false);
  assert.deepEqual(raw, before);
  assert.deepEqual(await transcript.readConversationLog("projection"), before, "Private native carriers and durable outcome custody are never rewritten");
});

test("completed envelope native seed slices the original 24 rows before excluding the current batch and commits seen only after admission", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  const messages = Array.from({ length: 30 }, (_, index) => ({ id: `stored-${index}`, messageId: `authored-${index}`,
    role: "user", text: `${index}:` + "x".repeat(2100), version: `version-${index}`, engineId: "claude" }));
  const before = structuredClone(messages);
  let value = { lastEngine: "", engines: { codex: { seen: {} } } };
  const entered = Promise.withResolvers();
  const admitted = Promise.withResolvers();
  const sent = [];
  const changeover = createConversationChangeover({
    state: { async read() { return value; }, async write(next) { value = next; } },
    transcript: { async hasMessage() { return false; } }, captureContext: true,
    maximumInitialMessages: 24, maximumInitialMessageCharacters: 2000,
    agent: { async sendMessage(input) {
      sent.push(input);
      if (sent.length === 1) {
        await input.onPromptSending({ threadId: "same-native-thread" });
        entered.resolve();
        await admitted.promise;
      }
      return { ok: true, delivered: true };
    } }
  });
  const sending = changeover.send({ engineId: "codex", messages, completedEnvelope: true,
    excludedMessageIds: ["authored-28", "authored-29"],
    input: { messageId: "internal-1", message: JSON.stringify({ userMessages: ["authored-28", "authored-29"] }) } });
  await entered.promise;
  const carried = sent[0].contextText.split("\n").filter(line => line.startsWith("{")).map(JSON.parse)[0];
  assert.deepEqual(carried.messages.map(row => row.messageId), messages.slice(-24).slice(0, -2).map(row => row.messageId));
  assert.equal(carried.messages.length, 22, "The original 24-row window is not expanded to 24 older rows plus the batch");
  assert.equal(carried.messages[0].text.length, 2000);
  assert.equal(sent[0].message.split("authored-28").length - 1, 1);
  assert.equal(sent[0].message.split("authored-29").length - 1, 1);
  assert.deepEqual(value.engines.codex.seen, {}, "Prepared history does not claim delivery before the actual native ACK");
  const snapshot = Object.fromEntries(messages.map(row => [row.id, row.version]));
  assert.deepEqual(value.engines.codex.pending.seen, snapshot);
  admitted.resolve();
  assert.equal((await sending).delivered, true);
  assert.deepEqual(value.engines.codex.seen, snapshot, "The genuinely admitted internal prompt consumed the product batch history");
  await changeover.send({ engineId: "codex", messages, input: { messageId: "internal-2", message: "Continue from the saved operation result" } });
  assert.equal(sent[1].contextText, undefined, "The next native response does not replay the already included B/C batch as catch-up");
  assert.equal(sent[1].message, "Continue from the saved operation result");
  assert.deepEqual(sent.map(input => input.messageId), ["internal-1", "internal-2"], "Only real internal inputs have native receipts");
  assert.deepEqual(messages, before);
});

test("completed envelope native retries preserve the exact prepared history snapshot without recapture", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  let value = { lastEngine: "", engines: { codex: { seen: {} } } };
  let accepted = false;
  let dispatches = 0;
  const original = [{ id: "row-B", messageId: "authored-B", role: "user", text: "Original B", version: "original-B" }];
  const changeover = createConversationChangeover({
    state: { async read() { return value; }, async write(next) { value = next; } },
    captureContext: true, maximumInitialMessages: 24, maximumInitialMessageCharacters: 2000,
    transcript: { async hasMessage() { return false; }, async writeUserMessage() {} },
    agent: { async sendMessage(input) { dispatches++; await input.onPromptSending({ threadId: "exact-thread" }); return { ok: false, delivered: false }; },
      async inspectMessageAdmission() { return { admission: accepted ? "accepted" : "unknown", threadId: "exact-thread" }; } }
  });
  const input = { messageId: "internal-retry", message: "Generated original B prompt" };
  await changeover.send({ engineId: "codex", messages: original, input, completedEnvelope: true, excludedMessageIds: ["authored-B"] });
  const pending = structuredClone(value.engines.codex.pending);
  const updated = [{ ...original[0], text: "Changed B", version: "changed-B" }];
  const unknown = await changeover.send({ engineId: "codex", messages: updated, input,
    completedEnvelope: true, excludedMessageIds: ["different-new-batch"] });
  assert.equal(unknown.delivered, false);
  assert.deepEqual(value.engines.codex.pending, pending);
  assert.deepEqual(value.engines.codex.seen, {});
  accepted = true;
  assert.equal((await changeover.send({ engineId: "codex", messages: updated, input,
    completedEnvelope: true, excludedMessageIds: [] })).delivered, true);
  assert.deepEqual(value.engines.codex.seen, pending.seen);
  assert.equal(value.engines.codex.pending, undefined);
  assert.equal(dispatches, 1, "Inspecting the same native input never resubmits or substitutes its batch/history snapshot");
});

test("completed envelope history exclusions require explicit tracked input and exact nonduplicate authored IDs", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  let reads = 0;
  let sent;
  const messages = [{ id: "row-B", messageId: "authored-B", role: "user", text: "Visible B", version: "version-B" }];
  const changeover = createConversationChangeover({
    state: { async read() { reads++; return { lastEngine: "", engines: { codex: { seen: {} } } }; }, async write() {} },
    captureContext: true,
    transcript: { async hasMessage() { return false; } },
    agent: { async sendMessage(input) { sent = input; return { ok: true, delivered: true }; } }
  });
  const input = { messageId: "internal-input", message: "Current generated prompt", data: { completedEnvelope: true, excludedMessageIds: ["authored-B"] } };
  for (const excludedMessageIds of [["authored-B", "authored-B"], [""], ["  "], ["x".repeat(129)], [1], "authored-B"]) {
    await assert.rejects(changeover.send({ engineId: "codex", messages, input, completedEnvelope: true, excludedMessageIds }), /tracked completed envelope and exact message IDs/);
  }
  await assert.rejects(changeover.send({ engineId: "codex", messages, input, excludedMessageIds: ["authored-B"] }), /tracked completed envelope/);
  assert.equal(reads, 0, "Invalid exclusions cannot enter existing state or delivery owners");
  await changeover.send({ engineId: "codex", messages, input });
  const carried = sent.contextText.split("\n").filter(line => line.startsWith("{")).map(JSON.parse)[0];
  assert.deepEqual(carried.messages.map(row => row.messageId), ["authored-B"], "Caller data is never a history-exclusion grant");
  assert.deepEqual(sent.data, input.data);
});

test("completed envelope returning corrections remain full while the current batch is excluded only from rendering", async () => {
  const { createConversationChangeover } = await import("../src/server/conversation/continuity.js");
  const messages = [{ id: "old-row", messageId: "old-authored", role: "user", text: "Edited " + "x".repeat(2100), version: "edited" },
    { id: "current-row", messageId: "current-authored", role: "user", text: "Current B", version: "current" }];
  let value = { lastEngine: "codex", engines: { codex: { seen: { "old-row": "before-edit", removed: "removed-version" } } } };
  let sent;
  const changeover = createConversationChangeover({
    state: { async read() { return value; }, async write(next) { value = next; } },
    maximumInitialMessages: 24, maximumInitialMessageCharacters: 2000, captureContext: true,
    transcript: { async hasMessage() { return false; } },
    agent: { async sendMessage(input) { sent = input; return { ok: true, delivered: true }; } }
  });
  await changeover.send({ engineId: "codex", messages, input: { messageId: "internal-correction", message: "Current B prompt" },
    completedEnvelope: true, excludedMessageIds: ["current-authored"] });
  const carried = sent.contextText.split("\n").filter(line => line.startsWith("{")).map(JSON.parse)[0];
  assert.deepEqual(carried.messages.map(row => [row.messageId, row.text, row.corrected]), [["old-authored", messages[0].text, true]]);
  assert.deepEqual(carried.removedMessageIds, ["removed"]);
  assert.deepEqual(value.engines.codex.seen, { "old-row": "edited", "current-row": "current" });
});
