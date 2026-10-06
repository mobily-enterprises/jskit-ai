import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCodexModelCatalog } from "../src/server/conversation/codexConfiguration.js";
import { createCodexAppServerModelCatalogCache, codexAppServerProviderConnectionGeneration } from "../src/server/conversation/codexProvider.js";
import { createCodexAppServerProviderOwner } from "../src/server/conversation/codexProviderOwner.js";

async function fixture(t, source) {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "codex-catalog-unit-"));
  t.after(() => rm(runtimeDir, { recursive: true, force: true }));
  const command = path.join(runtimeDir, "codex");
  await writeFile(command, `#!${process.execPath}\n${source}\n`);
  await chmod(command, 0o700);
  return { runtimeDir, command };
}

for (const [name, source] of [
  ["CLI failure", 'process.stderr.write("secret-provider-key"); process.exit(1);'],
  ["invalid JSON", 'process.stdout.write("secret-provider-key");'],
  ["oversized output", 'process.stdout.write("x".repeat(17 * 1024 * 1024));'],
  ["empty catalogue", 'process.stdout.write(JSON.stringify({ models: [] }));'],
  ["missing slug", 'process.stdout.write(JSON.stringify({ models: [{}] }));'],
  ["duplicate slugs", 'process.stdout.write(JSON.stringify({ models: [{slug:"gpt"}, {slug:"gpt"}] }));']
]) test(`${name} blocks startup without overwriting the last catalogue or exposing CLI output`, async (t) => {
  const f = await fixture(t, source);
  const target = path.join(f.runtimeDir, "models.json");
  await writeFile(target, "previous catalogue");
  await assert.rejects(prepareCodexModelCatalog(f), (error) => {
    assert.match(error.message, /could not load its model catalogue/);
    assert.doesNotMatch(String(error), /secret-provider-key/);
    return true;
  });
  assert.equal(await readFile(target, "utf8"), "previous catalogue");
  await assert.rejects(stat(`${target}.tmp`), { code: "ENOENT" });
});

test("stopping startup cancels the exporter and publishes no catalogue", async (t) => {
  const f = await fixture(t, "setInterval(() => {}, 1000);");
  const controller = new AbortController();
  const pending = prepareCodexModelCatalog({ ...f, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /could not load its model catalogue/);
  await assert.rejects(stat(path.join(f.runtimeDir, "models.json")), { code: "ENOENT" });
});

function liveCatalogFixture() {
  const calls = [];
  const captures = { connectionGeneration: 1, failModelLists: 0 };
  const provider = {
    currentConnectionGeneration() { return captures.connectionGeneration; },
    async listModels(params, options) {
      calls.push(["models", params]);
      captures.signal = options.signal;
      if (captures.failModelLists > 0) {
        captures.failModelLists -= 1;
        throw Object.assign(new Error("model catalog temporarily unavailable"), { code: "rate_limited" });
      }
      return { data: [{ model: "gpt-5.6-luna", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }] };
    }
  };
  const readCatalog = createCodexAppServerModelCatalogCache();
  return { calls, captures, provider, readCatalog };
}

// These two cases carry the original public lifecycle assertions. Their public
// counterparts retain host acquisition, restoration and application integration.
test("helper model discovery uses one live provider catalog per connection generation", async () => {
  const { calls, provider, readCatalog } = liveCatalogFixture();
  const first = await readCatalog(provider);
  const second = await readCatalog(provider);

  assert.equal(first, second);
  assert.deepEqual(first, {
    data: [{
      hidden: false,
      model: "gpt-5.6-luna",
      supportedReasoningEfforts: [{
        reasoningEffort: "low"
      }]
    }]
  });
  assert.deepEqual(calls.filter(([operation]) => operation === "models"), [[
    "models",
    {
      includeHidden: false,
      limit: 100
    }
  ]]);
});

test("helper model discovery does not cache failures and invalidates on reconnect", async () => {
  const { calls, captures, provider, readCatalog } = liveCatalogFixture();
  captures.failModelLists = 1;
  await assert.rejects(
    readCatalog(provider),
    (error) => error.code === "rate_limited"
  );
  await readCatalog(provider);
  captures.connectionGeneration = 2;
  await readCatalog(provider);

  assert.equal(calls.filter(([operation]) => operation === "models").length, 3);
});

test("live model snapshots freeze normalized native facts and expire after the original TTL", async t => {
  const { provider, readCatalog } = liveCatalogFixture();
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  provider.listModels = async () => ({ data: [{ hidden: true, model: " model ",
    supportedReasoningEfforts: [{ reasoningEffort: " high " }, { reasoningEffort: false }] }] });
  const first = await readCatalog(provider);
  assert.deepEqual(first, { data: [{ hidden: true, model: "model",
    supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "" }] }] });
  for (const value of [first, first.data, first.data[0], first.data[0].supportedReasoningEfforts,
    ...first.data[0].supportedReasoningEfforts]) assert.equal(Object.isFrozen(value), true);
  now += 29_999;
  assert.equal(await readCatalog(provider), first);
  now += 1;
  assert.notEqual(await readCatalog(provider), first);
});

test("concurrent live catalog readers share the original pending request and its signal", async () => {
  const { provider, readCatalog } = liveCatalogFixture();
  const response = Promise.withResolvers();
  const firstSignal = new AbortController().signal;
  const signals = [];
  provider.listModels = (_params, { signal }) => { signals.push(signal); return response.promise; };
  const first = readCatalog(provider, { signal: firstSignal });
  const second = readCatalog(provider, { signal: new AbortController().signal });
  response.resolve({ data: [] });
  assert.equal(await first, await second);
  assert.deepEqual(signals, [firstSignal]);
});

test("a stale pending result cannot erase a newer generation's pending catalog", async () => {
  const { captures, provider, readCatalog } = liveCatalogFixture();
  const responses = [];
  provider.listModels = () => { const response = Promise.withResolvers(); responses.push(response); return response.promise; };
  const first = readCatalog(provider);
  const rejected = assert.rejects(first, {
    code: "codex_model_catalog_stale",
    message: "Codex reconnected while resolving the helper model catalog."
  });
  captures.connectionGeneration = 2;
  const second = readCatalog(provider);
  responses[0].resolve({ data: [] });
  await rejected;
  const third = readCatalog(provider);
  assert.equal(responses.length, 2);
  responses[1].resolve({ data: [] });
  assert.equal(await second, await third);
  assert.equal(await readCatalog(provider), await second);
});

test("invalid and unavailable native catalogs retain the host's error prefix without caching failure", async () => {
  const readCatalog = createCodexAppServerModelCatalogCache({ errorPrefix: "vibe64_" });
  await assert.rejects(readCatalog({}), { code: "vibe64_codex_model_catalog_unavailable" });
  const { provider } = liveCatalogFixture();
  const originalList = provider.listModels;
  provider.listModels = async () => ({ malformed: [] });
  await assert.rejects(readCatalog(provider), {
    code: "vibe64_codex_model_catalog_invalid",
    message: "Codex did not return a usable live model catalog."
  });
  provider.listModels = originalList;
  assert.equal((await readCatalog(provider)).data[0].model, "gpt-5.6-luna");
});

test("native connection generation keeps the production method priority and falsy normalization", () => {
  assert.equal(codexAppServerProviderConnectionGeneration({ currentConnectionGeneration: () => " first ", connectionGeneration: "second" }), "first");
  assert.equal(codexAppServerProviderConnectionGeneration({ connectionGeneration: () => 2 }), "2");
  assert.equal(codexAppServerProviderConnectionGeneration({ connectionGeneration: " direct " }), "direct");
  for (const value of [0, false, null, undefined]) {
    assert.equal(codexAppServerProviderConnectionGeneration({ connectionGeneration: value }), "");
  }
});

function chatCatalogFixture(t, { resources = null } = {}) {
  const runtimeDir = path.join(os.tmpdir(), `jskit-codex-chat-catalog-${randomUUID()}`);
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: runtimeDir });
  const providerOptions = { runtimeDir };
  const captures = {
    providerOptions: [], stopRuntimes: 0, closes: 0, failModelLists: 0,
    runtimeReused: false, stopRuntimeResult: { stopped: true },
    runtimeInfo: { runtimeDir, authStateSignature: "v1:original", accountIdentitySignature: `sha256:${"a".repeat(64)}` },
    operations: [], prepareCount: 0
  };
  const providerFactory = options => {
    captures.providerOptions.push(options);
    return {
      async currentRuntimeInfo() { return { ...captures.runtimeInfo }; },
      async ensureRuntime() {
        captures.operations.push("ensure");
        captures.onEnsureRuntime?.();
        await captures.ensureRuntimeWait;
        return { runtimeDir, reused: captures.runtimeReused };
      },
      async listModels(_params, { signal } = {}) {
        captures.operations.push("models");
        signal?.throwIfAborted();
        if (captures.failModelLists > 0) {
          captures.failModelLists -= 1;
          throw new Error("model catalog temporarily unavailable");
        }
        return { data: [{ model: "gpt-5.6-luna" }] };
      },
      async stopRuntime() {
        captures.operations.push("stop");
        captures.stopRuntimes += 1;
        return captures.stopRuntimeResult;
      },
      close() { captures.operations.push("close"); captures.closes += 1; }
    };
  };
  const readCatalog = (options = {}) => owner.readModelCatalog({
    async prepareProviderOptions() { captures.prepareCount += 1; return providerOptions; },
    providerFactory,
    resources,
    ...options
  });
  async function retainProvider() {
    const provider = owner.createProvider({ providerKey: "resident", providerOptions,
      create: () => providerFactory(providerOptions) });
    await owner.acquireRuntime({ provider, providerKey: "resident", providerOptions,
      operation: () => provider.ensureRuntime() });
  }
  t.after(async () => {
    captures.stopRuntimeResult = { stopped: true };
    await owner.invalidateRuntimes({ includeOwned: true, stopOwnedRuntimes: true });
    owner.beginShutdown();
  });
  return { owner, captures, readCatalog, retainProvider };
}

// Carried from the original public chat catalog tests. Only the application
// controller fixture becomes the existing native provider owner.
test("chat model discovery reuses a resident provider without closing it", async t => {
  const { captures, readCatalog, retainProvider } = chatCatalogFixture(t);
  await retainProvider();
  const providerCount = captures.providerOptions.length;
  const catalog = await readCatalog();
  assert.equal(catalog.data[0].model, "gpt-5.6-luna");
  assert.equal(captures.providerOptions.length, providerCount);
  assert.equal(captures.stopRuntimes, 0);
  assert.equal(captures.closes, 0);
});

test("chat model discovery stops its temporary service on success and failure", async t => {
  const { captures, owner, readCatalog } = chatCatalogFixture(t);
  assert.equal((await readCatalog()).data[0].model, "gpt-5.6-luna");
  assert.equal(captures.stopRuntimes, 1);
  await owner.invalidateRuntimes({ includeOwned: true, reason: "logout", requireVerifiedExit: true, stopOwnedRuntimes: true });
  captures.failModelLists = 1;
  await assert.rejects(readCatalog(), /model catalog temporarily unavailable/u);
  assert.equal(captures.stopRuntimes, 2);
  captures.stopRuntimeResult = { stopped: false };
  await assert.rejects(readCatalog(), /process exit could not be verified/u);
  captures.stopRuntimeResult = { stopped: true };
});

test("chat model catalog expires and never caches unverified runtime cleanup", async t => {
  const { captures, owner, readCatalog } = chatCatalogFixture(t);
  const now = Date.now();
  await readCatalog();
  t.mock.method(Date, "now", () => now + 31_000);
  captures.stopRuntimeResult = { stopped: false };
  await assert.rejects(readCatalog(), /process exit could not be verified/u);
  captures.stopRuntimeResult = { stopped: true };
  await owner.invalidateRuntimes({ includeOwned: true, reason: "auth-session-status", requireVerifiedExit: true, stopOwnedRuntimes: true });
  const stopped = captures.stopRuntimes;
  await readCatalog();
  assert.equal(captures.stopRuntimes, stopped + 1);
});

test("chat model discovery leaves an already running shared process alive", async t => {
  const { captures, readCatalog } = chatCatalogFixture(t);
  captures.runtimeReused = true;
  await readCatalog();
  assert.equal(captures.stopRuntimes, 0);
  assert.equal(captures.closes, 1);
});

test("repeated chat model discovery uses one short-lived runtime per auth generation", async t => {
  const { captures, readCatalog } = chatCatalogFixture(t);
  const catalogs = await Promise.all([readCatalog(), readCatalog()]);
  assert.deepEqual(catalogs[0], catalogs[1]);
  assert.equal(captures.stopRuntimes, 1);
  await readCatalog();
  assert.equal(captures.stopRuntimes, 1);

  captures.runtimeInfo.authStateSignature = "v1:changed-login";
  captures.runtimeInfo.accountIdentitySignature = `sha256:${"d".repeat(64)}`;
  await readCatalog();
  assert.equal(captures.stopRuntimes, 2, "a new login must read its own live catalog");
});

test("catalog cleanup retains host retirement and reconciliation before observer close", async t => {
  let captures;
  const f = chatCatalogFixture(t, { resources: {
    async retire() { captures.operations.push("retire"); },
    async reconcileRetirement({ retired, stopped }) {
      captures.operations.push("reconcile");
      assert.equal(retired.status, "fulfilled");
      assert.equal(stopped.status, "fulfilled");
      return { retired, pendingThreadCleanup: [] };
    }
  } });
  captures = f.captures;
  await f.readCatalog();
  assert.deepEqual(captures.operations, ["ensure", "models", "retire", "stop", "reconcile", "close"]);
});

test("failed resource retirement prevents catalog caching after native stop and observer close", async t => {
  let retirementFails = true;
  const { captures, readCatalog } = chatCatalogFixture(t, { resources: {
    async retire() { if (retirementFails) throw new Error("Helper retirement failed."); }
  } });
  await assert.rejects(readCatalog(), /Helper retirement failed/u);
  assert.equal(captures.stopRuntimes, 1);
  assert.equal(captures.closes, 1);
  retirementFails = false;
  await readCatalog();
  assert.equal(captures.stopRuntimes, 2);
});

test("catalog caller cancellation while queued runs before host preparation or provider creation", async t => {
  const { owner, captures, readCatalog } = chatCatalogFixture(t);
  const queued = Promise.withResolvers();
  const queue = owner.withLifecycle(() => queued.promise);
  const controller = new AbortController();
  const pending = readCatalog({ signal: controller.signal });
  const cancellation = new Error("caller cancelled model discovery");
  controller.abort(cancellation);
  const rejected = assert.rejects(pending, error => error === cancellation);
  queued.resolve();
  await queue;
  await rejected;
  assert.equal(captures.prepareCount, 0);
  assert.equal(captures.providerOptions.length, 0);
});

test("catalog cancellation during shared acquisition still awaits startup and cleans the owned runtime", async t => {
  const { captures, readCatalog } = chatCatalogFixture(t);
  const started = Promise.withResolvers();
  const acquired = Promise.withResolvers();
  captures.onEnsureRuntime = started.resolve;
  captures.ensureRuntimeWait = acquired.promise;
  const controller = new AbortController();
  const pending = readCatalog({ signal: controller.signal });
  await started.promise;
  const cancellation = new Error("caller cancelled model discovery");
  controller.abort(cancellation);
  const rejected = assert.rejects(pending, error => error === cancellation);
  assert.equal(captures.stopRuntimes, 0);
  acquired.resolve();
  await rejected;
  assert.equal(captures.stopRuntimes, 1);
  assert.equal(captures.closes, 1);
});
