import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { validateIntegrationConfiguration, parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { createWizScanner } from "../src/server/wiz.js";
import { wizDefinition } from "../src/shared/wiz.js";

const context = { applicationId: "project-one", subjectId: "workspace-one" };
const args = { context, integrationId: "security" };
const configuration = () => ({ schemaVersion: 1, registrations: {
  wiz: { source: "own", grantType: "client_credentials", clientId: "fixture-client", clientSecretRef: "env:WIZ_SECRET" }
}, integrations: { security: { provider: "wiz", displayName: "Workspace scan", accountMode: "shared", scopes: [],
  authentication: { method: "oauth2", registrationRef: "wiz" }, settings: {} } } });

async function fixture(t, patch = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "wiz-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source with spaces;$literal"); await mkdir(source);
  const executable = path.join(root, "fixture-cli");
  await writeFile(executable, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const state = JSON.parse(fs.readFileSync(path.join(process.argv[4], 'fixture.json'), 'utf8'));
const reportPath = process.argv.find(value => value.startsWith('--json-output-file=')).slice('--json-output-file='.length);
const record = { argv: process.argv.slice(2), cwd: process.cwd(), environment: process.env, pid: process.pid };
if (state.hang) {
 const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
 record.childPid = child.pid;
 fs.writeFileSync(path.join(process.argv[4], 'invocation.json'), JSON.stringify(record));
 setInterval(() => {}, 1000);
} else {
 fs.writeFileSync(path.join(process.argv[4], 'invocation.json'), JSON.stringify(record));
 if (state.mode === 'symlink') fs.symlinkSync(path.join(process.argv[4], 'fixture.json'), reportPath);
 else if (state.mode === 'directory') fs.mkdirSync(reportPath);
 else if (state.mode === 'text') fs.writeFileSync(reportPath, 'private-cli-error: not JSON');
 else if (state.mode !== 'missing') fs.writeFileSync(reportPath, JSON.stringify(state.report));
 console.error('private-stderr-' + process.env.WIZ_CLIENT_SECRET);
 process.exit(state.exitCode || 0);
}
`, { mode: 0o700 });
  const state = { exitCode: 0, report: { status: { state: "SUCCESS", verdict: "PASSED_BY_POLICY" }, result: { sast: [] } }, ...patch };
  const saveState = () => writeFile(path.join(source, "fixture.json"), JSON.stringify(state)); await saveState();
  const config = configuration(); const decisions = []; const resolutions = [];
  let secret = "private-secret-one";
  const options = { configuration: config, executable, timeoutMs: 3000,
    authorize: async (owner, request) => { decisions.push(request); return owner?.applicationId === context.applicationId && owner?.subjectId === context.subjectId ? owner : null; },
    resolveScanTarget: async (owner) => { assert.deepEqual(owner, context); resolutions.push("source"); return { directory: source, revision: "revision-one" }; },
    resolveReference: async (ref, owner) => { assert.equal(ref, "env:WIZ_SECRET"); assert.deepEqual(owner, context); resolutions.push("secret"); return secret; }
  };
  return { root, source, state, config, options, decisions, resolutions, saveState,
    scanner: () => createWizScanner(options), invocation: async () => JSON.parse(await readFile(path.join(source, "invocation.json"), "utf8")),
    rotate: () => { secret = "private-secret-two"; } };
}

test("Wiz runs a controlled CLI using authorised source, isolated state and credentials outside argv", async (t) => {
  const f = await fixture(t); const result = await f.scanner().scan(args);
  assert.deepEqual(result, { provider: "wiz", integrationId: "security", revision: "revision-one", policyStatus: "passed", report: f.state.report });
  assert.deepEqual(f.decisions, [{ integrationId: "security", operation: "source.scan", accountMode: "shared" }]);
  const run = await f.invocation(); assert.deepEqual(run.argv.slice(0, 3), ["scan", "dir", f.source]);
  assert.ok(run.argv.includes("--by-policy-hits=BLOCK")); assert.ok(run.argv.includes("--timeout=3s"));
  assert.ok(run.argv.includes("--assist-migration"));
  assert.ok(run.argv.includes("--no-telemetry")); assert.equal(run.argv.some((value) => value.includes("private-secret")), false);
  assert.equal(run.environment.WIZ_CLIENT_ID, "fixture-client"); assert.equal(run.environment.WIZ_CLIENT_SECRET, "private-secret-one");
  assert.equal(run.environment.HOME, run.cwd); assert.equal(run.environment.WIZ_DIR, run.cwd); assert.equal(run.environment.TMPDIR, run.cwd);
  assert.notEqual(run.cwd, f.source);
  assert.deepEqual(Object.keys(run.environment).sort(), ["HOME", "PATH", "TMPDIR", "WIZ_CLIENT_ID", "WIZ_CLIENT_SECRET", "WIZ_DIR"].sort());
  await assert.rejects(access(run.cwd), { code: "ENOENT" });
});

test("Wiz keeps policy blocking distinct from warning and from filtering all findings", async (t) => {
  const f = await fixture(t); f.config.integrations.security.settings = { byPolicyHits: "DISABLED", policies: 'First policy,  Second "quoted" policy;literal' };
  f.state.exitCode = 4; f.state.report.status.verdict = "FAILED_BY_POLICY"; await f.saveState();
  assert.equal((await f.scanner().scan(args)).policyStatus, "blocked");
  const run = await f.invocation(); assert.ok(run.argv.includes('--policies=First policy,Second "quoted" policy;literal'));
  assert.ok(run.argv.includes("--by-policy-hits=DISABLED"));
  f.state.exitCode = 0; f.state.report.status.verdict = "WARN_BY_POLICY"; await f.saveState();
  assert.equal((await f.scanner().scan(args)).policyStatus, "warning");
  f.state.report.status.verdict = "FAILED_BY_POLICY"; await f.saveState();
  assert.equal((await f.scanner().scan(args)).policyStatus, "blocked");
});

test("Wiz configuration survives a text round trip and resolves rotated secrets on each scan", async (t) => {
  const f = await fixture(t); const scanner = f.scanner(); await scanner.scan(args); f.rotate(); await scanner.scan(args);
  assert.equal((await f.invocation()).environment.WIZ_CLIENT_SECRET, "private-secret-two");
  const parsed = parseIntegrationConfiguration(JSON.stringify(f.config), { providers: [wizDefinition] });
  assert.deepEqual(parsed.integrations.security.settings, { tokenUrl: "https://auth.app.wiz.io/oauth/token", byPolicyHits: "BLOCK" });
  assert.equal((await createWizScanner({ ...f.options, configuration: parsed }).scan(args)).policyStatus, "passed");
});

test("Wiz denies other owners before resolving source or secrets", async (t) => {
  const f = await fixture(t);
  for (const owner of [null, { ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.scanner().scan({ ...args, context: owner }), { code: "connector_access_denied" });
  }
  assert.deepEqual(f.resolutions, []);
  await assert.rejects(f.scanner().scan({ ...args, integrationId: "constructor" }), { code: "connector_not_found" });
});

test("Wiz preserves Auth0 configuration but rejects unsupported execution before credentials", async (t) => {
  const f = await fixture(t); f.config.integrations.security.settings.tokenUrl = "https://auth.wiz.io/oauth/token";
  assert.equal(validateIntegrationConfiguration(f.config, { providers: [wizDefinition] }).integrations.security.settings.tokenUrl, "https://auth.wiz.io/oauth/token");
  await assert.rejects(f.scanner().scan(args), { code: "connector_authentication_unsupported" }); assert.deepEqual(f.resolutions, []);
  f.config.registrations.wiz = { source: "managed", serviceUrlRef: "env:GATEWAY", serviceCredentialRef: "env:IDENTITY", assignmentRef: "online-wiz" };
  assert.throws(() => f.scanner(), { code: "integration_configuration_invalid" }); assert.deepEqual(f.resolutions, []);
});

test("Wiz rejects invalid policy settings and credential modes before executing", () => {
  for (const settings of [{ tokenUrl: "https://evil.test/oauth/token" }, { byPolicyHits: "NONE" }, { policies: "one,,two" },
    { policies: "" }, { policies: "one\ntwo" }, { policies: Array(51).fill("one").join(",") }, { directory: "/" }]) {
    const config = configuration(); config.integrations.security.settings = settings;
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [wizDefinition] }));
  }
  for (const edit of [(c) => { c.integrations.security.accountMode = "per-user"; }, (c) => { c.registrations.wiz.clientId = "bad\0id"; },
    (c) => { c.registrations.wiz.clientSecretRef = "raw-secret"; }, (c) => { c.registrations.wiz.callbackUrlRef = "env:CALLBACK"; }]) {
    const config = configuration(); edit(config); assert.throws(() => validateIntegrationConfiguration(config, { providers: [wizDefinition] }));
  }
});

test("Wiz reports authentication, command and transport failures without private CLI output", async (t) => {
  const f = await fixture(t);
  for (const exitCode of [1, 2, 3, 5]) {
    f.state.exitCode = exitCode; await f.saveState();
    await assert.rejects(f.scanner().scan(args), (error) => {
      assert.equal(error.code, exitCode === 3 ? "connector_authentication_failed" : "connector_scan_failed");
      assert.equal(String(error).includes("private"), false); return true;
    });
    await assert.rejects(access((await f.invocation()).cwd), { code: "ENOENT" });
  }
});

test("Wiz rejects absent, malformed, oversized and inconsistent reports instead of reporting a clean scan", async (t) => {
  const f = await fixture(t);
  for (const patch of [{ mode: "missing" }, { mode: "text" }, { mode: "symlink" }, { mode: "directory" },
    { mode: "json", report: {} }, { report: { status: { state: "SUCCESS", verdict: "UNKNOWN" }, result: {} } },
    { report: { status: { state: "RUNNING", verdict: "PASSED_BY_POLICY" }, result: {} } },
    { report: { status: { state: "SUCCESS", verdict: "PASSED_BY_POLICY" } } },
    { exitCode: 4, report: { status: { state: "SUCCESS", verdict: "PASSED_BY_POLICY" }, result: {} } }]) {
    Object.assign(f.state, patch); await f.saveState();
    await assert.rejects(f.scanner().scan(args), { code: "connector_response_invalid" });
    await assert.rejects(access((await f.invocation()).cwd), { code: "ENOENT" });
  }
  f.state.exitCode = 0; f.state.report = { status: { state: "SUCCESS", verdict: "PASSED_BY_POLICY" }, result: { large: "x".repeat(1000) } }; await f.saveState();
  await assert.rejects(createWizScanner({ ...f.options, maxReportBytes: 100 }).scan(args), { code: "connector_response_invalid" });
});

test("Wiz validates trusted paths, references and runner options without leaking failures", async (t) => {
  const f = await fixture(t);
  for (const target of [{ directory: "relative", revision: "one" }, { directory: f.source, revision: "" }, { directory: f.options.executable, revision: "one" }]) {
    await assert.rejects(createWizScanner({ ...f.options, resolveScanTarget: async () => target }).scan(args));
  }
  for (const resolveReference of [async () => "", async () => "secret\0", async () => { throw new Error("private-reference-detail"); }]) {
    await assert.rejects(createWizScanner({ ...f.options, resolveReference }).scan(args), { code: "connector_binding_missing" });
  }
  await assert.rejects(createWizScanner({ ...f.options, executable: path.join(f.root, "missing") }).scan(args), { code: "connector_runner_unavailable" });
  for (const patch of [{ executable: "wizcli" }, { timeoutMs: 0 }, { timeoutMs: 3_600_001 }, { maxReportBytes: 0 },
    { environment: { NODE_OPTIONS: "--inspect" } }, { environment: { WIZ_CLIENT_SECRET: "override" } }]) {
    assert.throws(() => createWizScanner({ ...f.options, ...patch }), TypeError);
  }
});

test("Wiz cancellation and timeout terminate the scan process group and remove its state", async (t) => {
  const f = await fixture(t, { hang: true });
  const controller = new AbortController();
  const pending = f.scanner().scan({ ...args, signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "connector_cancelled" });
  let run;
  for (let i = 0; i < 100; i++) { try { run = await f.invocation(); break; } catch { await delay(20); } }
  assert.ok(run?.childPid); controller.abort(); await rejected;
  await assert.rejects(access(run.cwd), { code: "ENOENT" });
  assert.throws(() => process.kill(run.pid, 0), { code: "ESRCH" });
  // A killed grandchild can briefly remain a zombie until the host reaps it.
  if (process.platform === "linux") {
    const childState = await readFile(`/proc/${run.childPid}/stat`, "utf8").catch(() => "");
    assert.ok(childState === "" || /\) Z /u.test(childState));
  }
  await assert.rejects(createWizScanner({ ...f.options, timeoutMs: 200 }).scan(args), { code: "connector_timeout" });
  const timeoutRun = await f.invocation(); await assert.rejects(access(timeoutRun.cwd), { code: "ENOENT" });
  const aborted = new AbortController(); aborted.abort(); const count = f.resolutions.length;
  await assert.rejects(f.scanner().scan({ ...args, signal: aborted.signal }), { code: "connector_cancelled" });
  assert.equal(f.resolutions.length, count);
});
