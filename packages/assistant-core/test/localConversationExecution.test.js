import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalConversationExecution } from "../src/server/conversation/localExecution.js";

const options = { skip: process.platform === "win32" };
function host(t) {
  const execution = createLocalConversationExecution();
  t.after(() => execution.close());
  return execution;
}
const spec = (code) => ({ command: process.execPath, args: ["-e", code], cwd: process.cwd(), stream: true });

test("the supplied execution host carries native protocol bytes and proves owned cleanup", options, async (t) => {
  const execution = host(t);
  const child = await execution.start(spec('process.stdin.on("data", data => process.stdout.write(data));'));
  const response = once(child.stdout, "data");
  child.stdin.write("protocol bytes\n");
  assert.equal(String((await response)[0]), "protocol bytes\n");
  assert.equal(child.running, true);
  assert.deepEqual(await execution.stop(child.id), { scopeEmpty: true });
  assert.equal(child.running, false);
  await child.exited;
});

test("stopping one owned execution cannot stop another and rejects unknown ownership", options, async (t) => {
  const execution = host(t);
  const first = await execution.start(spec('setInterval(() => {}, 1000);'));
  const second = await execution.start(spec('setInterval(() => {}, 1000);'));
  await assert.rejects(execution.stop("another-host"), /does not own/);
  await execution.stop(first.id);
  assert.equal(second.running, true);
  await execution.close();
  assert.equal(second.running, false);
  await assert.rejects(execution.start(spec("")), /closed/);
});

test("native startup failures retain their cause and unsupported limits are explicit", options, async (t) => {
  const execution = host(t);
  await assert.rejects(execution.start({ ...spec(""), command: "/does-not-exist/jskit-native" }),
    (error) => error.cause?.code === "ENOENT" && /Check the executable/.test(error.message));
  await assert.rejects(execution.start({ ...spec(""), limits: { memoryBytes: 1024 } }), /cannot enforce resource limits/);
});

test("shutdown racing with startup releases the child instead of handing out a live process", options, async (t) => {
  const execution = host(t);
  const starting = execution.start(spec('setInterval(() => {}, 1000);'));
  const rejected = assert.rejects(starting, /closed during startup/);
  await execution.close();
  await rejected;
});

test("native command requests use the same execution owner and retain bounded capture and detached logs", options, async (t) => {
  const execution = host(t);
  const directory = await mkdtemp(join(tmpdir(), "jskit-execution-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const captured = await execution.run({ command: process.execPath,
    args: ["-e", 'process.stdout.write("x".repeat(70000)); process.stderr.write("finished");'],
    cwd: directory, mode: "capture" });
  assert.equal(captured.ok, true);
  assert.equal(Buffer.byteLength(captured.output), 64 * 1024);
  assert.ok(captured.output.endsWith("finished"));
  const logPath = join(directory, "detached.log");
  const child = await execution.run({ command: process.execPath,
    args: ["-e", 'process.stderr.write("ready"); setInterval(() => {}, 1000);'],
    cwd: directory, mode: "detached", logPath });
  assert.equal(child.ok, true);
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
  const deadline = Date.now() + 3000;
  while (!(await readFile(logPath, "utf8")).includes("ready") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await readFile(logPath, "utf8"), "ready");
  assert.deepEqual(await execution.stop(child.execution.id), { scopeEmpty: true });
  assert.deepEqual(await execution.stop(child.execution.id, { allowMissingRecordScopeRecovery: true }),
    { ok: false, scopeEmpty: false });
});

test("native capture timeout drains its execution before returning", options, async (t) => {
  const execution = host(t);
  const result = await execution.run({ command: process.execPath,
    args: ["-e", 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);'],
    cwd: process.cwd(), mode: "capture", timeout: 500 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.throws(() => process.kill(Number(result.output), 0), { code: "ESRCH" });
});
