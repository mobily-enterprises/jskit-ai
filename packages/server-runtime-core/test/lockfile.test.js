import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLockFromApp } from "../src/server/lib/lockfile.js";

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-lockfile-"));
  try {
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

test("readLockFromApp reads lock payload and absolute lock path", async () => {
  await withTempApp(async (appRoot) => {
    const lockDir = path.join(appRoot, ".jskit");
    const lockPath = path.join(lockDir, "lock.json");
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ lockVersion: 3, installedPackages: {} }, null, 2)}\n`, "utf8");

    const result = await readLockFromApp({ appRoot });
    assert.equal(result.lock.lockVersion, 3);
    assert.equal(result.lockPath, lockPath);
  });
});

test("readLockFromApp throws when lock file is missing", async () => {
  await withTempApp(async (appRoot) => {
    await assert.rejects(async () => readLockFromApp({ appRoot }), /Lock file not found:/);
  });
});
