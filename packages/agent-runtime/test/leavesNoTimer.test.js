import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A server that closes, as an app's does on shutdown, waits for the agent's work to finish: its loops
// get up to 20 seconds to drain (Mercbot gives them that). Once the waits are over, nothing of the
// agent keeps the process alive, so it exits at once instead of when the 20 seconds (or a command's
// 2-minute foreground wait) run out. Each case runs in a child process that holds only a listening
// web server and the agent's parts, and reports the timers still keeping it alive once it is done.
const INDEX = JSON.stringify(new URL("../src/server/index.js", import.meta.url).href);

// Stand-ins for the owner's handles: the tables have nothing due, and a command's row is what it was
// given. Neither the goal hooks nor history is called, since nothing is due.
const CHILD_SETUP = `
import http from "node:http";
import { createCommands, createGoals, createSummaries, localExecutor, startResumer } from ${INDEX};

const handle = {
  withTransaction: (options, work) => work(options),
  claim: async () => [],
  raw: () => new Date().toISOString(),
  create: async (attributes) => ({ id: 1, ...attributes }),
  patch: async (id, changes) => ({ id, ...changes })
};
const resources = { agentGoals: handle, agentSummaries: handle, agentSummaryQueue: handle, agentCommands: handle };
const systemContext = () => ({});
const unused = async () => { throw new Error("nothing is due, so no hook is called"); };

const server = http.createServer((request, response) => response.end("ok"));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const closeServer = () => new Promise((resolve) => server.close(resolve));
const report = (facts) => console.log(JSON.stringify({ ...facts, timers: process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length }));
`;

// The child's report line, and how long after it the child exited, by itself or killed after `capMs`.
async function runChild(body, { capMs = 10000 } = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", CHILD_SETUP + body], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  let reportedAt;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (reportedAt === undefined && output.includes("\n")) reportedAt = Date.now();
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const cap = setTimeout(() => child.kill("SIGKILL"), capMs);
  const { code, signal } = await new Promise((resolve) => child.once("exit", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal })));
  const exitedAt = Date.now();
  clearTimeout(cap);
  assert.ok(reportedAt !== undefined, `the child reports once it is done (exit ${code}, ${signal}): ${errors}`);
  return { report: JSON.parse(output.split("\n")[0]), code, signal, exitMs: exitedAt - reportedAt, errors };
}

// Far below the waits a timer left behind would hold the process for, and loose enough for a loaded host.
const PROMPTLY_MS = 3000;

function assertExitsPromptly({ report, code, signal, exitMs, errors }, what) {
  assert.equal(report.timers, 0, `${what} leaves no timer keeping the process alive (${report.timers} left)`);
  assert.equal(signal, null, `${what}: the process exits by itself, without being killed ${errors}`);
  assert.equal(code, 0, `${what}: the process exits cleanly ${errors}`);
  assert.ok(exitMs < PROMPTLY_MS, `${what}: the process exits ${exitMs} ms after, within ${PROMPTLY_MS} ms`);
}

test("a closed server's resumer, goal and summary loops drain and leave no timer to keep its process alive", async () => {
  const outcome = await runChild(`
// A reply a stopped server left is still being carried on when this server closes.
let resumed = false;
const runs = { takeOverStalled: async () => [{ conversation_id: "1" }] };
const resume = () => new Promise((resolve) => setTimeout(() => { resumed = true; resolve(); }, 100));
const goals = createGoals({ resources, systemContext, runs: {}, find: unused, respond: unused, claim: unused, record: unused });
const summaries = createSummaries({ resources, systemContext, history: unused });
const loops = [startResumer({ runs, resume }), goals.start(), summaries.start()];

await closeServer();
const started = Date.now();
await Promise.all(loops.map((loop) => loop.drain(20000)));
report({ resumed, drainMs: Date.now() - started });
`);
  assert.equal(outcome.report.resumed, true, "the drain waits for the reply the resumer is carrying on");
  assert.ok(outcome.report.drainMs < PROMPTLY_MS, `the drains end with their work, after ${outcome.report.drainMs} ms`);
  assertExitsPromptly(outcome, "draining the loops");
});

test("a command that ends within its foreground wait leaves no timer to keep a closed server's process alive", async (context) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-no-timer-"));
  context.after(() => rm(outputDir, { recursive: true, force: true }));
  const outcome = await runChild(`
const commands = createCommands({ resources, systemContext, executor: localExecutor(), outputDir: ${JSON.stringify(outputDir)} });
const result = await commands.run({ conversationId: 1, cwd: ${JSON.stringify(outputDir)}, script: "echo done" });
await closeServer();
report({ status: result.status, output: result.output });
`);
  assert.deepEqual([outcome.report.status, outcome.report.output.trim()], ["done", "done"], "the command ran to its end in the foreground");
  assertExitsPromptly(outcome, "a command that ended before its 2-minute foreground wait");
});
