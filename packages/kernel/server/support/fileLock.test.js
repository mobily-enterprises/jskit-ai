import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tryAcquireExclusiveFileLock } from "./fileLock.js";

async function lockPathFor(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-file-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "state.lock");
}

function lockedElsewhere(lockPath) {
  return childProcess.spawnSync("/usr/bin/flock", ["--exclusive", "--nonblock", lockPath, "true"]).status === 1;
}

async function lineFrom(child) {
  const [chunk] = await once(child.stdout, "data");
  return String(chunk).trim();
}

test("an acquisition runs one short process, and none runs while its lock is held", async (t) => {
  const lockPath = await lockPathFor(t);
  const spawn = t.mock.method(childProcess, "spawn");

  const release = await tryAcquireExclusiveFileLock(lockPath);
  assert.equal(typeof release, "function");
  assert.equal(spawn.mock.callCount(), 1);
  assert.equal(spawn.mock.calls[0].result.exitCode, 0);
  assert.ok(lockedElsewhere(lockPath));

  // Another acquisition, from this process too, finds the lock held, at the cost of one more short process.
  assert.equal(await tryAcquireExclusiveFileLock(lockPath), null);
  assert.equal(spawn.mock.callCount(), 2);

  await release();
  await release();
  assert.ok(!lockedElsewhere(lockPath));
  const again = await tryAcquireExclusiveFileLock(lockPath);
  assert.equal(spawn.mock.callCount(), 3);
  await again();
});

test("a lock held by flock(1) on the same path, as maintenance scripts take it, keeps an acquisition out", async (t) => {
  const lockPath = await lockPathFor(t);
  const holder = childProcess.spawn("/usr/bin/flock", ["--exclusive", lockPath, "/bin/sh", "-c", "echo held; exec cat"], {
    stdio: ["pipe", "pipe", "inherit"]
  });
  assert.equal(await lineFrom(holder), "held");

  assert.equal(await tryAcquireExclusiveFileLock(lockPath), null);
  holder.stdin.end();
  await once(holder, "close");
  const release = await tryAcquireExclusiveFileLock(lockPath);
  assert.equal(typeof release, "function");
  await release();
});

test("a lock ends with the process holding it, however that process ends", async (t) => {
  const lockPath = await lockPathFor(t);
  const moduleUrl = new URL("./fileLock.js", import.meta.url).href;
  const holder = childProcess.spawn(process.execPath, ["--input-type=module", "--eval", `
    import { tryAcquireExclusiveFileLock } from ${JSON.stringify(moduleUrl)};
    const release = await tryAcquireExclusiveFileLock(process.env.LOCK_PATH);
    process.stdout.write(release ? "held\\n" : "busy\\n");
    process.stdin.resume();
  `], { env: { ...process.env, LOCK_PATH: lockPath }, stdio: ["pipe", "pipe", "inherit"] });
  t.after(() => holder.kill("SIGKILL"));
  assert.equal(await lineFrom(holder), "held");

  assert.equal(await tryAcquireExclusiveFileLock(lockPath), null);
  holder.kill("SIGKILL");
  await once(holder, "close");
  const release = await tryAcquireExclusiveFileLock(lockPath);
  assert.equal(typeof release, "function");
  await release();
});

test("a lock path must be a normalized absolute path that is not a symbolic link", async (t) => {
  const lockPath = await lockPathFor(t);
  await assert.rejects(tryAcquireExclusiveFileLock("state.lock", { errorCode: "lock_refused" }), { code: "lock_refused" });
  await writeFile(`${lockPath}.target`, "");
  await symlink(`${lockPath}.target`, lockPath);
  await assert.rejects(tryAcquireExclusiveFileLock(lockPath), { code: "ELOOP" });
});
