import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { nativeConversationStoragePolicy } from "../src/server/conversation/nativeStorage.js";
import { createCodexAppServerProviderOwner } from "../src/server/conversation/codexProviderOwner.js";
import { createCodexConversationDriver } from "../src/server/conversation/providers/codexDriver.js";

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
function codexStorageFixture(t, { idleMs = 20 } = {}) {
  const runtimeDir = "/tmp/jskit-codex-storage-runtime";
  const runtime = { running: false, starts: 0, stops: 0 };
  const owner = createCodexAppServerProviderOwner({ transientIdleMs: idleMs, providerFactory: () => ({
    isHelperProvider: () => false,
    isAvailable: () => runtime.running,
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
