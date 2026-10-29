import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexAppServerAgentProvider, ensureCodexAppServerThread } from "../src/server/conversation/codexProvider.js";
import { writeCodexAppServerMetadata } from "../src/server/conversation/codexProcess.js";
import { createCodexAppServerProviderOwner, codexAppServerOwnedRuntimeKey, releaseSupersededCodexRuntime } from "../src/server/conversation/codexProviderOwner.js";
import { createCodexProviderSelection } from "../src/server/conversation/codexProviderSelection.js";
import { createCodexRuntimeLifecycle } from "../src/server/conversation/codexRuntimeLifecycle.js";

// A native runtime whose loaded threads report the given status. Codex reads
// its credentials once, so the account change must leave a running turn alone.
function nativeRuntime({ threads, goals = {} }) {
  const requests = [];
  const provider = {
    stale: false,
    stopped: 0,
    closed: 0,
    client: {
      isOpen: () => true,
      async request(method, params) {
        requests.push(method === "thread/goal/set" ? `${method}:${params.status}` : method);
        if (method === "thread/loaded/list") return { data: Object.keys(threads) };
        if (method === "thread/read") return { thread: { id: params.threadId, status: { type: threads[params.threadId] } } };
        if (method === "thread/goal/get") return { goal: goals[params.threadId] || null };
        if (method === "thread/goal/set") {
          goals[params.threadId] = { ...goals[params.threadId], status: params.status };
          return { goal: goals[params.threadId] };
        }
        throw new Error(`Unexpected ${method}`);
      }
    },
    markStale() { this.stale = true; },
    stopOptions: [],
    async stopRuntime(options) { this.stopped += 1; this.stopOptions.push(options); return { stopped: true, processExitVerified: true }; },
    close() { this.closed += 1; }
  };
  return { provider, requests, threads, goals };
}

function ownerWith(t, runtimes, options = {}) {
  const root = path.join(os.tmpdir(), `jskit-codex-account-change-${randomUUID()}`);
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: root, ...options });
  const keys = {};
  for (const [name, runtime] of Object.entries(runtimes)) {
    const providerOptions = { runtimeDir: path.join(root, name) };
    owner.createProvider({ providerKey: name, providerOptions, preserveProcessExitProof: true, create: () => runtime.provider });
    owner.rememberOwnedRuntime({ provider: runtime.provider, providerKey: name, providerOptions });
    keys[name] = codexAppServerOwnedRuntimeKey(name, providerOptions);
  }
  t.after(() => owner.beginShutdown());
  return { owner, keys, root };
}

test("an account change stops an idle Codex runtime at once and leaves a running turn on its runtime", async t => {
  const idle = nativeRuntime({ threads: { "idle-thread": "idle" } });
  const busy = nativeRuntime({ threads: { "busy-thread": "active" }, goals: { "busy-thread": { status: "active" } } });
  const { owner, keys } = ownerWith(t, { idle, busy });

  const result = await owner.invalidateRuntimes({
    deferBusy: true, includeOwned: true, requireVerifiedExit: true, stopOwnedRuntimes: true
  });

  assert.equal(result.ok, true);
  assert.equal(idle.provider.stopped, 1, "An idle runtime stops at once");
  assert.equal(busy.provider.stopped, 0, "A running turn is never stopped by an account change");
  assert.equal(busy.provider.stale, true);
  assert.deepEqual(result.deferred.map(({ runtimeKey, threadIds, pausedGoals }) => ({ runtimeKey, threadIds, pausedGoals })),
    [{ runtimeKey: keys.busy, threadIds: ["busy-thread"], pausedGoals: ["busy-thread"] }]);
  assert.ok(busy.requests.includes("thread/goal/set:paused"), "An active goal is paused so the old runtime starts no further turn");
  assert.equal(owner.providers.get("busy"), busy.provider);

  assert.equal((await owner.retireStaleRuntime(keys.busy)).busy, true, "It keeps running while its turn runs");
  assert.equal(busy.provider.stopped, 0);

  busy.threads["busy-thread"] = "idle";
  const retired = await owner.retireStaleRuntime(keys.busy);
  assert.equal(retired.stopped, true);
  assert.equal(busy.provider.stopped, 1, "The stale runtime stops through the verified stop once idle");
  assert.equal(owner.providers.get("busy"), undefined);
  assert.equal(await owner.retireStaleRuntime(keys.busy), null);
});

test("a session's next Codex runtime starts only after its finished stale runtime stopped", async t => {
  const old = nativeRuntime({ threads: { "thread-1": "active" } });
  const current = { client: null, close() {} };
  const { owner, root } = ownerWith(t, { old }, { providerFactory: () => current });
  await owner.invalidateRuntimes({ deferBusy: true, includeOwned: true, requireVerifiedExit: true, stopOwnedRuntimes: true });
  assert.equal(old.provider.stale, true);
  old.threads["thread-1"] = "idle";

  const provider = await owner.providerForSession({
    providerKey: "current",
    providerOptions: { runtimeDir: path.join(root, "current") },
    assertAdmission() {},
    keyFields: () => ({ sessionId: "s1", executionMode: "", executionRoot: "/work", runtimeInstanceId: "", workdir: "/work" }),
    prepare: async () => ({ parameters: {}, runInContext: operation => operation(), controls: { available: false, subscribe: () => () => {} } })
  });

  assert.equal(provider, current);
  assert.equal(old.provider.stopped, 1, "The previous account's runtime stops before the thread loads in the new one");
  assert.equal(owner.providers.get("old"), undefined);
});

test("a stale Codex runtime is retired after its turn completes and its paused goal continues", async () => {
  const subscribers = new Set();
  const provider = { subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); } };
  const stale = { runtimeKey: "runtime:/old", providerKeys: ["old-key"], threadIds: ["thread-1"], pausedGoals: ["thread-1"] };
  const calls = [];
  let busy = true;
  const notificationTask = Promise.withResolvers();
  const lifecycle = createCodexRuntimeLifecycle({
    pendingWork: { notificationTasks: new Map([["turn", notificationTask.promise]]), resultFinalizations: new Map() },
    observer: { eventSubscriptions: new Map() },
    providerSessions: {
      managed: new Map([["old-key", { sessionId: "session-1", threadId: "thread-1", projectContext: "project-a" }]]),
      owner: {
        providers: new Map([["old-key", provider]]),
        async invalidateRuntimes(input) {
          calls.push(`invalidate:${input.deferBusy}`);
          return { deferred: [stale], failed: [], providerCount: 1, results: [], stopped: 0 };
        },
        async retireStaleRuntime(runtimeKey) {
          calls.push(`retire:${runtimeKey}:${busy ? "busy" : "idle"}`);
          return busy ? { ...stale, busy: true } : { ...stale, stopped: true };
        }
      }
    },
    helperLifecycle: {},
    captureContext: () => null,
    runInContext: (context, operation) => { calls.push(`context:${context}`); return operation(); },
    continueGoalAfterAccountChange: async (sessionId, { threadId }) => calls.push(`continue:${sessionId}:${threadId}`),
    debugLog() {},
    debugError: error => error
  });

  await lifecycle.invalidateRuntimes({ includeOwned: true, reason: "codex-connected" }, { enabled: true });
  assert.deepEqual(calls, ["invalidate:true"], "The account change returns without waiting for the running turn");

  busy = false;
  notificationTask.resolve();
  for (const callback of subscribers) callback({ method: "turn/completed", params: { threadId: "thread-1" } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls.slice(-3), ["retire:runtime:/old:idle", "context:project-a", "continue:session-1:thread-1"]);
  assert.equal(subscribers.size, 0, "A retired runtime leaves no observer behind");
});

test("a stale Codex provider keeps its runtime and the current account through an auth generation change", async t => {
  const stops = [];
  const marked = [];
  const provider = new CodexAppServerAgentProvider({ runtimeDir: "/tmp/old" }, {
    credentials: {
      async assertCurrent() { throw Object.assign(new Error("Codex authentication changed."), { code: "auth_generation_changed" }); },
      async markInvalid(input) { marked.push(input); },
      reconnectError: () => new Error("reconnect")
    },
    runtime: {
      async ensure() { throw new Error("A stale provider must not restart its runtime"); },
      async stop() { stops.push("stop"); return { processExitVerified: true }; }
    },
    parameters: {}
  });
  t.after(() => provider.close());
  provider.runtime = { runtimeDir: "/tmp/old", authStateSignature: "v1:old" };
  let rejected = false;
  provider.client = { isOpen: () => true, close() {}, async request() {
    if (rejected) throw new Error("unexpected status 401 Unauthorized: Incorrect API key provided");
    return { turn: { id: "turn-1" } };
  } };
  provider.markStale();

  assert.equal((await provider.steerTurn("thread-1", "turn-1", "more")).id, "turn-1");
  assert.deepEqual(stops, [], "A steer on the running turn keeps its runtime after the account changed");
  rejected = true;
  await assert.rejects(provider.steerTurn("thread-1", "turn-1", "more"), /401/u);
  assert.deepEqual(stops, [], "The running turn's runtime is not stopped");
  assert.deepEqual(marked, [], "The previous account's rejection never marks the current account");

  provider.client = null;
  await assert.rejects(provider.ensureAvailable(), error => error.code === "codex_account_changed");
  assert.deepEqual(stops, []);
});

test("a stale Codex provider serves its running turn and not the session's next message", async () => {
  const stale = { stale: true, isAvailable: () => true };
  const ensured = [];
  let active = true;
  const selection = createCodexProviderSelection({
    providerSessions: {
      managed: new Map([["old-key", { sessionId: "s1", threadId: "thread-1", workdir: "/work", providerOptions: { old: true } }]]),
      keyFields: () => ({ sessionId: "s1", executionRoot: "/work", workdir: "/work" }),
      owner: {
        providers: new Map([["old-key", stale]]),
        async ensureSession(connection) { ensured.push(connection.providerOptions); return stale; }
      },
      context: (sessionId, providerOptions) => ({ sessionId, providerOptions, providerKey: "old-key" })
    },
    turnState: () => ({ active, threadId: "thread-1" }),
    helperLifecycle: null,
    helperOwnershipError: null,
    modelCatalogCacheMs: 1,
    errorPrefix: ""
  });
  const session = { sessionId: "s1" };

  assert.equal((await selection.ensureCodexAppServerProviderForActiveTurn(session, { workdir: "/work" }))?.provider, stale);
  assert.equal(selection.managedProviderKeyForThread("s1", "/work", "thread-1", { turnActive: true }), "old-key");
  active = false;
  const context = selection.codexAppServerMessageContext("s1", {
    managedIdentity: () => ({ workdir: "/work" }),
    providerOptions: async () => ({ current: true })
  });
  assert.equal((await context.acquireProvider(session)).reused, false, "A new message goes to the current account's provider");
  assert.deepEqual(ensured.at(-1), { current: true });
  assert.equal(selection.managedProviderKeyForThread("s1", "/work", "thread-1"), null);
});

async function runtimeDirectory(root, name, processState) {
  const runtimeDir = path.join(root, `codex-app-server-${name}`);
  await mkdir(runtimeDir, { recursive: true });
  await writeCodexAppServerMetadata(runtimeDir, {
    runtimeDir, processState, pid: 4242,
    ...(processState === "stopped" ? { processExitVerifiedAt: new Date().toISOString() } : {})
  });
  return runtimeDir;
}
const exists = target => stat(target).then(() => true, () => false);

test("recording a session's runtime for a new sign-in removes the previous sign-in's stopped runtime directory", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-codex-superseded-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stopped = await runtimeDirectory(root, "stopped", "stopped");
  const running = await runtimeDirectory(root, "running", "running");
  const bind = superseded => ensureCodexAppServerThread({
    observeThread: async () => {},
    provider: { ensureRuntime: async () => ({ runtimeDir: path.join(root, "codex-app-server-current") }),
      startThread: async () => ({ id: "thread-1" }) },
    settings: async () => ({ threadSettings: {}, threadStartSettings: {} }),
    identity: { read: () => "", write: async () => ({ supersededRuntimeDir: superseded }) },
    workdir: "/work"
  });

  await bind(running);
  assert.equal(await exists(running), true, "A runtime that has not verifiably stopped keeps its directory");
  await bind(stopped);
  assert.equal(await exists(stopped), false, "The previous sign-in's stopped runtime directory goes");
});

test("a stale Codex runtime its session no longer records keeps no exit proof when it stops", async t => {
  const busy = nativeRuntime({ threads: { "thread-1": "active" } });
  const { owner, keys, root } = ownerWith(t, { busy });
  await owner.invalidateRuntimes({ deferBusy: true, includeOwned: true, requireVerifiedExit: true, stopOwnedRuntimes: true });

  assert.deepEqual(await releaseSupersededCodexRuntime(path.join(root, "busy")), { deferred: true, removed: false });
  busy.threads["thread-1"] = "idle";
  assert.equal((await owner.retireStaleRuntime(keys.busy)).stopped, true);
  assert.deepEqual(busy.provider.stopOptions, [{ preserveProcessExitProof: false }],
    "Its verified stop removes the directory instead of keeping the proof");
});
