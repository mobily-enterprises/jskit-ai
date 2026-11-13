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
// is still being written until an interrupt ends it as aborted, its provider
// fails it, or it completes on its own.
function nativeOpenCode() {
  const rows = [
    { id: INPUT_ID, type: "user", time: { created: 1 } },
    { id: "msg_reply", type: "assistant", text: "", time: { created: 2 } }
  ];
  let busy = true;
  let eventFailure = null;
  const calls = { interrupts: [], prompts: [], starts: 0, stops: 0 };
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
      async prompt(_id, input) {
        calls.prompts.push(input.id);
        rows.push({ id: input.id, type: "user", time: { created: rows.length + 1 } });
        busy = true;
        return { id: input.id };
      },
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
  function complete() {
    rows[1] = { ...rows[1], text: "Done.", finish: "stop", time: { created: 2, completed: 3 } };
    busy = false;
  }
  // The provider fails the turn as a native session.error event, which only
  // polling notices; OpenCode goes idle.
  function failEvent() {
    eventFailure = Object.assign(new Error(PROVIDER_FAILURE), { name: "APIError" });
    busy = false;
  }
  return { calls, create, fail, complete, failEvent, readFailure: () => eventFailure };
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
        observe: () => ({ readFailure: native.readFailure, close: async () => {} }),
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
    // The server's shutdown begins: nothing stops yet.
    begin: () => runtime.beginShutdown(),
    async running() {
      const target = await runtime.acquirePrepared(processPreparation);
      void runtime.beginMessageMonitor(KEY, target, { id: INPUT_ID, eventStartedAt: 1, startedAt: "2026-11-05T00:00:00.000Z" }, {}, monitor);
      await active.promise;
      return target;
    },
    stop: () => runtime.interruptPreparedTurn({ key: KEY, threadId: THREAD_ID, writeRun, failure }),
    // A steer onto the running turn, sent as the application sends one: its
    // admission stays pending until `commit`, its authored-row write, returns.
    steer: (id, commit) => runtime.sendPreparedMessage({
      key: KEY, input: { id, threadId: THREAD_ID, workdir: "/work/a" }, project: value => value,
      application: {
        writeRun, monitor, commit,
        prepare: async () => ({ process: processPreparation, session }),
        prompt: async () => ({ agent: SELECTION.agentId, model: session.model, prompt: { text: "Continue differently" },
          beforeDispatch: async () => {} })
      }
    }, {}),
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

test("once OpenCode's shutdown has begun, a main turn that ends on its own is left to the next server, which records it with one checkpoint", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  const first = server(native, saved);
  t.after(() => first.shutdown());
  await first.running();
  first.begin();
  assert.deepEqual({ interrupts: native.calls.interrupts, stops: native.calls.stops }, { interrupts: [], stops: 0 },
    "beginning the shutdown stopped nothing");
  native.complete();
  await first.runtime.monitors.get(KEY);
  assert.deepEqual(first.calls.checkpoints, [], "the turn's end made no checkpoint");
  assert.deepEqual(runOf(saved), { active: true, state: "active", error: "", stoppedByShutdown: true, turnId: INPUT_ID });
  assert.equal((await first.shutdown()).ok, true);
  assert.equal(native.calls.stops, 1, "the full stop still proved the OpenCode process exit");
  assert.deepEqual(first.calls.checkpoints, []);

  const next = server(native, saved);
  t.after(() => next.shutdown());
  assert.equal((await next.ready()).ok, true);
  assert.equal((await next.ready()).ok, true);
  assert.deepEqual(next.calls.checkpoints, [`${INPUT_ID}:interrupted`], "the next server made the checkpoint once");
  assert.deepEqual(runOf(saved), { active: false, state: "interrupted", error: "", stoppedByShutdown: true, turnId: INPUT_ID });
});

test("once OpenCode's shutdown has begun, a temporary conversation's turn that ends on its own leaves its checkpoint to the next server", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const first = server(native, { run: null });
  t.after(() => first.shutdown());
  const { entry, closes } = await first.temporary("ses_temp");
  first.begin();
  native.complete();
  assert.deepEqual(await entry.completion, { interrupted: true });
  assert.deepEqual(native.calls.interrupts, [], "nothing interrupted the native turn");
  assert.deepEqual(closes, [{ stopped: true, outcome: "interrupted", stoppedByShutdown: true }],
    "the application is told to leave the turn's checkpoint to the next server");
  assert.equal((await first.shutdown()).ok, true);

  const next = server(native, { run: null });
  t.after(() => next.shutdown());
  const ended = [];
  const read = await next.readTemporary("ses_temp", { runId: INPUT_ID, async ended() { ended.push(INPUT_ID); } });
  assert.deepEqual({ status: read.status, error: read.error }, { status: "interrupted", error: "" });
  assert.deepEqual(ended, [INPUT_ID], "recording the run lets the application make its checkpoint");
});

const STEER_ID = "msg_steer";
const COMMIT_FAILURE = "The steer's authored row could not be saved.";

// Fails with `waited` unless `promise` settles within two seconds: what it waits
// for is held for the whole test, so only a wait for it would take longer.
async function within(promise, waited) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(waited)), 2_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

// A steer onto the running turn whose authored-row commit is held until released.
function heldSteer(running, t) {
  const entered = Promise.withResolvers();
  const held = Promise.withResolvers();
  const sending = running.steer(STEER_ID, async () => {
    entered.resolve();
    await held.promise;
    return { turnId: STEER_ID };
  });
  void sending.catch(() => {});
  t.after(() => held.resolve());
  return { entered: entered.promise, release: () => held.resolve(), sending };
}

test("while a steer's commit is pending, OpenCode keeps polling its turn: a native failure ends it, and the steer is sent once", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  const running = server(native, saved);
  t.after(() => running.shutdown());
  await running.running();
  const steer = heldSteer(running, t);
  await steer.entered;
  native.failEvent();
  await within(running.runtime.monitors.get(KEY), "The monitor waited for the steer's commit before it saw the native failure");
  assert.equal(saved.run.state, "failed");
  assert.match(saved.run.error, /provider refused/u);
  steer.release();
  const sent = await within(steer.sending, "The steer did not end once its commit returned");
  assert.equal(sent.delivered, true, "the steer keeps its authored receipt");
  assert.deepEqual(native.calls.prompts, [STEER_ID], "the steer was not sent again");
});

test("Stop ends an OpenCode turn at once while a steer's commit is pending, and the steer is sent once", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  const running = server(native, saved);
  t.after(() => running.shutdown());
  await running.running();
  const steer = heldSteer(running, t);
  await steer.entered;
  const stopped = await within(running.stop(), "Stop waited for the steer's commit");
  assert.equal(stopped.interrupted, true);
  assert.deepEqual({ active: saved.run.active, state: saved.run.state }, { active: false, state: "interrupted" });
  assert.deepEqual(running.calls.checkpoints, [`${INPUT_ID}:interrupted`]);
  steer.release();
  assert.equal((await within(steer.sending, "The steer did not end once its commit returned")).delivered, true);
  assert.deepEqual(native.calls.prompts, [STEER_ID], "the steer was not sent again");
});

test("a steer whose commit fails ends the OpenCode turn with that failure, and is not sent again", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  const running = server(native, saved);
  t.after(() => running.shutdown());
  await running.running();
  await assert.rejects(within(running.steer(STEER_ID, async () => { throw new Error(COMMIT_FAILURE); }),
    "The steer's failed commit did not end it"), { message: COMMIT_FAILURE });
  await within(running.runtime.monitors.get(KEY), "The monitor outlived the steer's failed commit");
  assert.deepEqual({ active: saved.run.active, state: saved.run.state }, { active: false, state: "failed" });
  assert.match(saved.run.error, /could not be saved/u);
  assert.deepEqual(native.calls.prompts, [STEER_ID]);
});

test("another conversation on the same OpenCode process keeps being observed while a steer's commit is pending", { timeout: 5_000 }, async t => {
  const native = nativeOpenCode();
  const saved = { run: null };
  const running = server(native, saved);
  t.after(() => running.shutdown());
  await running.running();
  const { entry } = await running.temporary("ses_temp");
  const steer = heldSteer(running, t);
  await steer.entered;
  native.complete();
  const completed = await within(entry.completion, "The other conversation waited for the steer's commit");
  assert.equal(completed.result.text, "Done.");
  assert.equal(saved.run.active, true, "the steered turn itself still runs");
});
