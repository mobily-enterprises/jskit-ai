import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsPromises, { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION, CODEX_APP_SERVER_PROVIDER_ID, codexAppServerTerminalEnvHash,
  writeCodexAppServerMetadata
} from "../src/server/conversation/codexProcess.js";
import { createCodexAppServerRuntime } from "../src/server/conversation/codexRuntime.js";
import { createConversationProcessIdentity } from "../src/server/conversation/processIdentity.js";

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

/**
 * Stop options whose inspector finds the group exact until a signal is sent, then each of `afterSignal` in turn,
 * keeping the last; with every status it gave and every signal sent.
 */
function scriptedStop(afterSignal) {
  const statuses = [...afterSignal];
  const seen = [];
  const signals = [];
  const options = {
    async processIdentityInspector() {
      const status = signals.length === 0 ? "exact" : (statuses.length > 1 ? statuses.shift() : statuses[0]);
      seen.push(status);
      return { processGroupIds: status === "exact" ? [LEADER] : [], status };
    },
    signalProcessGroup(processGroupId, signal) {
      signals.push([processGroupId, signal]);
      return true;
    }
  };
  return { options, seen, signals };
}

test("a group caught mid-exit after SIGTERM is waited out, never reported as an unverified stop", async () => {
  // A member mid-exit has released its memory, so its environment reads EACCES: the group looks ambiguous for a few
  // milliseconds after SIGTERM, then is gone.
  const { options, seen, signals } = scriptedStop(["exact", "exact", "ambiguous", "ambiguous", "absent"]);
  const stopped = await createConversationProcessIdentity().stop(metadata(), options);
  assert.deepEqual(stopped, {
    descendantProcessGroups: [],
    identityStatus: "absent",
    pid: LEADER,
    processExitVerified: true,
    signaledProcessGroups: [LEADER],
    stopped: true
  });
  assert.deepEqual(signals, [[LEADER, "SIGTERM"]]);
  assert.deepEqual(seen.slice(-3), ["ambiguous", "ambiguous", "absent"]);
});

test("a group still ambiguous at the exit deadline is an unverified stop, never exit proof", async () => {
  const { options, seen, signals } = scriptedStop(["exact", "exact", "ambiguous"]);
  const stopped = await createConversationProcessIdentity().stop(metadata(), { ...options, termTimeoutMs: 300 });
  assert.deepEqual(stopped, {
    descendantProcessGroups: [],
    identityStatus: "ambiguous",
    pid: LEADER,
    processExitVerified: false,
    signaledProcessGroups: [LEADER],
    stopped: false
  });
  // It inspected again until the deadline; an ambiguous group is neither proof of exit nor an exact group to kill.
  assert.ok(seen.filter((status) => status === "ambiguous").length > 1, seen.join(", "));
  assert.deepEqual(signals, [[LEADER, "SIGTERM"]]);
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

/**
 * Runs `work` while node:fs/promises' `name` is `replacement`, which is given the original function first,
 * as the Linux inspection reads /proc through that module.
 */
async function withFsPromises(name, replacement, work) {
  const original = fsPromises[name];
  fsPromises[name] = (...args) => replacement(original, ...args);
  syncBuiltinESMExports();
  try {
    return await work();
  } finally {
    fsPromises[name] = original;
    syncBuiltinESMExports();
  }
}

/** An owned real process group and its captured identity. */
async function ownedLinuxGroup(t) {
  const token = randomUUID();
  const child = await liveGroup(t, { [TOKEN_ENV]: token, [HASH_ENV]: commandHash });
  const identity = createConversationProcessIdentity();
  const captured = await identity.capture({ commandHash, pid: child.pid, runtimeToken: token });
  return { child, identity, owned: { pid: child.pid, processState: "running", processIdentity: captured } };
}

/** The pid of a process that has exited and been reaped, so /proc no longer has it. */
async function reapedPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  return child.pid;
}

function processGroupIsRunning(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

const linuxOnly = { skip: process.platform !== "linux" };

test("a /proc listing broken by a process reaped mid-listing does not make a live group look exited", linuxOnly, async (t) => {
  const { child, identity, owned } = await ownedLinuxGroup(t);
  const reaped = await reapedPid();
  // /proc lists a process being reaped mid-listing without an entry type. A listing asked for entry types then
  // lstat's that entry itself, and with the process gone the lstat's ENOENT rejects the whole listing.
  const stopped = await withFsPromises("readdir", async (readdir, target, options) => {
    if (String(target) === "/proc" && options?.withFileTypes) {
      await lstat(`/proc/${reaped}`);
    }
    return readdir(target, options);
  }, () => identity.stop(owned, { termTimeoutMs: 2000 }));
  assert.equal(stopped.stopped, true, JSON.stringify(stopped));
  assert.equal(stopped.processExitVerified, true);
  assert.deepEqual(stopped.signaledProcessGroups, [child.pid]);
});

test("a /proc table that cannot be listed is ambiguous, never exit proof", linuxOnly, async (t) => {
  const { child, identity, owned } = await ownedLinuxGroup(t);
  const tooManyFiles = Object.assign(new Error("EMFILE: too many open files, scandir '/proc'"), { code: "EMFILE" });
  const [inspection, stopped] = await withFsPromises("readdir", async (readdir, target, options) => {
    if (String(target) === "/proc") {
      throw tooManyFiles;
    }
    return readdir(target, options);
  }, async () => [
    await identity.inspect(owned),
    await identity.stop(owned, { processIdentitySettleTimeoutMs: 50 })
  ]);
  // The refusal names why: the listing's own error.
  const processTableError = tooManyFiles.message;
  assert.deepEqual(inspection, { processGroupIds: [], processTableError, status: "ambiguous" });
  assert.deepEqual(stopped, { identityStatus: "ambiguous", processExitVerified: false, processTableError, stopped: false });
  assert.equal(processGroupIsRunning(child.pid), true);
  assert.deepEqual(await identity.inspect(owned), { processGroupIds: [child.pid], status: "exact" });
});

test("a live member whose stat cannot be read keeps its group from looking exited", linuxOnly, async (t) => {
  const { child, identity, owned } = await ownedLinuxGroup(t);
  const failingStat = (code, pid) => async (readFile, target, ...rest) => {
    if (String(target) === `/proc/${pid}/stat`) {
      throw Object.assign(new Error(`${code}: /proc/${pid}/stat`), { code });
    }
    return readFile(target, ...rest);
  };
  const [inspection, stopped] = await withFsPromises("readFile", failingStat("EMFILE", child.pid), async () => [
    await identity.inspect(owned),
    await identity.stop(owned, { processIdentitySettleTimeoutMs: 50 })
  ]);
  const processTableError = `EMFILE: /proc/${child.pid}/stat`;
  assert.deepEqual(inspection, { processGroupIds: [], processTableError, status: "ambiguous" });
  assert.deepEqual(stopped, { identityStatus: "ambiguous", processExitVerified: false, processTableError, stopped: false });
  assert.equal(processGroupIsRunning(child.pid), true);
  // A process that has gone (ENOENT, ESRCH) or that hidepid hides from this user (EACCES, EPERM) is left out as before.
  for (const code of ["ENOENT", "ESRCH", "EACCES", "EPERM"]) {
    assert.deepEqual(
      await withFsPromises("readFile", failingStat(code, process.pid), () => identity.inspect(owned)),
      { processGroupIds: [child.pid], status: "exact" },
      code
    );
  }
});

test("a runtime process whose environment cannot be read is refused, never left out of the scan", linuxOnly, async (t) => {
  const { child, identity, owned } = await ownedLinuxGroup(t);
  // A process of the same runtime in a process group of its own, as one that called setsid is.
  const member = await liveGroup(t, { [TOKEN_ENV]: owned.processIdentity.runtimeToken, [HASH_ENV]: commandHash });
  const failingEnvironment = (code, pid) => async (readFile, target, ...rest) => {
    if (String(target) === `/proc/${pid}/environ`) {
      throw Object.assign(new Error(`${code}: /proc/${pid}/environ`), { code });
    }
    return readFile(target, ...rest);
  };
  const [inspection, stopped] = await withFsPromises("readFile", failingEnvironment("EMFILE", member.pid), async () => [
    await identity.inspect(owned),
    await identity.stop(owned, { processIdentitySettleTimeoutMs: 50, termTimeoutMs: 500 })
  ]);
  // Left out, the member's group went unsignalled and the stop proved an exit while it ran.
  const processTableError = `EMFILE: /proc/${member.pid}/environ`;
  assert.deepEqual(inspection, { processGroupIds: [], processTableError, status: "ambiguous" });
  assert.deepEqual(stopped, { identityStatus: "ambiguous", processExitVerified: false, processTableError, stopped: false });
  assert.equal(processGroupIsRunning(child.pid), true);
  assert.equal(processGroupIsRunning(member.pid), true);
  const readable = await identity.inspect(owned);
  assert.deepEqual([readable.status, readable.processGroupIds.toSorted()], ["exact", [child.pid, member.pid].toSorted()]);
  // A process that has gone (ENOENT, ESRCH) is left out; one whose environment only its own user may read (EACCES,
  // EPERM) is another user's, which outside the leader's group is not this runtime's.
  for (const code of ["ENOENT", "ESRCH", "EACCES", "EPERM"]) {
    assert.deepEqual(
      await withFsPromises("readFile", failingEnvironment(code, process.pid), () => identity.inspect(owned)),
      readable,
      code
    );
  }
});

/** A /proc stat line's fields after the command: [0] is the state, [17] num_threads (field 20). */
function statFields(text) {
  return text.slice(text.lastIndexOf(")") + 2).split(" ");
}

/**
 * The stat line the kernel shows for a thread group leader whose main thread called pthread_exit while `threads`
 * threads stay counted: state Z with that num_threads. A process that really is a zombie keeps its own line.
 */
function zombieLeaderStat(text, threads) {
  const fields = statFields(text);
  if (fields[0] === "Z") {
    return text;
  }
  fields[0] = "Z";
  fields[17] = String(threads);
  return `${text.slice(0, text.lastIndexOf(")") + 2)}${fields.join(" ")}`;
}

test("a process whose main thread exited while its other threads run is identified and stopped, never taken as ended", linuxOnly, async (t) => {
  const { child, identity, owned } = await ownedLinuxGroup(t);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve(signal)));
  // Such a process's leader shows Z with its threads still counted, and its environment, the leader's memory released,
  // only to root (EACCES). Its other threads, in /proc/<pid>/task, run on with the process's environment.
  const asZombieLeader = (threads) => async (readFile, target, ...rest) => {
    if (String(target) === `/proc/${child.pid}/environ`) {
      throw Object.assign(new Error(`EACCES: /proc/${child.pid}/environ`), { code: "EACCES" });
    }
    const text = await readFile(target, ...rest);
    return String(target) === `/proc/${child.pid}/stat` ? zombieLeaderStat(text, threads) : text;
  };
  // A Z leader alone in its thread group (num_threads 1) has ended, as before: nothing is signalled.
  assert.deepEqual(
    await withFsPromises("readFile", asZombieLeader(1), () => identity.stop(owned, { termTimeoutMs: 500 })),
    { identityStatus: "mismatch", processExitVerified: true, stopped: false }
  );
  assert.equal(processGroupIsRunning(child.pid), true);
  // With a second thread counted it runs on: exact from a live thread's environment, and stopped like any process.
  const [inspection, stopped] = await withFsPromises("readFile", asZombieLeader(2), async () => [
    await identity.inspect(owned),
    await identity.stop(owned, { termTimeoutMs: 2000 })
  ]);
  assert.deepEqual(inspection, { processGroupIds: [child.pid], status: "exact" });
  assert.equal(stopped.stopped, true, JSON.stringify(stopped));
  assert.equal(stopped.processExitVerified, true);
  assert.deepEqual(stopped.signaledProcessGroups, [child.pid]);
  assert.equal(await exited, "SIGTERM");
});

// The main thread calls pthread_exit while a second thread waits for ever: the process runs on with its leader a zombie.
const ZOMBIE_LEADER_SOURCE = `#include <pthread.h>
#include <unistd.h>
static void *wait_for_ever(void *unused) { (void) unused; for (;;) pause(); return NULL; }
int main(void) {
  pthread_t thread;
  if (pthread_create(&thread, NULL, wait_for_ever, NULL) != 0) return 1;
  pthread_exit(NULL);
}
`;

test("a real process whose main thread called pthread_exit is stopped with its running thread", linuxOnly, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "jskit-zombie-leader-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const program = join(dir, "zombie-leader");
  await writeFile(`${program}.c`, ZOMBIE_LEADER_SOURCE);
  const compiled = await new Promise((resolve) => execFile("cc", ["-pthread", "-o", program, `${program}.c`], resolve));
  if (compiled?.code === "ENOENT") {
    t.skip("no C compiler (cc) to build the pthread_exit program");
    return;
  }
  assert.ifError(compiled);
  const token = randomUUID();
  const child = spawn(program, [], { detached: true, stdio: "ignore", env: { ...process.env, [TOKEN_ENV]: token, [HASH_ENV]: commandHash } });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve(signal)));
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  const identity = createConversationProcessIdentity();
  const owned = {
    pid: child.pid,
    processState: "running",
    processIdentity: await identity.capture({ commandHash, pid: child.pid, runtimeToken: token })
  };
  let fields = [];
  for (const deadline = Date.now() + 5000; Date.now() < deadline; await delay(10)) {
    fields = statFields(await readFile(`/proc/${child.pid}/stat`, "utf8"));
    if (fields[0] === "Z") {
      break;
    }
  }
  // The kernel's view: the leader is Z, both threads counted, and the process is there to signal.
  assert.deepEqual([fields[0], fields[17]], ["Z", "2"]);
  assert.equal(processGroupIsRunning(child.pid), true);
  assert.deepEqual(await identity.inspect(owned), { processGroupIds: [child.pid], status: "exact" });
  const stopped = await identity.stop(owned, { termTimeoutMs: 2000 });
  assert.equal(stopped.stopped, true, JSON.stringify(stopped));
  assert.equal(stopped.processExitVerified, true);
  assert.deepEqual(stopped.signaledProcessGroups, [child.pid]);
  assert.equal(await exited, "SIGTERM");
});

test("a Codex runtime whose process table cannot be read is neither reused nor replaced", linuxOnly, async (t) => {
  const { child, owned } = await ownedLinuxGroup(t);
  const runtimeDir = await mkdtemp(join(tmpdir(), "jskit-codex-identity-"));
  t.after(() => rm(runtimeDir, { force: true, recursive: true }));
  const compatibility = { attachmentHostRoot: "/attachments", executionContextHash: "context", runtimesHash: "runtimes" };
  const socketPath = join(runtimeDir, "app-server.sock");
  const metadata = {
    accountIdentitySignature: "account",
    attachmentHostRoot: compatibility.attachmentHostRoot,
    authStateSignature: "generation",
    endpoint: `unix://${socketPath}`,
    executionContextHash: compatibility.executionContextHash,
    executionId: "11111111-1111-4111-8111-111111111112",
    executionMode: "interactive",
    historyAdapterBaseUrl: `http://127.0.0.1:23456/${owned.processIdentity.runtimeToken}/v2`,
    pid: child.pid,
    processCwd: runtimeDir,
    processIdentity: owned.processIdentity,
    processState: "running",
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    runtimeDir,
    runtimesHash: compatibility.runtimesHash,
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    socketPath,
    terminalEnvHash: codexAppServerTerminalEnvHash({}),
    toolHomeSource: "",
    transport: "unix"
  };
  await writeCodexAppServerMetadata(runtimeDir, metadata);
  const recorded = await readFile(join(runtimeDir, "runtime.json"), "utf8");
  const executions = [];
  const runtime = createCodexAppServerRuntime({
    credentials: { identity: async () => "account", generation: async () => "generation", assertCurrent: async () => {} },
    execution: {
      async run(request) { executions.push(["run", request]); return { ok: false, output: "a replacement was started" }; },
      async stop(executionId) { executions.push(["stop", executionId]); return { ok: false }; }
    }
  });
  const ensure = (options = {}) => runtime.ensure({ codexCommand: process.execPath, compatibility, env: {}, runtimeDir, ...options });

  // A group whose members are still settling stays reusable, as a host's runtime relies on.
  const settling = await ensure({ processIdentityInspector: async () => ({ processGroupIds: [child.pid], status: "ambiguous" }) });
  assert.deepEqual([settling.reused, settling.runtimeStatus], [true, "suspect"]);

  const tooManyFiles = Object.assign(new Error("EMFILE: too many open files, scandir '/proc'"), { code: "EMFILE" });
  const error = await withFsPromises("readdir", async (readdir, target, ...rest) => {
    if (String(target) === "/proc") {
      throw tooManyFiles;
    }
    return readdir(target, ...rest);
  }, () => ensure().then((reused) => assert.fail(`an unchecked runtime was reused as ${reused.runtimeStatus}`), (failure) => failure));
  assert.equal(error.code, "codex_app_server_process_identity_unreadable");
  assert.equal(error.retryable, true);
  assert.match(error.message, /could not check that it is its own/u);
  assert.ok(error.message.includes(tooManyFiles.message), error.message);
  assert.deepEqual(executions, []);
  assert.equal(processGroupIsRunning(child.pid), true);
  assert.equal(await readFile(join(runtimeDir, "runtime.json"), "utf8"), recorded);
});
