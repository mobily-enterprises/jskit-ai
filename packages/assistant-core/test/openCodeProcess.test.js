import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenCodeServerProcess } from "../src/server/conversation/openCodeProcess.js";

async function fixture(t, options = {}) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "jskit-opencode-process-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const exited = Promise.withResolvers();
  const starts = [], stops = [], requests = [];
  const execution = {
    async start(request) {
      starts.push(request);
      return { id: "owned-process", pid: 123, running: true, exited: exited.promise,
        readLogs: () => ({ stderr: "native startup evidence", stdout: "" }) };
    },
    async stop(id) {
      stops.push(id);
      if (options.stop) return options.stop();
      exited.resolve({ code: 0 });
      return { scopeEmpty: true };
    }
  };
  const config = { execution, workdir, privateRoot: path.join(workdir, "private"), port: 12345,
    env: { OPENCODE_SERVER_PASSWORD: "obsolete-password" },
    async fetchImpl(url, request) {
      requests.push({ url, request });
      assert.equal(request.headers.authorization, `Basic ${Buffer.from(`opencode:${starts[0].env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`);
      return options.respond ? options.respond(url, request) : new Response(JSON.stringify({ healthy: true, version: "1.18.31" }));
    }
  };
  return { config, starts, stops, requests, exited };
}

test("the shared OpenCode server authenticates selected accounts and drains its host before deleting private state", async t => {
  const f = await fixture(t);
  const native = await createOpenCodeServerProcess({ ...f.config, connections: [
    { providerId: "first", apiKey: "one" }, { providerId: "second", apiKey: "two" }, { providerId: "first", apiKey: "one" }
  ] });
  assert.deepEqual(native.modelProviderIds, ["first", "second"]);
  assert.deepEqual(f.requests.map(({ url }) => url.pathname), ["/global/health", "/auth/first", "/auth/second"]);
  assert.notEqual(native.environment.OPENCODE_SERVER_PASSWORD, "obsolete-password");
  assert.equal(native.executionId, "owned-process");
  assert.deepEqual(native.attachArguments({ conversationId: "ses_one", directory: f.config.workdir }),
    ["attach", "http://127.0.0.1:12345", "--dir", f.config.workdir, "--session", "ses_one", "--pure"]);
  assert.equal((await native.stop()).scopeEmpty, true);
  await native.stop();
  assert.deepEqual(f.stops, ["owned-process"]);
  await assert.rejects(access(f.config.privateRoot), { code: "ENOENT" });
});

test("version mismatch preserves startup evidence and the owned identity if cleanup is unconfirmed", async t => {
  let confirmed = false;
  let failure;
  const f = await fixture(t, { stop: () => ({ scopeEmpty: confirmed }),
    respond: () => new Response(JSON.stringify({ healthy: true, version: "unsupported" })) });
  await assert.rejects(createOpenCodeServerProcess(f.config), error => {
    assert.equal(error.code, "assistant_opencode_version_mismatch");
    assert.equal(error.executionId, "owned-process");
    assert.equal(error.cleanupFailed, true);
    assert.equal(error.stopProof.scopeEmpty, false);
    assert.equal(error.details.stderr, "native startup evidence");
    failure = error;
    return true;
  });
  await access(f.config.privateRoot);
  assert.deepEqual(f.stops, ["owned-process"]);
  confirmed = true;
  assert.equal((await failure.retryCleanup()).scopeEmpty, true);
  assert.deepEqual(f.stops, ["owned-process", "owned-process"]);
  await assert.rejects(access(f.config.privateRoot), { code: "ENOENT" });
});

test("cancelled health observation stops the server before startup can return", async t => {
  const waiting = Promise.withResolvers();
  const f = await fixture(t, { respond: (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    waiting.resolve();
  }) });
  const cancellation = new AbortController();
  const starting = createOpenCodeServerProcess({ ...f.config, signal: cancellation.signal });
  await waiting.promise;
  cancellation.abort(new Error("Start cancelled"));
  await assert.rejects(starting, /Start cancelled/u);
  assert.deepEqual(f.stops, ["owned-process"]);
  await assert.rejects(access(f.config.privateRoot), { code: "ENOENT" });
});

test("an unexpected native exit reports failure after readiness", async t => {
  const f = await fixture(t);
  const failure = Promise.withResolvers();
  const native = await createOpenCodeServerProcess({ ...f.config, onFailure: failure.resolve });
  f.exited.resolve({ code: 1 });
  assert.match((await failure.promise).message, /process exited/u);
  await native.stop();
});

test("failed host startup retains its execution identity until cleanup is proven", async t => {
  const f = await fixture(t, { stop: () => ({ scopeEmpty: false }) });
  const bindings = [];
  f.config.execution.start = async () => { throw Object.assign(new Error("Host startup failed"), {
    executionId: "partially-started", stopProof: { scopeEmpty: false }
  }); };
  await assert.rejects(createOpenCodeServerProcess({ ...f.config, onStarted: id => bindings.push(id) }), error => {
    assert.equal(error.executionId, "partially-started");
    assert.equal(error.cleanupFailed, true);
    assert.equal(error.stopProof.scopeEmpty, false);
    return true;
  });
  assert.deepEqual(bindings, ["partially-started"]);
  assert.deepEqual(f.stops, ["partially-started"]);
  await access(f.config.privateRoot);
});

test("production readiness requires boolean health and trims the native version", async t => {
  let reads = 0;
  const f = await fixture(t, { respond: () => new Response(JSON.stringify({
    healthy: ++reads === 1 ? "yes" : true, version: " 1.18.31 "
  })) });
  const native = await createOpenCodeServerProcess(f.config);
  assert.equal(reads, 2);
  assert.equal(native.health.healthy, true);
  await native.stop();
});

test("production startup timeout keeps the last health failure and confirms cleanup", async t => {
  const unavailable = new Error("native health unavailable");
  const f = await fixture(t, { respond: () => { throw unavailable; } });
  await assert.rejects(createOpenCodeServerProcess({ ...f.config, readinessTimeoutMs: 20 }), error => {
    assert.equal(error.code, "assistant_opencode_start_timeout");
    assert.equal(error.message, "OpenCode did not become ready before the startup deadline.");
    assert.equal(error.cause, unavailable);
    assert.equal(error.stopProof.exited, true);
    return true;
  });
  assert.deepEqual(f.stops, ["owned-process"]);
  await assert.rejects(access(f.config.privateRoot), { code: "ENOENT" });
});

test("native authentication does not spend the production readiness deadline", async t => {
  const cancellation = new AbortController();
  const f = await fixture(t, { respond: async (url, { signal }) => {
    if (url.pathname === "/global/health") return new Response(JSON.stringify({ healthy: true, version: "1.18.31" }));
    assert.equal(signal, cancellation.signal);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 40);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
    return new Response("{}");
  } });
  const native = await createOpenCodeServerProcess({ ...f.config, readinessTimeoutMs: 20, signal: cancellation.signal,
    connections: [{ providerId: "provider", apiKey: "key" }] });
  assert.deepEqual(native.modelProviderIds, ["provider"]);
  await native.stop();
});

test("production stop retains failure for retry and keeps the complete confirmed proof", async t => {
  let attempt = 0;
  const f = await fixture(t, { stop: () => {
    attempt++;
    if (attempt === 1) return { scopeEmpty: false };
    if (attempt === 2) throw new Error("stop temporarily unavailable");
    return { scopeEmpty: true, executionId: "owned-process", stopped: true };
  } });
  const native = await createOpenCodeServerProcess(f.config);
  assert.deepEqual(await native.stop(), { scopeEmpty: false, exited: false });
  await access(f.config.privateRoot);
  await assert.rejects(native.stop(), /stop temporarily unavailable/);
  await access(f.config.privateRoot);
  const proof = await native.stop();
  assert.deepEqual(proof, { scopeEmpty: true, executionId: "owned-process", stopped: true, exited: true });
  assert.equal(await native.stop(), proof);
  assert.equal(attempt, 3);
  await assert.rejects(access(f.config.privateRoot), { code: "ENOENT" });
});
