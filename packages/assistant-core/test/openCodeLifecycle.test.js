import assert from "node:assert/strict";
import test from "node:test";
import { createOpenCodeSharedRuntime } from "../src/server/conversation/openCodeRuntime.js";
import { openCodeMessageError } from "../src/server/conversation/openCodeTurn.js";

const SESSION_ID = "session-a";
const KEY = `project\0${SESSION_ID}`;
const THREAD_ID = "ses_native";
const INPUT_ID = "msg_input";
const CONNECTION = { modelProviderId: "provider", canonicalUrl: "https://provider.invalid", fingerprint: "account", endpointCode: "api" };
const SELECTION = { agentId: "build", modelId: "model", modelProviderId: "provider", variantId: "" };
const ABORTED = "The operation was aborted.";

// OpenCode's native history outlives each server that runs it. The turn's reply
// is still being written until an interrupt ends it as aborted.
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
  return { calls, create };
}

// One server with Vibe64's run rules: the session record keeps the OpenCode run,
// and a turn's end first runs the host's checkpoint, a Git snapshot there.
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
      threadId: turn.threadId, turnId: turn.id, startedAt: turn.startedAt };
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

test("OpenCode shutdown leaves a running turn's end and its checkpoint to the next server", { timeout: 5_000 }, async t => {
  // The host's checkpoint can take longer than the server has to stop.
  const checkpoint = Promise.withResolvers();
  const native = nativeOpenCode();
  const saved = { run: null };
  const first = server(native, saved, { turnEndCheckpoint: () => checkpoint.promise });
  await first.running();
  const running = saved.run;
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
  assert.deepEqual(first.calls.writes, ["active"], "shutdown wrote nothing");
  assert.equal(saved.run, running, "the saved run was not rewritten");
  assert.deepEqual({ active: running.active, state: running.state, turnId: running.turnId }, { active: true, state: "active", turnId: INPUT_ID });
  // The next server's recovery observes the native conversation, then ends the turn through its checkpoint.
  const next = server(native, saved);
  t.after(() => next.shutdown());
  const recovered = await next.recover();
  assert.deepEqual(recovered.results, [{ ok: true, resumed: true, sessionId: SESSION_ID }]);
  assert.equal(native.calls.starts, 2);
  assert.deepEqual(next.calls.checkpoints, [`${INPUT_ID}:failed`]);
  assert.deepEqual({ active: saved.run.active, state: saved.run.state, error: saved.run.error },
    { active: false, state: "failed", error: ABORTED });
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
