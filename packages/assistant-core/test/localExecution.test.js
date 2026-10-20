import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createConversationProcessIdentity } from "../src/server/conversation/localExecution.js";

const TOKEN_ENV = "JSKIT_EXECUTION_RUNTIME_TOKEN";
const HASH_ENV = "JSKIT_EXECUTION_COMMAND_HASH";
const runtimeToken = "0b6c8f8e-3f7a-4c1e-9d2b-5a4e6f7a8b9c";
const commandHash = "abcdef012345";
// Process-group ids far above any live pid, so liveness probes find nothing.
const LEADER = 9_000_001;
const CHILD = 9_000_002;
const STARTED = "Wed Oct 21 10:00:00 2026";
const STARTED_SECONDS = String(Date.UTC(2026, 9, 21, 10, 0, 0) / 1000);
const uid = process.getuid?.() ?? 0;

const IDENTITY_ENV = `PATH=/usr/bin ${TOKEN_ENV}=${runtimeToken} ${HASH_ENV}=${commandHash}`;

function row(pid, pgid, { owner = uid, stat = "Ss", started = STARTED, args = "/usr/bin/codex app-server", env = IDENTITY_ENV } = {}) {
  return { pid, pgid, owner, stat, started, args, env };
}

/** Renders the three darwin listings: every process, then the user's commands without and with `-E`. */
function psListing(rows, args) {
  if (args[0] === "-ax") {
    return rows.map(({ pid, pgid, owner, stat, started }) =>
      `${String(pid).padStart(7)} ${String(pgid).padStart(7)} ${String(owner).padStart(5)} ${stat.padEnd(4)} ${started}`).join("\n");
  }
  const withEnvironment = args[0] === "-E";
  return rows.filter(({ owner }) => owner === uid).map(({ pid, args: command, env }) =>
    `${String(pid).padStart(7)} ${command}${withEnvironment && env ? ` ${env}` : ""}`).join("\n");
}

function darwinIdentity(table, captureOutput = `${LEADER} ${STARTED}`) {
  const calls = [];
  const identity = createConversationProcessIdentity({
    platform: "darwin",
    async ps(args) {
      calls.push(args);
      if (args.includes("-p")) return captureOutput;
      if (table instanceof Error) throw table;
      return psListing(table, args);
    }
  });
  return { calls, identity };
}

const metadata = (overrides = {}) => ({
  pid: LEADER,
  processState: "running",
  processIdentity: { commandHash, platform: "darwin", runtimeToken, startTimeTicks: STARTED_SECONDS, version: 1, ...overrides }
});

test("darwin capture records the group leader's ps start time as epoch seconds", async () => {
  const { calls, identity } = darwinIdentity([]);
  const captured = await identity.capture({ commandHash, pid: LEADER, runtimeToken });
  assert.deepEqual(captured, { commandHash, platform: "darwin", runtimeToken, startTimeTicks: STARTED_SECONDS, version: 1 });
  assert.deepEqual(calls, [["-o", "pgid=,lstart=", "-p", String(LEADER)]]);
  assert.equal(identity.isValid(captured), true);
});

test("darwin capture parses the padded BSD ps `pgid= lstart=` line", async () => {
  // BSD ps prints lstart with strftime("%c"), which space-pads single-digit days in the C locale.
  const { identity } = darwinIdentity([], `   ${LEADER} Tue Oct  7 09:05:03 2026\n`);
  const captured = await identity.capture({ commandHash, pid: LEADER, runtimeToken });
  assert.equal(captured.startTimeTicks, String(Date.UTC(2026, 9, 7, 9, 5, 3) / 1000));
});

test("darwin capture refuses a non-leader, an unparsable line or a failed ps", async (t) => {
  for (const [name, output] of [
    ["another group", `${CHILD} ${STARTED}`],
    ["a non-numeric group", `pgid ${STARTED}`],
    ["an unknown start format", `${LEADER} 2026-10-21T10:00:00Z`],
    ["empty output", ""]
  ]) {
    await t.test(name, async () => {
      const { identity } = darwinIdentity([], output);
      await assert.rejects(identity.capture({ commandHash, pid: LEADER, runtimeToken }),
        { code: "native_process_identity_unavailable" });
    });
  }
});

test("darwin inspection is exact only when every group member carries the identity", async () => {
  const { calls, identity } = darwinIdentity([
    row(LEADER, LEADER),
    row(CHILD, CHILD),
    row(9_000_003, 9_000_003, { env: "" })
  ]);
  assert.deepEqual(await identity.inspect(metadata()), { processGroupIds: [LEADER, CHILD], status: "exact" });
  assert.deepEqual(calls, [
    ["-ax", "-o", "pid=,pgid=,uid=,stat=,lstart="],
    ["-x", "-U", String(uid), "-ww", "-o", "pid=,command="],
    ["-E", "-x", "-U", String(uid), "-ww", "-o", "pid=,command="]
  ]);
});

test("darwin inspection keeps the absent, mismatch and ambiguous outcomes", async (t) => {
  const cases = [
    ["no process in the group", [], {}, "absent"],
    ["zombies are ignored", [row(LEADER, LEADER, { stat: "Z" })], {}, "absent"],
    ["an unrelated process reuses the group", [row(LEADER, LEADER, { env: "PATH=/usr/bin" })], {}, "mismatch"],
    ["the token only in the arguments", [row(LEADER, LEADER, {
      args: `/usr/bin/env -i ${TOKEN_ENV}=${runtimeToken} ${HASH_ENV}=${commandHash} codex`, env: "PATH=/usr/bin"
    })], {}, "mismatch"],
    ["a hidden environment", [row(LEADER, LEADER, { env: "" })], {}, "ambiguous"],
    ["the token only in the arguments of a hidden environment", [row(LEADER, LEADER, {
      args: `/usr/bin/env ${TOKEN_ENV}=${runtimeToken} ${HASH_ENV}=${commandHash} codex`, env: ""
    })], {}, "ambiguous"],
    ["another runtime token", [row(LEADER, LEADER)], { runtimeToken: randomUUID() }, "mismatch"],
    ["the leader restarted", [row(LEADER, LEADER, { started: "Wed Oct 21 10:00:01 2026" })], {}, "ambiguous"],
    ["another user's process shares the group", [row(LEADER, LEADER), row(CHILD, LEADER, { owner: uid + 1 })], {}, "ambiguous"],
    ["another user's environment is not trusted", [row(LEADER, LEADER, { owner: uid + 1 })], {}, "ambiguous"],
    ["an unmarked member shares the group", [row(LEADER, LEADER), row(CHILD, LEADER, { env: "PATH=/usr/bin" })], {}, "ambiguous"],
    ["ps fails", new Error("ps unavailable"), {}, "ambiguous"],
    ["a Linux identity", [row(LEADER, LEADER)], { platform: "linux-proc" }, "ambiguous"]
  ];
  for (const [name, table, overrides, status] of cases) {
    await t.test(name, async () => {
      const { identity } = darwinIdentity(table);
      assert.equal((await identity.inspect(metadata(overrides))).status, status);
    });
  }
});

async function liveGroup(t, env) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true, stdio: "ignore", env: { ...process.env, ...env }
  });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  return child;
}

const nativePlatform = { linux: "linux-proc", darwin: "darwin" }[process.platform];

test("the host platform captures, inspects and stops a real owned process group", { skip: !nativePlatform }, async (t) => {
  const token = randomUUID();
  const child = await liveGroup(t, { [TOKEN_ENV]: token, [HASH_ENV]: commandHash });
  const identity = createConversationProcessIdentity();
  const captured = await identity.capture({ commandHash, pid: child.pid, runtimeToken: token });
  assert.equal(captured.platform, nativePlatform);
  const owned = { pid: child.pid, processState: "running", processIdentity: captured };
  assert.deepEqual(await identity.inspect(owned), { processGroupIds: [child.pid], status: "exact" });
  assert.equal((await identity.inspect({ ...owned, processIdentity: { ...captured, runtimeToken: randomUUID() } })).status, "mismatch");
  const stopped = await identity.stop(owned, { termTimeoutMs: 2000 });
  assert.equal(stopped.processExitVerified, true);
  assert.deepEqual(stopped.signaledProcessGroups, [child.pid]);
});
