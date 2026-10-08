import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path, { join } from "node:path";
import { test } from "node:test";
import { claudePlanUsage, claudeCodeArguments, claudeModelConfiguration, createClaudeCodeProcess, readClaudeCodeAuthStatus, stopClaudeCodeProcess } from "../src/server/conversation/claudeProcess.js";

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
