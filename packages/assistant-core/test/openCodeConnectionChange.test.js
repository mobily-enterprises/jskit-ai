import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenCodeSharedRuntime, openCodeServerForDirectory } from "../src/server/conversation/openCodeRuntime.js";

// One shared server whose native directories record what OpenCode is asked to do.
function sharedServer() {
  const calls = [], rows = new Map(), loaded = new Set();
  const client = (directory = "/work/server") => ({
    async health() { return { healthy: true }; },
    async authenticateApiKey(providerId, key) { calls.push(["key", providerId, key]); },
    async removeAuthentication(providerId) { calls.push(["remove", providerId]); },
    async disposeInstance() { calls.push(["reload", directory]); loaded.delete(directory); },
    instanceDirectories: () => [...loaded],
    forDirectory(next) { loaded.add(next); return client(next); },
    async prompt(conversationId, input) {
      calls.push(["prompt", directory, conversationId]);
      rows.set(conversationId, [{ id: input.id, type: "user", time: { created: 1 } },
        { id: `${input.id}:answer`, type: "assistant", text: "Done.", time: { created: 2, completed: 3 } }]);
      return { id: input.id };
    },
    async messages(conversationId) { return rows.get(conversationId) || []; },
    async sessionStatus() { return { type: "idle" }; },
    async interrupt() { return true; }
  });
  const stops = [];
  const server = { client: client(), async stop() { stops.push(server); return { exited: true }; } };
  return { server, calls, rows, stops };
}

const deepseek = (fingerprint, apiKey) => ({ modelProviderId: "deepseek", canonicalUrl: "", endpointCode: "native", fingerprint, apiKey });

async function startedRuntime(saved) {
  const runtime = createOpenCodeSharedRuntime();
  const native = sharedServer();
  const shared = await runtime.ensure(saved[0], async () => ({ server: native.server, connections: [...saved] }), async () => saved);
  return { runtime, native, shared };
}

// A main-conversation turn in flight until its answer arrives.
function runningTurn(t, runtime, shared, workdir, { failure = "", completeResult = async (_turn, { failure: value }) => value } = {}) {
  const target = { key: workdir, workdir, upstreamSessionId: `${workdir}:thread`, abortController: new AbortController(),
    server: openCodeServerForDirectory(shared.server, workdir) };
  const turn = { id: "input", inputMessageId: "input", threadId: target.upstreamSessionId, active: true, state: "active",
    eventStartedAt: 1, abortController: new AbortController() };
  let observedFailure = null;
  const monitor = runtime.beginMonitor(workdir, target, turn, {
    observe: () => ({ readFailure: () => observedFailure, close: async () => {} }),
    finalResponse: { agent: "agent", model: { providerID: "deepseek", id: "model" }, recoveryMessageId: "recovery", readError: () => "" },
    projectMessages: async () => ({ failure: "", providerApiFailure: false, finalAssistantResult: null }),
    writeRun: async () => {},
    completeResult,
    onRetired() {}
  });
  t.after(async () => { turn.abortController.abort(); await monitor.catch(() => null); });
  return {
    target, turn, monitor,
    answer(native) {
      native.rows.set(target.upstreamSessionId, [{ id: "input", type: "user", time: { created: 1 } },
        { id: "answer", type: "assistant", text: "Done.", time: { created: 2, completed: 3 } }]);
    },
    fail(native) {
      native.rows.set(target.upstreamSessionId, [{ id: "input", type: "user", time: { created: 1 } }]);
      observedFailure = Object.assign(new Error(failure), { name: "UnknownError" });
    }
  };
}

function temporaryTurn(runtime, target, conversationId) {
  return runtime.runConversationTurn(target, conversationId, { active: false },
    { id: `${conversationId}:input`, agent: "agent", model: { providerID: "deepseek", id: "model" }, prompt: { text: "Hello" } }, {
      observe: () => ({ waitUntilReady: async () => {}, readFailure: () => null, close: async () => {} }),
      completion: { projectResult: value => value, readError: () => "" },
      onCompletion() {}
    });
}

test("an OpenCode connection change leaves running work alone and reloads idle directories at once", { timeout: 15_000 }, async t => {
  const saved = [deepseek("old", "old-key"), { ...deepseek("zai-account", "zai-key"), modelProviderId: "zai" }];
  const { runtime, native, shared } = await startedRuntime(saved);
  const running = runningTurn(t, runtime, shared, "/work/busy");
  // Another provider's retained conversation, which once refused the change.
  const peer = await runtime.acquire("peer", async () => ({ key: "peer", workdir: "/work/idle", modelProviderId: "zai",
    abortController: new AbortController(), server: openCodeServerForDirectory(shared.server, "/work/idle") }));
  saved[0] = deepseek("new", "new-key");
  let published = false;
  const changed = await runtime.invalidateRuntimes({ modelProviderId: "deepseek", publish() { published = true; } },
    { release: {}, connections: async () => saved });
  await delay(10);
  assert.deepEqual(changed, { closed: 0, ok: true });
  assert.equal(published, true);
  assert.deepEqual(native.calls, [["key", "deepseek", "new-key"], ["reload", "/work/idle"]]);
  assert.deepEqual(native.stops, []);
  assert.equal(runtime.current, shared);
  assert.equal(running.turn.active, true);
  assert.equal(running.target.abortController.signal.aborted, false);
  assert.equal(runtime.processes.get("peer"), peer);
  assert.equal(peer.abortController.signal.aborted, false);
  running.answer(native);
  assert.equal((await running.monitor).state, "completed");
  await delay(10);
  assert.deepEqual(native.calls.slice(2), [["reload", "/work/busy"]], "The busy directory reloads once its turn ends.");
});

test("new work in a directory with a turn in flight starts after that turn ends and the directory reloads", { timeout: 15_000 }, async t => {
  const saved = [deepseek("old", "old-key")];
  const { runtime, native, shared } = await startedRuntime(saved);
  const running = runningTurn(t, runtime, shared, "/work/busy");
  saved[0] = deepseek("new", "new-key");
  await runtime.invalidateRuntimes({ modelProviderId: "deepseek", publish() {} }, { release: {}, connections: async () => saved });
  const target = { workdir: "/work/busy", abortController: new AbortController(),
    server: openCodeServerForDirectory(shared.server, "/work/busy") };
  const elsewhere = { workdir: "/work/other", abortController: new AbortController(),
    server: openCodeServerForDirectory(shared.server, "/work/other") };
  const waiting = temporaryTurn(runtime, target, "temporary");
  assert.equal((await temporaryTurn(runtime, elsewhere, "unrelated")).status, "inProgress",
    "Another directory's new work does not wait.");
  await delay(30);
  assert.equal(native.calls.some(([kind, , id]) => kind === "prompt" && id === "temporary"), false);
  running.answer(native);
  await running.monitor;
  assert.equal((await waiting).status, "inProgress");
  const order = native.calls.map(call => call.join(" "));
  assert.ok(order.indexOf("reload /work/busy") < order.indexOf("prompt /work/busy temporary"), order.join("\n"));
});

test("a stale preparation cannot restore an older key, and a saved change reaches the server at the next use", async () => {
  const saved = [deepseek("old", "old-key")];
  const { runtime, native, shared } = await startedRuntime(saved);
  const start = async () => assert.fail("A changed key does not start another server.");
  saved[0] = deepseek("new", "new-key");
  assert.equal(await runtime.ensure(saved[0], start, async () => saved), shared);
  assert.equal(await runtime.ensure(deepseek("old", "old-key"), start, async () => saved), shared);
  assert.deepEqual(native.calls, [["key", "deepseek", "new-key"]]);
  assert.deepEqual(native.stops, []);
});

test("Disconnect removes the key, and a turn whose connection is gone ends with a reconnect message", { timeout: 15_000 }, async t => {
  const saved = [deepseek("old", "old-key")];
  const { runtime, native, shared } = await startedRuntime(saved);
  const outcomes = [];
  const running = runningTurn(t, runtime, shared, "/work/busy", {
    failure: "Model not found: deepseek/model. Did you mean: model?",
    async completeResult(_turn, outcome) { outcomes.push(outcome); return outcome.failure; }
  });
  saved.length = 0;
  await runtime.invalidateRuntimes({ modelProviderId: "deepseek", publish() {} }, { release: {}, connections: async () => saved });
  assert.deepEqual(native.calls, [["remove", "deepseek"]]);
  running.fail(native);
  const result = await running.monitor;
  assert.equal(result.state, "failed");
  assert.equal(result.error, "deepseek isn't connected. Connect it again, then send your message again.");
  assert.equal(outcomes[0].credentialFailure, true);
});

test("an open native terminal still refuses the change before anything is published", async () => {
  const saved = [deepseek("old", "old-key")];
  const { runtime, native } = await startedRuntime(saved);
  let published = false;
  saved[0] = deepseek("new", "new-key");
  await assert.rejects(runtime.invalidateRuntimes({ modelProviderId: "deepseek", publish() { published = true; } }, {
    release: { assertConnectionChange() { throw new Error("Close OpenCode native terminals."); } }, connections: async () => saved
  }), /Close OpenCode native terminals/u);
  assert.equal(published, false);
  assert.deepEqual(native.calls, []);
});
