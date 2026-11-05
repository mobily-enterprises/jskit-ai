import assert from "node:assert/strict";
import test from "node:test";
import { createOpenCodeSharedRuntime } from "../src/server/conversation/openCodeRuntime.js";
import { observeOpenCodeTurnCompletion, openCodeMessageError } from "../src/server/conversation/openCodeTurn.js";

const SESSION_ID = "session-a";
const KEY = `project\0${SESSION_ID}`;
const THREAD_ID = "ses_native";
const INPUT_ID = "msg_input";
const CONNECTION = { modelProviderId: "provider", canonicalUrl: "https://provider.invalid", fingerprint: "account", endpointCode: "api" };
const SELECTION = { agentId: "build", modelId: "model", modelProviderId: "provider", variantId: "" };
const ABORTED = "The operation was aborted.";
const PROVIDER_FAILURE = "The provider refused this request.";

// OpenCode's native history outlives each server that runs it. The turn's reply
// is still being written until an interrupt ends it as aborted, or its provider
// fails it.
function nativeOpenCode() {
  const rows = [
    { id: INPUT_ID, type: "user", time: { created: 1 } },
    { id: "msg_reply", type: "assistant", text: "", time: { created: 2 } }
  ];
  let busy = true;
  const calls = { interrupts: [], starts: 0, stops: 0 };
  function create() {
    calls.starts += 1;
    const client = {
      async health() { return { healthy: true }; },
      async prepareDirectory() {},
      async readSession(id) { return { id }; },
      async switchModel() {},
      async switchAgent() {},
      async messages() { return rows; },
      async sessionStatus() { return { type: busy ? "busy" : "idle" }; },
      async interrupt(id) {
        calls.interrupts.push(id);
        if (busy) rows[1] = { ...rows[1], error: { name: "MessageAbortedError", data: { message: ABORTED } }, time: { created: 2, completed: 3 } };
        busy = false;
        return true;
      },
      forDirectory() { return client; }
    };
    return { client, async stop() { calls.stops += 1; return { exited: true }; } };
  }
  function fail() {
    rows[1] = { ...rows[1], error: { name: "APIError", data: { message: PROVIDER_FAILURE } }, time: { created: 2, completed: 3 } };
    busy = false;
  }
  return { calls, create, fail };
}

// One server with Vibe64's run rules: the session record keeps the OpenCode run
// with the shutdown's mark, and a turn's end first runs the host's checkpoint, a
// Git snapshot there.
function server(native, saved, { turnEndCheckpoint = async () => {} } = {}) {
  const runtime = createOpenCodeSharedRuntime({});
  const calls = { checkpoints: [], writes: [] };
  const active = Promise.withResolvers();
  async function writeRun(turn, state, error = "") {
    const running = state === "starting" || state === "active";
    if (!running && turn.id) {
      calls.checkpoints.push(`${turn.id}:${state}`);
      await turnEndCheckpoint();
    }
    calls.writes.push(state);
    saved.run = { active: running, state, error, observationError: turn.observationError || "",
      stoppedByShutdown: turn.stoppedByShutdown === true, threadId: turn.threadId, turnId: turn.id, startedAt: turn.startedAt };
    if (state === "active") active.resolve();
  }
  const projection = {
    messageId: (id, role) => `${id}:${role}`, readError: openCodeMessageError, reasoning: async () => {},
    store: {
      async writeConversationAssistantMessage(_sessionId, message) { return { assistant: message }; },
      updateConversationStream() {}, completeConversationStreamMessage() {}
    },
    publishTurn: async () => {}, publishStream: async () => {}
  };
  const monitor = {
    prepare() { return { fields: {} }; },
    create() {
      return {
        observe: () => ({ readFailure: () => null, close: async () => {} }),
        finalResponse: { readError: openCodeMessageError },
        writeRun,
        projectMessages: (messages, options) => runtime.writeConversationProjection(SESSION_ID, messages, options, projection),
        completeResult: async (_turn, { failure }) => failure,
        onRetired() {}
      };
    },
    onError() {}
  };
  const failure = error => { throw error; };
  const release = {
    ownsTarget: () => true, async beforeRelease() {}, async onRemoved() {}, async closeTerminals() {}, async afterRelease() {}, failure
  };
  const processPreparation = {
    key: KEY, connection: CONNECTION, failure, async onFailure() {},
    async configure() {
      return {
        target: { sessionId: SESSION_ID, upstreamSessionId: THREAD_ID, workdir: "/work/a", projectContextRoot: "/work",
          connection: CONNECTION, selection: SELECTION, helperModelId: "" },
        async prepareServer() { return { create: async () => native.create(), options: {}, connections: [CONNECTION] }; }
      };
    }
  };
  const session = { selection: SELECTION, model: { id: SELECTION.modelId, providerID: SELECTION.modelProviderId },
    identity: { async write() {}, async publish() {} } };
  return {
    runtime, calls, release,
    shutdown: () => runtime.invalidateRuntimes({ reason: "server-shutdown" }, { release }),
    async running() {
      const target = await runtime.acquirePrepared(processPreparation);
      void runtime.beginMessageMonitor(KEY, target, { id: INPUT_ID, eventStartedAt: 1, startedAt: "2026-11-05T00:00:00.000Z" }, {}, monitor);
      await active.promise;
      return target;
    },
    stop: () => runtime.interruptPreparedTurn({ key: KEY, threadId: THREAD_ID, writeRun, failure }),
    // A temporary conversation's turn, observed as the application's detached chats are.
    async temporary(conversationId) {
      const target = await runtime.acquirePrepared(processPreparation);
      const closes = [];
      const entry = { active: true, target, conversationId, inputMessageId: INPUT_ID, abortController: new AbortController() };
      runtime.temporaryConversations.set(`${KEY}\0${conversationId}`, entry);
      entry.completion = observeOpenCodeTurnCompletion(runtime, { ...target, upstreamSessionId: conversationId }, conversationId, entry, {
        events: { async close() {} },
        signal: AbortSignal.any([target.abortController.signal, entry.abortController.signal]),
        afterClose: closed => { closes.push(closed); }
      });
      return { entry, closes };
    },
    // A later read of that conversation, as the application reads a saved chat.
    async readTemporary(conversationId, stoppedByShutdown) {
      const target = await runtime.acquirePrepared(processPreparation);
      return runtime.readPersistentConversation(target, conversationId, null, {
        readError: openCodeMessageError, messageId: (id, part) => `${id}:${part}`, inputMessageId: "", stoppedByShutdown
      });
    },
    // Opening the chat: its readiness recovers a run the previous server left.
    ready: () => runtime.ensurePreparedSessionReadiness({
      key: KEY, selection: SELECTION, workdir: "/work/a", changed: () => new Error("The session changed."),
      connection: async () => CONNECTION, refresh: async () => ({ key: KEY, workdir: "/work/a", selection: SELECTION }),
      prepare: async operation => ({
        value: await operation({ key: KEY, configuration: () => ({ process: async () => processPreparation, session }) })
      }),
      observation: {
        get run() { return saved.run; },
        async write(operation) { await operation(saved.run, apply => apply(writeRun)); }
      }
    }),
    async recover() {
      const result = await runtime.reconcileSessions([{ sessionId: SESSION_ID }], {}, {
        session: async () => ({
          key: KEY, activeRun: saved.run?.active ? saved.run : undefined, failure,
          process: async () => processPreparation, session: () => session,
          observation: { writeRun, monitor, fallbackTurnId: "msg_fallback" }
        })
      });
      await runtime.monitors.get(KEY);
      return result;
    }
  };
}

function runOf(saved) {
  const { active, state, error, stoppedByShutdown, turnId } = saved.run;
  return { active, state, error, stoppedByShutdown, turnId };
}

// Shutdown with a host checkpoint that can take longer than the server has to stop.
async function shutdownRunning(native, saved) {
  const checkpoint = Promise.withResolvers();
  const first = server(native, saved, { turnEndCheckpoint: () => checkpoint.promise });
  await first.running();
  let timer;
  const result = await Promise.race([
    first.shutdown(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Shutdown waited for the turn's checkpoint")), 1_000); })
  ]).finally(() => {
    clearTimeout(timer);
    checkpoint.resolve();
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(native.calls.interrupts, [THREAD_ID], "shutdown stopped the native turn");
  assert.equal(native.calls.stops, 1, "shutdown proved the OpenCode process exit");
  assert.deepEqual(first.calls.checkpoints, [], "shutdown ran no checkpoint");
  assert.deepEqual(first.calls.writes, ["active", "active"], "shutdown only marked the saved run");
  assert.deepEqual(runOf(saved), { active: true, state: "active", error: "", stoppedByShutdown: true, turnId: INPUT_ID });
}

test("a goal's recovery on the next server records an OpenCode turn stopped by shutdown as interrupted, with one checkpoint", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  await shutdownRunning(native, saved);
  const next = server(native, saved);
  t.after(() => next.shutdown());
  const recovered = await next.recover();
  assert.deepEqual(recovered.results, [{ ok: true, resumed: false, sessionId: SESSION_ID }]);
  assert.deepEqual(next.calls.checkpoints, [`${INPUT_ID}:interrupted`]);
  assert.deepEqual(runOf(saved), { active: false, state: "interrupted", error: "", stoppedByShutdown: true, turnId: INPUT_ID });
});

test("opening the chat on the next server records an OpenCode turn stopped by shutdown as interrupted, with one checkpoint", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  await shutdownRunning(native, saved);
  const next = server(native, saved);
  t.after(() => next.shutdown());
  assert.equal((await next.ready()).ok, true);
  assert.deepEqual(next.calls.checkpoints, [`${INPUT_ID}:interrupted`]);
  assert.deepEqual(runOf(saved), { active: false, state: "interrupted", error: "", stoppedByShutdown: true, turnId: INPUT_ID });
  assert.equal((await next.ready()).ok, true);
  assert.deepEqual(next.calls.checkpoints, [`${INPUT_ID}:interrupted`], "a second opening changes nothing");
});

test("a genuine OpenCode failure still records failed, and a native abort without the shutdown's mark is no interruption", { timeout: 5_000 }, async t => {
  const failing = nativeOpenCode();
  const failed = { run: null };
  const running = server(failing, failed);
  t.after(() => running.shutdown());
  await running.running();
  failing.fail();
  await running.runtime.monitors.get(KEY);
  assert.deepEqual(running.calls.checkpoints, [`${INPUT_ID}:failed`]);
  assert.equal(failed.run.state, "failed");
  assert.match(failed.run.error, /provider refused/u);

  // A run left active without the mark (a crash, say) whose native turn was aborted.
  const native = nativeOpenCode();
  const saved = { run: { active: true, state: "active", error: "", observationError: "", stoppedByShutdown: false,
    threadId: THREAD_ID, turnId: INPUT_ID, startedAt: "2026-11-05T00:00:00.000Z" } };
  await native.create().client.interrupt(THREAD_ID);
  const next = server(native, saved);
  t.after(() => next.shutdown());
  assert.deepEqual((await next.recover()).results, [{ ok: true, resumed: true, sessionId: SESSION_ID }]);
  assert.deepEqual(next.calls.checkpoints, [`${INPUT_ID}:failed`]);
  assert.deepEqual(runOf(saved), { active: false, state: "failed", error: ABORTED, stoppedByShutdown: false, turnId: INPUT_ID });
});

test("OpenCode Stop and session close still end a running turn through the host's checkpoint", async t => {
  const stopped = { run: null };
  const stopping = server(nativeOpenCode(), stopped);
  t.after(() => stopping.shutdown());
  await stopping.running();
  assert.equal((await stopping.stop()).interrupted, true);
  assert.deepEqual(stopping.calls.checkpoints, [`${INPUT_ID}:interrupted`]);
  assert.deepEqual({ active: stopped.run.active, state: stopped.run.state }, { active: false, state: "interrupted" });

  const closed = { run: null };
  const closing = server(nativeOpenCode(), closed);
  t.after(() => closing.shutdown());
  await closing.running();
  assert.equal((await closing.runtime.closeSession(SESSION_ID, {}, closing.release)).ok, true);
  assert.deepEqual(closing.calls.checkpoints, [`${INPUT_ID}:cancelled`]);
  assert.deepEqual({ active: closed.run.active, state: closed.run.state }, { active: false, state: "cancelled" });
});

test("OpenCode shutdown ends a temporary conversation's turn as interrupted, and only the shutdown's mark reads it so on the next server", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const first = server(native, { run: null });
  const { entry, closes } = await first.temporary("ses_temp");
  assert.equal((await first.shutdown()).ok, true);
  assert.deepEqual(await entry.completion, { interrupted: true });
  assert.deepEqual(native.calls.interrupts, ["ses_temp"], "shutdown stopped the native turn");
  assert.deepEqual(closes, [{ stopped: true, outcome: "interrupted", stoppedByShutdown: true }],
    "the application is told to leave the turn's checkpoint to the next server");

  const next = server(native, { run: null });
  t.after(() => next.shutdown());
  const ended = [];
  const read = mark => next.readTemporary("ses_temp", mark).then(({ status, error, runId }) => ({ status, error, runId }));
  assert.deepEqual(await read({ runId: INPUT_ID, async ended() { ended.push(INPUT_ID); } }),
    { status: "interrupted", error: "", runId: INPUT_ID });
  assert.deepEqual(ended, [INPUT_ID], "recording the stopped run lets the application make its checkpoint");
  assert.deepEqual(await read(undefined), { status: "failed", error: ABORTED, runId: INPUT_ID });
  assert.deepEqual(await read({ runId: "msg_other", async ended() { ended.push("msg_other"); } }),
    { status: "failed", error: ABORTED, runId: INPUT_ID });
  assert.deepEqual(ended, [INPUT_ID]);

  // Outside shutdown a session close still ends the turn now, through the application's checkpoint.
  const closing = server(nativeOpenCode(), { run: null });
  t.after(() => closing.shutdown());
  const closed = await closing.temporary("ses_closed");
  assert.equal((await closing.runtime.closeSession(SESSION_ID, {}, closing.release)).ok, true);
  await closed.entry.completion.catch(() => null);
  assert.deepEqual(closed.closes, [{ stopped: true, outcome: "failed", stoppedByShutdown: false }]);
});
