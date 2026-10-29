import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path, { join } from "node:path";
import { test } from "node:test";
import { createClaudeAccountQueries, claudePlanUsage, claudeCodeArguments, claudeModelConfiguration, createClaudeCodeProcess, readClaudeCodeAuthStatus, stopClaudeCodeProcess } from "../src/server/conversation/claudeProcess.js";
import { createLocalConversationExecution } from "../src/server/conversation/localExecution.js";

test("native command construction preserves tool-free constraints without granting permissions by default", () => {
  const args = claudeCodeArguments({ sessionId: "session", resume: true, model: "sonnet", effort: "high", toolFree: true });
  assert.equal(args[args.indexOf("--resume") + 1], "session");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--thinking-display") + 1], "summarized");
  assert.equal(args.includes("bypassPermissions"), false);
  assert.equal(claudeCodeArguments().includes("--permission-mode"), false);
  assert.equal(claudeCodeArguments({ terminal: true }).includes("--print"), false);
  const tools = claudeCodeArguments({ toolFree: true, applicationTools: true });
  assert.equal(tools[tools.indexOf("--tools") + 1], "");
  assert.equal(tools[tools.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(tools[tools.indexOf("--allowedTools") + 1], "mcp__application__*");
  assert.equal(tools.includes("--safe-mode"), true);
  assert.equal(tools.includes("--restricted"), true);
  assert.deepEqual(JSON.parse(tools[tools.indexOf("--mcp-config") + 1]), { mcpServers: { application: { type: "sdk", name: "application" } } });
  const coding = claudeCodeArguments({ isolated: true, applicationTools: true, permissionMode: "bypassPermissions" });
  assert.equal(coding.includes("--restricted"), false);
  assert.equal(coding[coding.indexOf("--permission-mode") + 1], "bypassPermissions");
  assert.match(coding[coding.indexOf("--tools") + 1], /Bash,Read,Edit,Write/);
  assert.equal(coding.includes("--safe-mode"), true);
  assert.deepEqual(JSON.parse(coding[coding.indexOf("--mcp-config") + 1]), { mcpServers: { application: { type: "sdk", name: "application" } } });
});

async function fixture(t, body) {
  const directory = await mkdtemp(join(tmpdir(), "jskit-claude-process-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = join(directory, "claude-fixture.mjs");
  await writeFile(command, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return { command, workdir: directory };
}

test("standalone Claude startup uses the supplied execution host and carries its native protocol", { skip: process.platform === "win32" }, async (t) => {
  const setup = await fixture(t, `
    import { createInterface } from "node:readline";
    createInterface({ input: process.stdin }).on("line", line => {
      const frame = JSON.parse(line);
      process.stdout.write(JSON.stringify(frame.type === "control_request"
        ? { type: "control_response", response: { subtype: "success", request_id: frame.request_id,
            response: { models: [{ value: "fixture" }], parentContext: process.env.CLAUDECODE || "",
              automaticUpdates: process.env.DISABLE_AUTOUPDATER } } }
        : frame) + "\\n");
    });
  `);
  const observed = Promise.withResolvers();
  const native = await createClaudeCodeProcess({ ...setup, env: { ...process.env, CLAUDECODE: "parent-context" },
    onEvent: (frame) => observed.resolve(frame) });
  t.after(() => native.stop());
  assert.equal(native.initialization.models[0].value, "fixture");
  assert.equal(native.initialization.parentContext, "");
  assert.equal(native.initialization.automaticUpdates, "1");
  await native.client.send("Unicode 🌏", { messageId: "request", sessionId: "conversation" });
  const event = await observed.promise;
  assert.equal(event.message.content, "Unicode 🌏");
  assert.equal(event.uuid, "request");
  assert.equal(event.session_id, "conversation");
  assert.deepEqual(await native.stop(), { scopeEmpty: true, exited: true });
  assert.deepEqual(await native.stop(), { scopeEmpty: true, exited: true });
});

test("failed native initialization stops its owned process and reports the protocol failure", { skip: process.platform === "win32" }, async (t) => {
  const setup = await fixture(t, 'process.stdin.once("data", () => process.stdout.write("invalid frame\\n"));');
  await assert.rejects(createClaudeCodeProcess(setup), /invalid UTF-8 or JSON/);
});

test("Claude stop uses the retained process before recovery and accepts the original host exit proofs", async () => {
  const recovered = [];
  const stopExecution = async (...args) => { recovered.push(args); return { scopeEmpty: true }; };
  assert.deepEqual(await stopClaudeCodeProcess({ process: { stop: async () => ({ exited: true }) },
    executionId: "retained", stopExecution }), { exited: true });
  assert.deepEqual(recovered, []);
  assert.deepEqual(await stopClaudeCodeProcess({ executionId: "recovered", stopExecution }),
    { scopeEmpty: true, exited: true });
  assert.deepEqual(recovered, [["recovered", { allowMissingRecordScopeRecovery: true, reason: "claude-code-stop" }]]);
});

test("Claude stop keeps unconfirmed cleanup retryable and preserves host failures", async () => {
  let stopped = false;
  const input = { executionId: "recovered", stopExecution: async () => ({ scopeEmpty: stopped }) };
  await assert.rejects(stopClaudeCodeProcess(input), {
    code: "claude_stop_unconfirmed", stopProof: { scopeEmpty: false }
  });
  stopped = true;
  assert.deepEqual(await stopClaudeCodeProcess(input), { scopeEmpty: true, exited: true });
  const failure = new Error("Execution host unavailable");
  await assert.rejects(stopClaudeCodeProcess({ ...input, stopExecution: async () => { throw failure; } }), failure);
});

test("Claude model configuration maps background calls and resets external settings", () => {
  for (const [provider, model, window] of [["deepseek", "deepseek-flash", "786432"], ["zai-coding-plan", "glm-5.3", "1000000"]]) {
    const configured = claudeModelConfiguration({ providerId: provider, model: model }, { apiKey: "test-secret", baseUrl: "https://provider.test" });
    assert.equal(configured.model, `${model}[1m]`);
    assert.equal(configured.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, window);
    for (const name of ["ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL"]) {
      assert.equal(configured.env[name], `${model}[1m]`);
    }
    const native = claudeModelConfiguration({ providerId: "anthropic", model: "opus" }, null);
    for (const name of Object.keys(configured.env)) {
      if (!["ANTHROPIC_BASE_URL", "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"].includes(name)) assert.equal(native.env[name], "", name);
    }
    assert.equal(native.model, "opus");
  }
});

test("Claude status reads native JSON and returns only public account details", async () => {
  const status = await readClaudeCodeAuthStatus({ credentialHome: { home: "/home/fixture" }, commandRunner: async (input) => {
    assert.deepEqual(input.args, ["auth", "status", "--json"]);
    assert.equal(input.timeout, 30_000);
    assert.equal(input.credentialHome.home, "/home/fixture");
    return { ok: true, stdout: JSON.stringify({ loggedIn: true, email: "owner@example.test", authMethod: "claude.ai", subscriptionType: "max", accessToken: "not-public" }) };
  } });
  assert.equal(status.loggedIn, true);
  assert.equal(status.email, "owner@example.test");
  assert.equal(JSON.stringify(status).includes("not-public"), false);
});

test("Claude signed-out JSON is normal while failed and malformed status responses stay errors", async () => {
  const readStatus = (result) => readClaudeCodeAuthStatus({
    credentialHome: { home: "/home/fixture" }, commandRunner: async () => result
  });
  const signedOut = { ok: false, exitCode: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }) };
  assert.deepEqual(await readStatus(signedOut), {
    loggedIn: false, email: "", authMethod: "none", subscriptionType: ""
  });
  for (const result of [
    { ...signedOut, timedOut: true },
    { ...signedOut, signal: "SIGTERM" },
    { ...signedOut, exitCode: 2 },
    { ...signedOut, stdout: JSON.stringify({ loggedIn: true, email: "owner@example.test" }) },
    { ...signedOut, stdout: "invalid" },
    { ok: true, stdout: "{}" },
    { ok: true, stdout: "null" }
  ]) {
    const status = await readStatus(result);
    assert.equal(status.loggedIn, false);
    assert.ok(status.error);
  }
});

test("Claude status shares concurrent reads and invalidates when native account files change", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "claude-auth-status-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configRoot = path.join(home, ".claude");
  await mkdir(configRoot);
  let calls = 0;
  let email = "first@example.test";
  const input = { env: { CLAUDE_CONFIG_DIR: configRoot }, credentialHome: { home }, commandRunner: async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, stdout: JSON.stringify({ loggedIn: true, email, authMethod: "claude.ai" }) };
  } };
  const statuses = await Promise.all(Array.from({ length: 8 }, () => readClaudeCodeAuthStatus(input)));
  assert.equal(calls, 1);
  assert.ok(statuses.every((status) => status.email === email));
  if (process.platform !== "darwin") {
    await readClaudeCodeAuthStatus(input);
    assert.equal(calls, 1);
  }
  for (const file of [path.join(configRoot, ".credentials.json"), path.join(home, ".claude.json"), path.join(configRoot, ".claude.json")]) {
    email = `${calls}@example.test`;
    // Deliberately not JSON: the wrapper must never parse native credentials.
    await writeFile(file, "native-account-changed");
    assert.equal((await readClaudeCodeAuthStatus(input)).email, email);
    await rm(file);
    const before = calls;
    await readClaudeCodeAuthStatus(input);
    assert.equal(calls, before + 1);
  }
});

test("Claude status failures do not poison later reads or share across credential homes", async () => {
  let calls = 0;
  const commandRunner = async () => {
    calls += 1;
    return calls === 1 ? { ok: false, error: "Temporary failure" }
      : { ok: true, stdout: JSON.stringify({ loggedIn: false }) };
  };
  const input = { env: {}, credentialHome: { home: "/home/fixture" }, commandRunner };
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Temporary failure");
  assert.equal((await readClaudeCodeAuthStatus(input)).error, undefined);
  assert.equal(calls, 2);
  await readClaudeCodeAuthStatus({ ...input, credentialHome: { home: "/home/another" } });
  assert.equal(calls, 3);
});

test("a Claude status read that cannot finish keeps Claude's recent answer for unchanged account files", {
  skip: process.platform === "darwin"
}, async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "claude-auth-status-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const signedIn = { ok: true, stdout: JSON.stringify({ loggedIn: true, email: "owner@example.test", authMethod: "claude.ai" }) };
  const signedInStatus = { loggedIn: true, email: "owner@example.test", authMethod: "claude.ai", subscriptionType: "" };
  const timedOut = { ok: false, exitCode: 1, timedOut: true, error: "Command timed out." };
  let calls = 0;
  let result = signedIn;
  const input = { env: { CLAUDE_CONFIG_DIR: path.join(home, ".claude") }, credentialHome: { home },
    commandRunner: async () => { calls += 1; return result; } };
  assert.equal((await readClaudeCodeAuthStatus(input)).email, "owner@example.test");
  // An overloaded host times the next read out, or refuses to start it for now.
  for (const unfinished of [timedOut, { ok: false, exitCode: 1, retryable: true, error: "Memory-pressure spike." }]) {
    now += 31_000;
    result = unfinished;
    assert.deepEqual(await readClaudeCodeAuthStatus(input), signedInStatus);
  }
  // That answer is reused for the normal window, so the busy host is not probed again at once.
  const probes = calls;
  now += 29_000;
  assert.deepEqual(await readClaudeCodeAuthStatus(input), signedInStatus);
  assert.equal(calls, probes);
  // A read that ran and failed is still reported.
  now += 2_000;
  result = { ok: false, exitCode: 2, error: "Claude Code crashed." };
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Claude Code crashed.");
  // Changed account files need Claude's own new answer.
  await mkdir(path.join(home, ".claude"));
  await writeFile(path.join(home, ".claude", ".credentials.json"), "native-account-changed");
  result = timedOut;
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Command timed out.");
  // The recent answer expires: an old one is not kept forever.
  now += 31_000;
  result = signedIn;
  assert.equal((await readClaudeCodeAuthStatus(input)).loggedIn, true);
  now += 5 * 60_000 + 1;
  result = timedOut;
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Command timed out.");
});

test("an unfinished Claude status read with no recent answer is reported without probing again at once", {
  skip: process.platform === "darwin"
}, async (t) => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  let calls = 0;
  let result = { ok: false, exitCode: 1, retryable: true, error: "Memory-pressure spike." };
  const input = { env: {}, credentialHome: { home: "/home/fixture-busy" }, commandRunner: async () => { calls += 1; return result; } };
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Memory-pressure spike.");
  now += 29_000;
  assert.equal((await readClaudeCodeAuthStatus(input)).error, "Memory-pressure spike.");
  assert.equal(calls, 1);
  now += 2_000;
  result = { ok: true, stdout: JSON.stringify({ loggedIn: true, email: "owner@example.test" }) };
  assert.equal((await readClaudeCodeAuthStatus(input)).loggedIn, true);
  assert.equal(calls, 2);
});

test("Claude plan usage retains real windows and never invents an allowance after reset", () => {
  assert.deepEqual(claudePlanUsage({ rate_limits_available: false }).windows, []);
  const usage = claudePlanUsage({ rate_limits_available: true, rate_limits: {
    five_hour: { utilization: 25, resets_at: "2099-01-01T00:00:00Z" },
    seven_day: { utilization: 100, resets_at: null },
    seven_day_sonnet: { utilization: 10, resets_at: "2000-01-01T00:00:00Z" },
    seven_day_opus: { utilization: null, resets_at: null }
  } });
  assert.equal(usage.status, "available");
  assert.deepEqual(usage.windows.map(({ id, remainingPercent }) => ({ id, remainingPercent })), [
    { id: "five_hour", remainingPercent: 75 }, { id: "seven_day", remainingPercent: 0 }
  ]);
});


test("normal Claude application MCP declaration preserves native source tools and permission defaults", () => {
  const ordinary = claudeCodeArguments({ sessionId: "native", model: "sonnet" });
  const configured = claudeCodeArguments({ sessionId: "native", model: "sonnet", applicationTools: true });
  const position = configured.indexOf("--mcp-config");
  assert.ok(position >= 0);
  assert.deepEqual(JSON.parse(configured[position + 1]), { mcpServers: { application: { type: "sdk", name: "application" } } });
  assert.deepEqual(configured.filter((_value, index) => index !== position && index !== position + 1), ordinary);
  for (const flag of ["--safe-mode", "--strict-mcp-config", "--restricted", "--tools", "--permission-mode", "--allowedTools", "--disallowedTools"]) {
    assert.equal(configured.includes(flag), ordinary.includes(flag), flag);
  }
  assert.equal(configured.includes("bypassPermissions"), false);
});

test("Claude preserves the execution host's failed-start identity and cleanup proof", async () => {
  for (const scopeEmpty of [false, true]) {
    const cleanupError = new Error("Managed cleanup was unavailable");
    const failure = Object.assign(new Error("Managed stream socket did not open"), {
      executionId: "admitted-execution", stopProof: { scopeEmpty },
      ...(!scopeEmpty ? { cleanupError, cleanupFailed: true } : {})
    });
    const stopProof = failure.stopProof;
    let stops = 0;
    const execution = {
      async start() { throw failure; },
      async stop() { stops += 1; return { scopeEmpty: true }; }
    };
    await assert.rejects(createClaudeCodeProcess({ execution }), error => {
      assert.equal(error, failure);
      assert.equal(error.executionId, "admitted-execution");
      assert.equal(error.stopProof, stopProof);
      assert.equal(error.stopProof.scopeEmpty, scopeEmpty);
      if (!scopeEmpty) {
        assert.equal(error.cleanupError, cleanupError);
        assert.equal(error.cleanupFailed, true);
      }
      return true;
    });
    assert.equal(stops, 0);
  }
});

test("Claude handshake failure retains acquired execution custody when cleanup is unconfirmed", { skip: process.platform === "win32" }, async t => {
  for (const throws of [false, true]) {
    const setup = await fixture(t, 'process.stdin.once("data", () => process.stdout.write("invalid frame\\n"));');
    const local = createLocalConversationExecution();
    let executionId;
    const cleanupError = new Error("Managed stop acknowledgement was unavailable");
    const execution = {
      async start(input) {
        const native = await local.start(input);
        executionId = native.id;
        return native;
      },
      async stop(id) {
        assert.equal(id, executionId);
        await local.stop(id);
        if (throws) throw cleanupError;
        return { scopeEmpty: false };
      }
    };
    t.after(() => local.close());
    await assert.rejects(createClaudeCodeProcess({ ...setup, execution }), error => {
      assert.match(error.message, /invalid UTF-8 or JSON/);
      assert.equal(error.executionId, executionId);
      assert.equal(error.stopProof.scopeEmpty, false);
      assert.equal(error.cleanupFailed, true);
      if (throws) assert.equal(error.cleanupError, cleanupError);
      return true;
    });
  }
});


test("Claude observes parent exit after initialization even while a child retains stdout", { timeout: 3_000 }, async t => {
  const { PassThrough, Writable } = await import("node:stream");
  const exited = Promise.withResolvers();
  const failed = Promise.withResolvers();
  const stdout = new PassThrough();
  const stdin = new Writable({ write(chunk, _encoding, done) {
    const frame = JSON.parse(String(chunk));
    stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } }) + "\n");
    done();
  } });
  let failures = 0;
  const native = await createClaudeCodeProcess({ execution: {
    async start() { return { id: "parent-exit", stdin, stdout, exited: exited.promise }; },
    async stop() { return { scopeEmpty: true }; }
  }, onFailure(error) { failures++; failed.resolve(error); } });
  t.after(() => native.stop());
  assert.equal(stdout.readableEnded, false);
  exited.resolve({ code: 1, signal: null });
  const error = await failed.promise;
  assert.equal(error.code, "assistant_claude_observation_lost");
  assert.deepEqual(error.processExit, { code: 1, signal: null });
  assert.match(error.message, /^Claude stopped unexpectedly with exit code 1\. .*send a message to continue/u);
  await native.client.completion;
  assert.equal(failures, 1);
});

test("Claude reports a task-limit exit that arrives after its stream ended", { timeout: 3_000 }, async t => {
  const { PassThrough, Writable } = await import("node:stream");
  const exited = Promise.withResolvers();
  const failed = Promise.withResolvers();
  const stdout = new PassThrough();
  const stdin = new Writable({ write(chunk, _encoding, done) {
    const frame = JSON.parse(String(chunk));
    stdout.write(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } }) + "\n");
    done();
  } });
  const native = await createClaudeCodeProcess({ execution: {
    async start() { return { id: "task-limit", stdin, stdout, exited: exited.promise }; },
    async stop() { return { scopeEmpty: true }; }
  }, onFailure(error) { failed.resolve(error); } });
  t.after(() => native.stop());
  stdout.end();
  const taskLimit = { source: "cgroup-pids-events", count: 3 };
  setTimeout(() => exited.resolve({ code: 1, signal: null, taskLimit }), 50);
  const error = await failed.promise;
  assert.equal(error.code, "assistant_claude_observation_lost");
  assert.deepEqual(error.processExit, { code: 1, signal: null, taskLimit });
  assert.match(error.message, /process\/thread limit reached/u);
});

test("Claude host startup budget allows slow initialization and still bounds failed startup", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { PassThrough, Writable } = await import("node:stream");
  for (const responds of [true, false]) {
    const requested = Promise.withResolvers();
    const stdout = new PassThrough();
    const stdin = new Writable({ write(chunk, _encoding, done) {
      requested.resolve(JSON.parse(chunk.toString())); done();
    } });
    const stops = [];
    const pending = createClaudeCodeProcess({ initializationTimeoutMs: 90_000, execution: {
      async start() { return { id: "cold-start", stdin, stdout }; },
      async stop(id) { stops.push(id); return { scopeEmpty: true }; }
    } });
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const frame = await requested.promise;
    t.mock.timers.tick(45_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, "Cold initialization survives the ordinary control deadline");
    if (responds) {
      stdout.write(JSON.stringify({ type: "control_response", response: {
        subtype: "success", request_id: frame.request_id, response: {}
      } }) + "\n");
      await (await pending).stop();
    } else {
      const rejected = assert.rejects(pending, error =>
        error.code === "assistant_claude_control_timeout" && error.stopProof.scopeEmpty === true);
      t.mock.timers.tick(45_000);
      await rejected;
    }
    assert.deepEqual(stops, ["cold-start"]);
    stdout.destroy(); stdin.destroy();
  }
});

test("Claude initialization rejects confirmed execution exit before half-open protocol EOF", async () => {
  const { PassThrough, Writable } = await import("node:stream");
  for (const cleanup of ["verified", "unconfirmed", "rejected"]) {
    const requested = Promise.withResolvers();
    const exited = Promise.withResolvers();
    const stdout = new PassThrough();
    const stdin = new Writable({ write(chunk, _encoding, done) {
      requested.resolve(JSON.parse(chunk.toString()));
      done();
    } });
    const cleanupError = new Error("Owned cleanup refused");
    const stops = [];
    const execution = {
      async start() { return { id: "half-open-startup", stdin, stdout, exited: exited.promise }; },
      async stop(id) {
        stops.push(id);
        if (cleanup === "rejected") throw cleanupError;
        return { scopeEmpty: cleanup === "verified" };
      }
    };
    const pending = createClaudeCodeProcess({ execution });
    let failure;
    void pending.catch(error => { failure = error; });
    try {
      assert.equal((await requested.promise).request.subtype, "initialize");
      assert.equal(stdout.readableEnded, false);
      exited.resolve({ code: 1, signal: null });
      // The supplied process receipt must settle startup without a protocol EOF
      // or advancement of the original 30-second control deadline.
      for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve));
      assert.ok(failure, "Confirmed native exit settles initialization promptly");
      assert.equal(failure.code, "assistant_claude_startup_exited");
      assert.deepEqual(failure.processExit, { code: 1, signal: null });
      assert.equal(failure.executionId, "half-open-startup");
      assert.deepEqual(stops, ["half-open-startup"]);
      assert.equal(failure.stopProof.scopeEmpty, cleanup === "verified");
      assert.equal(failure.cleanupFailed === true, cleanup !== "verified");
      if (cleanup === "rejected") assert.equal(failure.cleanupError, cleanupError);
    } finally {
      stdout.destroy();
      stdin.destroy();
      await pending.catch(() => {});
    }
  }
});

test("Claude initialization preserves rejected execution observation and exact cleanup custody", async () => {
  const { PassThrough, Writable } = await import("node:stream");
  const requested = Promise.withResolvers();
  const exited = Promise.withResolvers();
  const stdout = new PassThrough();
  const stdin = new Writable({ write(_chunk, _encoding, done) { requested.resolve(); done(); } });
  const failure = new Error("Execution observation failed");
  const stops = [];
  const pending = createClaudeCodeProcess({ execution: {
    async start() { return { id: "observed-startup", stdin, stdout, exited: exited.promise }; },
    async stop(id) { stops.push(id); return { scopeEmpty: true }; }
  } });
  const rejected = assert.rejects(pending, error => {
    assert.equal(error, failure);
    assert.equal(error.executionId, "observed-startup");
    assert.deepEqual(error.stopProof, { scopeEmpty: true, exited: true });
    assert.equal(error.cleanupFailed, undefined);
    return true;
  });
  try {
    await requested.promise;
    exited.reject(failure);
    await rejected;
    assert.deepEqual(stops, ["observed-startup"]);
  } finally {
    stdout.destroy();
    stdin.destroy();
  }
});


test("Claude supplied execution hosts retain initialization without an optional exit receipt", { skip: process.platform === "win32" }, async t => {
  const setup = await fixture(t, `
    import { createInterface } from "node:readline";
    createInterface({ input: process.stdin }).on("line", line => {
      const frame = JSON.parse(line);
      process.stdout.write(JSON.stringify({ type: "control_response", response: {
        subtype: "success", request_id: frame.request_id, response: { originalHost: true }
      } }) + "\\n");
    });
  `);
  const local = createLocalConversationExecution();
  t.after(() => local.close());
  const native = await createClaudeCodeProcess({ ...setup, execution: {
    async start(input) {
      const { id, stdin, stdout } = await local.start(input);
      return { id, stdin, stdout };
    },
    stop: id => local.stop(id)
  } });
  assert.equal(native.initialization.originalHost, true);
  assert.deepEqual(await native.stop(), { scopeEmpty: true, exited: true });
});


test("Claude account queries isolate concurrent identities and deduplicate each account", async () => {
  for (const method of ["readCatalogue", "readPlanUsage"]) {
    const pending = new Map(["first", "second"].map(id => [id, Promise.withResolvers()]));
    const calls = [];
    const queries = createClaudeAccountQueries({
      accountIdentity: async context => context.id,
      processes: () => [...pending].map(([id, held]) => ({ accountIdentity: id, process: {
        get initialization() { calls.push(id); return held.promise; },
        client: { request() { calls.push(id); return held.promise; } }
      } })),
      createProcess() { throw new Error("An owned account process should be reused."); }
    });
    const first = queries[method]({ id: "first" });
    const duplicate = queries[method]({ id: "first" });
    const second = queries[method]({ id: "second" });
    // Finish in reverse order to expose cross-account sharing and cache races.
    pending.get("second").resolve({ models: [{ value: "second" }], rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 20 }, limits: [] } });
    pending.get("first").resolve({ models: [{ value: "first" }], rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 80 }, limits: [] } });
    const [a, same, b] = await Promise.all([first, duplicate, second]);
    assert.deepEqual(calls, ["first", "second"], method);
    assert.deepEqual(same, a);
    if (method === "readCatalogue") {
      assert.equal(a.models[0].value, "first");
      assert.equal(b.models[0].value, "second");
    } else {
      assert.equal(a.identity, "first");
      assert.equal(b.identity, "second");
      assert.equal(a.windows[0].remainingPercent, 20);
      assert.equal(b.windows[0].remainingPercent, 80);
    }
    await queries.invalidate();
  }
});

test("Claude plan usage shows only an answer from the usage endpoint as current", async () => {
  let answer;
  const queries = createClaudeAccountQueries({
    accountIdentity: async () => "account",
    processes: () => [{ accountIdentity: "account", process: { client: { request: async () => answer } } }],
    createProcess() { throw new Error("No temporary Claude can start here."); }
  });
  const resets_at = new Date(Date.now() + 86_400_000).toISOString();
  // Shape of Claude Code's answer while its endpoint read fails or is held: the
  // window readings of its own last API response, which can be hours old, without
  // the endpoint's `limits` list and without any age.
  const seeded = { rate_limits_available: true, rate_limits: { seven_day: { utilization: 7, resets_at } } };
  answer = seeded;
  assert.deepEqual(await queries.readPlanUsage({}), { status: "unavailable", windows: [] });
  queries.invalidateUsage();
  answer = { rate_limits_available: true, rate_limits: { seven_day: { utilization: 23, resets_at }, limits: [] } };
  const verified = await queries.readPlanUsage({});
  assert.equal(verified.status, "available");
  assert.equal(verified.windows[0].remainingPercent, 77);
  assert.ok(verified.currentForMs > 0 && verified.currentForMs <= 420_000);
  queries.invalidateUsage();
  answer = seeded;
  const kept = await queries.readPlanUsage({});
  assert.equal(kept.windows[0].remainingPercent, 77, "an unverified answer replaced the endpoint reading");
  assert.equal(kept.checkedAt, verified.checkedAt);
  await queries.invalidate();
});

test("Claude plan usage asks a temporary Claude when a live process cannot prove its answer", async (t) => {
  const realNow = Date.now;
  let now = Date.parse("2026-10-29T03:00:00Z");
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const resets_at = "2026-11-04T05:00:00Z";
  const starts = [];
  let stops = 0;
  let liveReads = 0;
  let startRefused = false;
  const queries = createClaudeAccountQueries({
    accountIdentity: async () => "account",
    // An idle conversation whose own endpoint read is held answers from old headers.
    processes: () => [{ accountIdentity: "account", process: { client: { request: async () => {
      liveReads++;
      return { rate_limits_available: true, rate_limits: { seven_day: { utilization: 7, resets_at } } };
    } } } }],
    createProcess(input) {
      if (startRefused) throw new Error("Memory is low.");
      starts.push(input.purpose);
      return { client: { request: async () => ({ rate_limits_available: true,
        rate_limits: { seven_day: { utilization: 23, resets_at }, limits: [] } }) },
      async stop() { stops++; return { scopeEmpty: true }; } };
    }
  });
  const first = await queries.readPlanUsage({});
  assert.equal(first.status, "available");
  assert.equal(first.windows[0].remainingPercent, 77);
  assert.deepEqual(starts, ["usage"]);
  for (let poll = 1; poll <= 4; poll++) {
    now += 60_000;
    assert.equal((await queries.readPlanUsage({})).windows[0].remainingPercent, 77);
  }
  assert.equal(liveReads, 5);
  assert.deepEqual(starts, ["usage"], "a fallback started Claude inside the idle interval");
  now += 61_000;
  await queries.readPlanUsage({});
  assert.deepEqual(starts, ["usage", "usage"]);
  assert.equal(stops, starts.length, "a temporary usage process outlived its read");
  // A refused fallback keeps the last verified reading rather than failing the read.
  now += 301_000;
  startRefused = true;
  const kept = await queries.readPlanUsage({});
  assert.equal(kept.windows[0].remainingPercent, 77);
  await queries.invalidate();
});

test("Claude plan usage starts one temporary Claude per idle interval and marks an old reading stale", async (t) => {
  const realNow = Date.now;
  let now = Date.parse("2026-10-29T03:00:00Z");
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const starts = [];
  let stops = 0;
  let answer = { rate_limits_available: true, rate_limits: {
    seven_day: { utilization: 23, resets_at: "2026-11-04T05:00:00Z" }, limits: [] } };
  const queries = createClaudeAccountQueries({
    accountIdentity: async () => "account",
    createProcess(input) {
      starts.push(input.purpose);
      return { client: { request: async () => answer }, async stop() { stops++; return { scopeEmpty: true }; } };
    }
  });
  const first = await queries.readPlanUsage({});
  assert.equal(first.status, "available");
  assert.equal(first.windows[0].remainingPercent, 77);
  // Pages polling every minute share the account's reading.
  for (let poll = 1; poll <= 4; poll++) {
    now += 60_000;
    assert.equal((await queries.readPlanUsage({})).status, "available");
  }
  assert.deepEqual(starts, ["usage"]);
  now += 61_000;
  answer = { rate_limits_available: true, rate_limits: { seven_day: { utilization: 7, resets_at: "2026-11-04T05:00:00Z" } } };
  const unverified = await queries.readPlanUsage({});
  assert.deepEqual(starts, ["usage", "usage"]);
  assert.equal(unverified.windows[0].remainingPercent, 77);
  now += 120_000;
  const stale = await queries.readPlanUsage({});
  assert.equal(stale.status, "stale");
  assert.equal(stale.windows[0].remainingPercent, 77);
  assert.equal(stale.checkedAt, first.checkedAt);
  assert.equal("currentForMs" in stale, false);
  assert.deepEqual(starts, ["usage", "usage"], "a poll inside the idle interval started Claude");
  assert.equal(stops, starts.length, "a temporary usage process outlived its read");
  await queries.invalidate();
});

test("Claude account queries label temporary startup and reuse each account's recent reading", async () => {
  const starts = [];
  let stops = 0;
  const queries = createClaudeAccountQueries({
    accountIdentity: async () => "private-account-identity",
    createProcess(input) {
      starts.push(input);
      return {
        initialization: { models: [] },
        client: { request: async () => ({ rate_limits_available: false }) },
        async stop() { stops++; return { scopeEmpty: true }; }
      };
    }
  });
  for (const method of ["readCatalogue", "readPlanUsage"]) {
    await queries[method]({});
    await queries[method]({});
  }
  assert.deepEqual(starts.map(input => input.purpose), ["catalogue", "usage"]);
  assert.ok(starts.every(input => input.signal instanceof AbortSignal));
  assert.ok(starts.every(input => Object.keys(input).sort().join() === "purpose,signal"));
  assert.equal(stops, 2);
  await queries.invalidate();
});

test("account invalidation cancels held startup and reads without stopping a borrowed conversation", async () => {
  for (const phase of ["catalogue startup", "owned catalogue", "borrowed usage"]) {
    const started = Promise.withResolvers();
    let stops = 0;
    const native = { client: { request() { started.resolve(); return new Promise(() => {}); } },
      get initialization() { started.resolve(); return new Promise(() => {}); },
      async stop() { stops++; return { scopeEmpty: true }; } };
    const queries = createClaudeAccountQueries({ accountIdentity: async () => "account",
      processes: () => phase === "borrowed usage" ? [{ accountIdentity: "account", process: native }] : [],
      createProcess({ signal }) {
        if (phase !== "catalogue startup") return native;
        started.resolve();
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      }
    });
    const pending = phase === "borrowed usage" ? queries.readPlanUsage({}) : queries.readCatalogue({});
    const rejected = assert.rejects(pending, /cancelled for reconnection/);
    await started.promise;
    await queries.invalidate();
    await rejected;
    assert.equal(stops, phase === "owned catalogue" ? 1 : 0, phase);
  }
});

for (const method of ["readCatalogue", "readPlanUsage"]) {
  // Plan usage borrows a conversation's process, so it has no cleanup to retain.
  for (const phase of method === "readPlanUsage" ? ["initial identity", "final identity"] : ["initial identity", "final identity", "retained cleanup"]) {
    test(`${method} invalidation fences ${phase} before launching or caching a stale query`, { timeout: 2_000 }, async () => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      let identities = 0;
      let starts = 0;
      let stops = 0;
      const queries = createClaudeAccountQueries({
        async accountIdentity() {
          identities++;
          if (identities === (phase === "initial identity" ? 1 : phase === "final identity" ? 2 : -1)) {
            entered.resolve();
            await release.promise;
          }
          return "account";
        },
        // Usage reads count as native reads of the borrowed conversation process.
        processes: () => method === "readPlanUsage" ? [{ accountIdentity: "account", process: { client: {
          request: async () => { starts++; return { rate_limits_available: true, rate_limits: { limits: [] } }; } } } }] : [],
        createProcess() {
          starts++;
          return {
            initialization: { models: [{ value: `model-${starts}` }] },
            client: { request: async () => ({ rate_limits_available: true, rate_limits: {} }) },
            async stop() {
              stops++;
              if (phase === "retained cleanup" && stops === 1) return { scopeEmpty: false };
              if (phase === "retained cleanup" && stops === 2) {
                entered.resolve();
                await release.promise;
              }
              return { scopeEmpty: true };
            }
          };
        }
      });
      if (phase === "retained cleanup") await assert.rejects(queries[method]({}), /cleanup could not be confirmed/);
      const pending = queries[method]({}).then(value => ({ value }), failure => ({ failure }));
      await entered.promise;
      const invalidating = queries.invalidate();
      // Initial account lookup has not registered a process or pending query.
      // Let invalidation finish to exercise an old read resuming after reconnect.
      if (phase === "initial identity") await invalidating;
      release.resolve();
      const result = await pending;
      await invalidating;
      assert.match(result.failure?.message || "query unexpectedly succeeded", /cancelled for reconnection/);
      assert.equal(starts, phase === "initial identity" ? 0 : 1, "invalidation must not launch a successor");
      await queries[method]({});
      assert.equal(starts, phase === "initial identity" ? 1 : 2, "a fresh request repopulates the invalidated cache");
      await queries.invalidate();
    });
  }
}
