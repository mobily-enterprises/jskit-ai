import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenCodeSharedRuntime, ensureOpenCodeSession, openCodeServerForDirectory, readOpenCodeEnvironments } from "../src/server/conversation/openCodeRuntime.js";

function fixture(options = {}) {
  const runtime = createOpenCodeSharedRuntime();
  const starts = [], stops = [];
  const connection = { modelProviderId: "provider", canonicalUrl: "https://provider.invalid", fingerprint: "account", endpointCode: "api" };
  const start = async selected => {
    const server = {
      client: {
        async health() { return { healthy: true }; },
        async interrupt(id) { return options.interrupt ? options.interrupt(id) : true; },
        async sessionStatus() { return { type: "idle" }; },
        forDirectory(directory) { return { ...this, directory }; }
      },
      async stop() {
        stops.push(server);
        return options.stop ? options.stop(server) : { exited: true };
      }
    };
    starts.push(server);
    return { server, connections: [selected] };
  };
  const acquire = (key, { selected = connection, prepare } = {}) => runtime.acquire(key, async () => {
    await prepare?.();
    const shared = await runtime.ensure(selected, () => start(selected));
    return { key, workdir: `/work/${key}`, abortController: new AbortController(),
      server: openCodeServerForDirectory(shared.server, `/work/${key}`) };
  });
  return { runtime, acquire, connection, starts, stops };
}

test("history projection supplies ordered reasoning facts without native part envelopes", async () => {
  const runtime = createOpenCodeSharedRuntime();
  const message = { id: "reply", type: "assistant", time: { created: 1_000 }, content: [
    { type: "tool", id: "tool", text: "Not reasoning" },
    { type: "reasoning", id: "first", text: "  First thought\n", time: { end: 0 }, nativeOnly: true },
    { type: "reasoning", id: "empty", text: " \n " },
    { type: "reasoning", text: "Second thought", time: { end: 2_000 } }
  ] };
  const original = structuredClone(message);
  const calls = [];
  const projection = {
    readError: () => "",
    reasoning: async (parts, options) => { calls.push({ parts, options }); }
  };
  await runtime.writeConversationProjection("conversation", [message], { streaming: true }, projection);
  await runtime.writeConversationProjection("conversation", [message], { streaming: false }, projection);
  const facts = [
    { messageId: "reply", partId: "first", text: "  First thought\n", createdAt: 1_000, complete: false },
    { messageId: "reply", partId: undefined, text: "Second thought", createdAt: 1_000, complete: true }
  ];
  assert.deepEqual(calls, [
    { parts: facts, options: { complete: false, flush: false } },
    { parts: facts, options: { complete: true, flush: true } }
  ]);
  assert.deepEqual(message, original, "normalization must not mutate native history");
});

test("native session acquisition stays coalesced through publication and retries a failed registry write", async () => {
  const calls = [];
  const publishing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const selection = { agentId: "assistant", modelId: "model", modelProviderId: "provider", variantId: "" };
  const model = { id: "model", providerID: "provider" };
  const target = { workdir: "/work/project", server: { client: {
    async prepareDirectory() {},
    async createSession(input) {
      calls.push("create");
      assert.deepEqual(input, { agent: "assistant", location: { directory: target.workdir }, model });
      return { id: "native-session" };
    }
  } } };
  let failPublication = true;
  const identity = {
    async write(id) {
      calls.push("write");
      assert.equal(id, "native-session");
      if (failPublication) assert.equal(target.upstream, undefined);
    },
    async publish(id) {
      calls.push("publish");
      assert.equal(target.upstreamSessionId, id);
      assert.deepEqual(target.upstream, { id });
      assert.deepEqual(target.upstreamSelection, selection);
      assert.notEqual(target.upstreamSelection, selection);
      if (failPublication) { publishing.resolve(); await release.promise; }
    }
  };
  const first = ensureOpenCodeSession(target, { selection, model, identity });
  const failedFirst = assert.rejects(first, /registry unavailable/);
  await publishing.promise;
  const pending = target.upstreamStart;
  const joined = ensureOpenCodeSession(target, { selection, model, identity });
  const failedJoined = assert.rejects(joined, /registry unavailable/);
  assert.equal(target.upstreamStart, pending);
  assert.deepEqual(calls, ["create", "write", "publish"]);
  release.reject(new Error("registry unavailable"));
  await Promise.all([failedFirst, failedJoined]);
  assert.equal(target.upstreamStart, undefined);
  failPublication = false;
  assert.equal(await ensureOpenCodeSession(target, { selection, model, identity }), target);
  assert.deepEqual(calls, ["create", "write", "publish", "write", "publish"]);
});

test("retained native selection reads its exact ID before model, agent and identity publication", async () => {
  const calls = [];
  const selection = { agentId: "assistant", modelId: "model", modelProviderId: "provider", variantId: "high" };
  const model = { id: "model", providerID: "provider", variant: "high" };
  const target = { upstreamSessionId: "retained-session", workdir: "/work/project", server: { client: {
    async prepareDirectory() {},
    async readSession(id) { calls.push(["read", id]); return { id }; },
    async switchModel(id, value) { calls.push(["model", id, value]); },
    async switchAgent(id, value) { calls.push(["agent", id, value]); },
    async createSession() { assert.fail("A retained native identity must never create another session."); }
  } } };
  const identity = {
    async write(id) { calls.push(["write", id]); },
    async publish(id) { calls.push(["publish", id]); }
  };
  assert.equal(await ensureOpenCodeSession(target, { selection, model, identity }), target);
  assert.deepEqual(calls, [["read", "retained-session"], ["model", "retained-session", model],
    ["agent", "retained-session", "assistant"], ["write", "retained-session"], ["publish", "retained-session"]]);
  calls.length = 0;
  await ensureOpenCodeSession(target, { selection: { ...selection, modelId: " model " }, model, identity });
  assert.deepEqual(calls, [["write", "retained-session"], ["publish", "retained-session"]]);
});

test("cold directory readiness holds retained identity publication and remains retryable", async () => {
  const entered = Promise.withResolvers();
  const ready = Promise.withResolvers();
  const calls = [];
  let first = true;
  const target = { upstreamSessionId: "retained-session", workdir: "/work/project", server: { client: {
    async prepareDirectory() {
      calls.push("prepare");
      entered.resolve();
      if (first) { first = false; await ready.promise; }
    },
    async readSession(id) { calls.push(["read", id]); return { id }; },
    async switchModel() { calls.push("model"); },
    async switchAgent() { calls.push("agent"); },
    async createSession() { assert.fail("Cold readiness must retain the saved native identity."); }
  } } };
  const options = { selection: { agentId: "assistant" }, model: { id: "model", providerID: "provider" },
    identity: { write: id => calls.push(["write", id]), publish: id => calls.push(["publish", id]) } };
  const acquiring = ensureOpenCodeSession(target, options);
  const failed = assert.rejects(acquiring, /directory preparation failed/);
  await entered.promise;
  assert.deepEqual(calls, ["prepare"]);
  assert.equal(target.upstream, undefined);
  const joined = assert.rejects(ensureOpenCodeSession(target, options), /directory preparation failed/);
  ready.reject(new Error("directory preparation failed"));
  await Promise.all([failed, joined]);
  assert.equal(target.upstreamStart, undefined);
  assert.equal(target.upstreamSessionId, "retained-session");
  assert.equal(await ensureOpenCodeSession(target, options), target);
  assert.deepEqual(calls, ["prepare", "prepare", ["read", "retained-session"], "model", "agent",
    ["write", "retained-session"], ["publish", "retained-session"]]);
});

// Retains the production controller's lazy reuse and last-consumer assertions;
// the fixture supplies startup directly instead of application session storage.
test("OpenCode shares one lazy server across open sessions and stops it after the last closes", async () => {
  const f = fixture();
  assert.equal(f.starts.length, 0);
  const first = await f.acquire("session-1");
  const second = await f.acquire("session-2");
  assert.equal(f.starts.length, 1);
  assert.equal(first.server.stop, second.server.stop);
  assert.equal(first.server.client.directory, "/work/session-1");
  assert.equal(second.server.client.directory, "/work/session-2");
  const firstClose = await f.runtime.release(first);
  assert.equal(firstClose.sharedProcessRetained, true);
  assert.equal(f.stops.length, 0);
  const lastClose = await f.runtime.release(second);
  assert.equal(lastClose.exited, true);
  assert.equal(f.stops.length, 1);
  const reopened = await f.acquire("session-1");
  assert.equal(f.starts.length, 2);
  assert.equal((await f.runtime.release(reopened)).exited, true);
  assert.equal(f.stops.length, 2);
});

test("a pending OpenCode session start retains the shared server while another session closes", async () => {
  const f = fixture();
  const first = await f.acquire("session-1");
  const pending = Promise.withResolvers();
  const reached = Promise.withResolvers();
  const starting = f.acquire("session-2", { prepare: () => { reached.resolve(); return pending.promise; } });
  await reached.promise;
  const closed = await f.runtime.release(first);
  assert.equal(closed.sharedProcessRetained, true);
  assert.equal(f.stops.length, 0);
  pending.resolve();
  const second = await starting;
  assert.equal(f.starts.length, 1);
  assert.equal((await f.runtime.release(second)).exited, true);
  assert.equal(f.stops.length, 1);
});

test("OpenCode failed acquisition cleans application state once before stopping an unused server", async () => {
  const f = fixture();
  const ready = Promise.withResolvers();
  const fail = Promise.withResolvers();
  const cleanup = [];
  const starting = f.runtime.acquire("session", async () => {
    await f.runtime.ensure(f.connection, async () => {
      const server = { client: {}, stop: async () => { cleanup.push("server"); return { exited: true }; } };
      return { connections: [f.connection], server };
    });
    ready.resolve();
    await fail.promise;
  }, async () => { cleanup.push("application"); });
  await ready.promise;
  const joined = f.runtime.acquire("session", () => assert.fail("A pending acquisition must be reused"));
  fail.reject(new Error("Preparation failed"));
  await assert.rejects(starting, /Preparation failed/);
  await assert.rejects(joined, /Preparation failed/);
  assert.deepEqual(cleanup, ["application", "server"]);
  assert.equal(f.runtime.processStarts.size, 0);
  assert.equal(f.runtime.current, null);
});

test("OpenCode observation loss leaves cleanup retryable until exit is confirmed", async () => {
  let confirmed = false;
  const f = fixture({ interrupt: () => false, stop: () => ({ exited: confirmed }) });
  const first = await f.acquire("main");
  const second = await f.acquire("colleague");
  const server = f.runtime.current;
  await assert.rejects(f.runtime.stopUnobservedSession(first, "thread"), /exit could not be verified/);
  assert.equal(f.runtime.current, server);
  assert.equal(first.abortController.signal.aborted, false);
  assert.equal(second.abortController.signal.aborted, false);
  confirmed = true;
  await f.runtime.stopUnobservedSession(first, "thread");
  assert.equal(first.abortController.signal.aborted, true);
  assert.equal(second.abortController.signal.aborted, true);
  assert.equal(f.runtime.current, null);
  assert.equal(f.stops.length, 2);
});

test("the shared OpenCode owner retains failed startup cleanup before any replacement can start", async () => {
  const f = fixture();
  let confirmed = false;
  let starts = 0;
  let cleanupCalls = 0;
  const failure = Object.assign(new Error("Startup failed"), { cleanupFailed: true,
    retryCleanup: async () => { cleanupCalls += 1; return { exited: confirmed, scopeEmpty: confirmed }; } });
  await assert.rejects(f.runtime.acquire("first", async () => {
    await f.runtime.ensure(f.connection, async () => { starts += 1; throw failure; });
  }), error => error === failure);
  assert.equal(f.runtime.current, null);
  assert.equal(f.runtime.cleanupPending, true);
  assert.equal(cleanupCalls, 0);
  await assert.rejects(f.runtime.stop(), /exit could not be verified/);
  await assert.rejects(f.runtime.ensure(f.connection, async () => { starts += 1; }), /exit could not be verified/);
  assert.equal(starts, 1);
  assert.equal(cleanupCalls, 2);
  assert.equal(f.runtime.cleanupPending, true);
  confirmed = true;
  const next = await f.acquire("next");
  assert.equal(cleanupCalls, 3);
  assert.equal(f.runtime.cleanupPending, false);
  assert.equal(f.starts.length, 1);
  await f.runtime.release(next);
});

test("OpenCode late observation loss stops the exact old server without aborting its replacement", async () => {
  const f = fixture({ interrupt: () => false });
  const first = await f.acquire("first");
  const observed = { ...first };
  const replacement = await f.acquire("second", { selected: { ...f.connection, fingerprint: "rotated-account" } });
  assert.equal(f.stops[0], f.starts[0]);
  assert.equal(first.server.stop, replacement.server.stop);
  await f.runtime.stopUnobservedSession(observed, "thread");
  assert.deepEqual(f.stops, [f.starts[0], f.starts[0]]);
  assert.equal(first.abortController.signal.aborted, false);
  assert.equal(replacement.abortController.signal.aborted, false);
  assert.equal(f.runtime.current.server, f.starts[1]);
  await f.runtime.release(first);
  await f.runtime.release(replacement);
});

test("OpenCode release waits for application removal before the final server stop", async () => {
  const f = fixture();
  const target = await f.acquire("session");
  const reached = Promise.withResolvers();
  const removed = Promise.withResolvers();
  const closing = f.runtime.release(target, { onRemoved: () => { reached.resolve(); return removed.promise; } });
  await reached.promise;
  assert.equal(f.stops.length, 0);
  removed.resolve();
  assert.equal((await closing).exited, true);
  assert.equal(f.stops.length, 1);
});

test("OpenCode bindings share atomic publication without overwriting another consumer's rows", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-opencode-bindings-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const registry = path.join(root, "private", "session-environments.json");
  const runtime = createOpenCodeSharedRuntime();
  const main = { upstreamSessionId: "main", workdir: "/work/main", env: { OWNER: "main" } };
  const colleague = { upstreamSessionId: "colleague", workdir: "/work/colleague", systemPrompt: "Current instructions" };
  await Promise.all([
    runtime.writeBindings(registry, "application", [main]),
    runtime.writeBindings(registry, "companion", [colleague])
  ]);
  assert.deepEqual(JSON.parse(await readFile(registry, "utf8")), { sessions: [main, colleague] });
  assert.equal((await stat(registry)).mode & 0o777, 0o600);
  const updated = { ...main, upstreamSessionId: "main-replacement" };
  await runtime.writeBindings(registry, "application", [updated]);
  assert.deepEqual(await readOpenCodeEnvironments(registry), [updated, colleague]);
  await runtime.writeBindings(registry, "companion", []);
  assert.deepEqual(await readOpenCodeEnvironments(registry), [updated]);
  assert.throws(() => runtime.writeBindings(path.join(root, "another.json"), "foreign", []), /one absolute private binding registry/);
  assert.deepEqual(await readOpenCodeEnvironments(""), []);
});
