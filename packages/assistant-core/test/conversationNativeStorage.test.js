import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nativeConversationStoragePolicy } from "../src/server/conversation/nativeStorage.js";
import { createCodexAppServerProviderOwner } from "../src/server/conversation/codexProviderOwner.js";
import { createCodexConversationDriver } from "../src/server/conversation/providers/codexDriver.js";
import { createOpenCodeSharedRuntime, openCodeServerForDirectory } from "../src/server/conversation/openCodeRuntime.js";
import { createOpenCodeConversationDriver } from "../src/server/conversation/providers/opencodeDriver.js";

test("native storage policy distinguishes locked deletion from host writer exclusion", () => {
  assert.equal(nativeConversationStoragePolicy("codex").requiresWriterExclusion, false);
  assert.equal(nativeConversationStoragePolicy("claude").requiresWriterExclusion, true);
  assert.equal(nativeConversationStoragePolicy("claude").allowsManagedServer, false);
  assert.equal(nativeConversationStoragePolicy("opencode").requiresWriterExclusion, true);
  assert.equal(nativeConversationStoragePolicy("opencode").allowsManagedServer, true);
  for (const engine of ["api", "unknown", "toString", "__proto__", undefined]) {
    assert.throws(() => nativeConversationStoragePolicy(engine), /Unsupported/u);
  }
});

test("native writer recognition handles executables and node entry points without matching similar names", () => {
  const claude = nativeConversationStoragePolicy("claude");
  assert.ok(claude.matchesProcess({ executable: "/tools/claude", commandLine: "native\0--resume\0" }));
  assert.ok(claude.matchesProcess({ executable: "/usr/bin/node", commandLine: "node\0/tools/node_modules/@anthropic-ai/claude-code/cli.js\0" }));
  assert.equal(claude.matchesProcess({ executable: "/tools/claude-helper", commandLine: "node\0/notes/claude.txt\0" }), false);
  const opencode = nativeConversationStoragePolicy("opencode");
  assert.ok(opencode.matchesProcess({ executable: "/tools/opencode", commandLine: "opencode\0serve\0" }));
  assert.ok(opencode.matchesProcess({ executable: "/usr/bin/bun", commandLine: "bun\0/tools/opencode\0serve\0" }));
  assert.equal(opencode.matchesProcess({ executable: "/tools/opencode-helper", commandLine: "node\0/notes/opencode.txt\0" }), false);
});

async function eventually(check, message) {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// One shared native process with independent provider connections, as the
// real Codex app-server has per account and runtime scope.
function codexStorageFixture(t, { idleMs = 20, listModelsMs = 0 } = {}) {
  // Owned runtimes and sharing are process-wide, so each fixture has its own.
  const runtimeDir = `/tmp/jskit-codex-storage-runtime-${randomUUID()}`;
  const runtime = { running: false, starts: 0, stops: 0, reads: [] };
  const owner = createCodexAppServerProviderOwner({ transientIdleMs: idleMs, providerFactory: () => ({
    isHelperProvider: () => false,
    isAvailable: () => runtime.running,
    async currentRuntimeInfo() { return { runtimeDir }; },
    async listModels() {
      runtime.reads.push("catalogue");
      await new Promise(resolve => setTimeout(resolve, listModelsMs));
      return { running: runtime.running, data: [{ id: "gpt" }] };
    },
    async readGoal() { runtime.reads.push("goal"); return { goal: null }; },
    async readPlanUsage() { runtime.reads.push("usage"); return { status: "available", windows: [] }; },
    async ensureAvailable() {
      if (!runtime.running) { runtime.running = true; runtime.starts += 1; }
      return { ok: true, runtime: { runtimeDir } };
    },
    async listNativeThreadsForCwd(cwd) { return [`thread-in-${path.basename(cwd)}`]; },
    async stopRuntime() { runtime.running = false; runtime.stops += 1; return { stopped: true }; },
    close() {}
  }) });
  t.after(() => owner.beginShutdown());
  const context = sessionId => ({
    sessionId, providerKey: `provider:${sessionId}`, providerOptions: { runtimeDir },
    keyFields: key => ({ sessionId: key }), assertAdmission() {}, closing: false,
    runOwner: { runtimeLifecycle: { rememberManagedSession() {}, managedThreadId: () => "" } },
    async prepare() {
      return { parameters: { runtimeDir }, owner: { sessionKey: sessionId }, resources: null,
        controls: { available: false, subscribe: () => () => {} }, runInContext: operation => operation() };
    }
  });
  const driver = createCodexConversationDriver({ host: {} });
  const list = sessionId => driver.listConversationStorage({
    sessionId, context: {},
    binding: { engineId: "codex", modelProviderId: "openai", workdir: `/archived/${sessionId}` },
    native: { providerOwner: owner, errorPrefix: "", preparation: {
      async storage(id) { return { providerContext: context(id), toolHomeSource: "/home/person" }; }
    } }
  });
  return { owner, runtime, context, list };
}

test("a native storage listing leaves no Codex runtime or provider running", async t => {
  const { owner, runtime, list } = codexStorageFixture(t);
  assert.deepEqual((await list("archived-1")).map(row => row.conversationId), ["thread-in-archived-1"]);
  assert.equal(runtime.running, true, "the listing itself uses the shared process");
  await eventually(() => !runtime.running, "an unused storage listing kept Codex running");
  assert.equal(runtime.stops, 1);
  assert.deepEqual([...owner.providers.keys()], []);
});

test("consecutive native storage reads share one Codex process and stop it after the last", async t => {
  const { owner, runtime, list } = codexStorageFixture(t, { idleMs: 40 });
  await list("archived-1");
  await list("archived-2");
  await list("archived-1");
  assert.equal(runtime.starts, 1);
  await eventually(() => runtime.stops === 1 && owner.providers.get("provider:archived-2") === undefined,
    "the last storage read did not release Codex");
  assert.equal(runtime.running, false);
  assert.deepEqual([...owner.providers.keys()], []);
});

test("native storage reads never stop a Codex process a conversation still uses", async t => {
  const { owner, runtime, context, list } = codexStorageFixture(t);
  const conversation = await owner.ensureSession(context("open-session"));
  await list("archived-1");
  // A conversation that claims a provider a storage read created keeps it too.
  await list("claimed-session");
  await owner.ensureSession(context("claimed-session"));
  await eventually(() => owner.providers.get("provider:archived-1") === undefined, "the storage provider was not released");
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(runtime.running, true);
  assert.equal(runtime.stops, 0);
  assert.equal(owner.providers.get("provider:open-session"), conversation);
  assert.ok(owner.providers.get("provider:claimed-session"));
});

// One shared `opencode serve`, as OpenCode runs per runtime scope.
function openCodeStorageFixture({ idleMs = 20 } = {}) {
  const owner = createOpenCodeSharedRuntime({ storageIdleMs: idleMs });
  const server = { running: false, starts: 0, stops: 0 };
  const connection = { modelProviderId: "provider", canonicalUrl: "https://provider.invalid", fingerprint: "account", endpointCode: "api" };
  const create = async () => {
    server.running = true;
    server.starts += 1;
    return {
      client: {
        async health() { return { healthy: true }; },
        async listConversationsForDirectory(directory) { return [{ id: `conversation-in-${path.basename(directory)}` }]; },
        forDirectory(directory) { return { ...this, directory }; }
      },
      async stop() {
        server.running = false;
        server.stops += 1;
        return { exited: true };
      }
    };
  };
  const native = { owner, preparation: { storage: () => ({
    process: async () => ({ create, options: {}, connections: [connection] }),
    failure: error => { throw error; }
  }) } };
  const driver = createOpenCodeConversationDriver({ connections: { resolve() {} }, host: { workdir: "/tmp" } });
  const list = archived => driver.listConversationStorage({ native, context: {},
    binding: { engineId: "opencode", modelProviderId: "provider", workdir: `/work/${archived}` } });
  const conversation = key => owner.acquire(key, async () => {
    const shared = await owner.ensure(connection, async () => ({ server: await create(), connections: [connection] }));
    return { key, workdir: `/work/${key}`, abortController: new AbortController(),
      server: openCodeServerForDirectory(shared.server, `/work/${key}`) };
  });
  return { owner, server, list, conversation };
}

test("an OpenCode storage listing leaves no OpenCode server running", async () => {
  const { server, list } = openCodeStorageFixture();
  assert.deepEqual((await list("archived-1")).map(row => row.conversationId), ["conversation-in-archived-1"]);
  assert.equal(server.running, true, "the listing itself uses the shared server");
  await eventually(() => !server.running, "an unused storage listing kept opencode serve running");
  assert.equal(server.stops, 1);
});

test("consecutive OpenCode storage reads share one server and stop it after the last", async () => {
  const { server, list } = openCodeStorageFixture({ idleMs: 40 });
  await list("archived-1");
  await list("archived-2");
  assert.equal(server.starts, 1);
  await eventually(() => server.stops === 1, "the last storage read did not stop opencode serve");
  assert.equal(server.running, false);
});

test("OpenCode storage reads never stop a server a conversation still uses", async () => {
  const { owner, server, list, conversation } = openCodeStorageFixture();
  const open = await conversation("open-session");
  await list("archived-1");
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(server.running, true);
  assert.equal(server.stops, 0);
  await owner.release(open);
  assert.equal(server.running, false);
  assert.equal(server.starts, 1);
});

test("a catalogue read on a storage-started Codex process finishes before its release stops it", async t => {
  const { owner, runtime, list } = codexStorageFixture(t, { listModelsMs: 60 });
  await list("archived-1");
  // The release timer fires during this read; the shared lifecycle holds it back.
  const catalogue = await owner.readModelCatalog({
    prepareProviderOptions: async () => ({ runtimeDir: owner.ownedRuntimes.values().next().value.runtimeDir }),
    providerFactory: () => assert.fail("The running storage process should serve the catalogue.")
  });
  assert.equal(catalogue.running, true, "the release stopped Codex during the catalogue read");
  await eventually(() => !runtime.running, "the storage process was not released after the catalogue read");
  assert.equal(runtime.starts, 1);
  assert.equal(runtime.stops, 1);
});

test("goal and plan-usage reads never use a provider a storage read borrowed", async t => {
  const { owner, runtime, list } = codexStorageFixture(t, { idleMs: 200 });
  await list("archived-1");
  assert.deepEqual(await owner.readSessionGoal("archived-1", "thread-1"), { status: "unavailable", goal: null });
  assert.deepEqual(await owner.readPlanUsage("archived-1"), { status: "unavailable", windows: [] });
  assert.deepEqual(runtime.reads, []);
});

test("real use that reaches a storage-created provider directly keeps it", async t => {
  const { owner, runtime, context, list } = codexStorageFixture(t);
  for (const use of [
    // Helper account checks read the provider without ensureSession.
    id => owner.withLifecycle(() => owner.providerForSession(context(id))),
    id => owner.acquireRuntime({ providerKey: `provider:${id}`, provider: owner.providers.get(`provider:${id}`),
      providerOptions: context(id).providerOptions, operation: async () => {} }),
    id => owner.createProvider({ providerKey: `provider:${id}`, providerOptions: context(id).providerOptions })
  ]) {
    const id = `archived-${randomUUID()}`;
    await list(id);
    const provider = owner.providers.get(`provider:${id}`);
    await use(id);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(owner.providers.get(`provider:${id}`), provider);
  }
  assert.equal(runtime.running, true);
  assert.equal(runtime.stops, 0);
});

test("a storage read on a managed main thread's key leaves it to that thread", async t => {
  const { owner, runtime, context, list } = codexStorageFixture(t);
  const managed = context("archived-1");
  managed.runOwner.runtimeLifecycle.managedThreadId = () => "main-thread";
  await owner.withTransientSession(managed, async () => {});
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(owner.providers.get("provider:archived-1"));
  assert.equal(runtime.stops, 0);
  await list("archived-2");
  await eventually(() => owner.providers.get("provider:archived-2") === undefined, "the borrowed provider was not released");
  assert.equal(runtime.running, true, "a managed main thread still shares the process");
});

test("a conversation that starts after an OpenCode storage read keeps the server", async () => {
  const { owner, server, list, conversation } = openCodeStorageFixture({ idleMs: 40 });
  await list("archived-1");
  const open = await conversation("open-session");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(server.running, true, "the storage release stopped a server a conversation uses");
  assert.equal(server.starts, 1);
  await owner.release(open);
  assert.equal(server.running, false);
});
