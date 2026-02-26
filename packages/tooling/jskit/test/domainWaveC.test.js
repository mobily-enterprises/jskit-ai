import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const WAVE_C_PACKS = ["workspace-core", "workspace-console", "workspace-admin-suite"];

function runCli({ cwd, args = [] }) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8"
  });
}

async function writeJsonFile(absolutePath, value) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-wave-c-"));
  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "wave-c-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        start: "jskit-app-scripts start"
      },
      dependencies: {
        "@jskit-ai/app-scripts": "0.1.0"
      }
    });
    await writeFile(path.join(appRoot, "Procfile"), "web: npm run start\n", "utf8");
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

for (const packId of WAVE_C_PACKS) {
  test(`domain wave C pack ${packId} installs with db+auth base and passes doctor`, async () => {
    await withTempApp(async (appRoot) => {
      const addDb = runCli({
        cwd: appRoot,
        args: ["add", "db", "--provider", "mysql", "--no-install"]
      });
      assert.equal(addDb.status, 0, addDb.stderr);

      const addAuth = runCli({
        cwd: appRoot,
        args: ["add", "auth-base", "--no-install"]
      });
      assert.equal(addAuth.status, 0, addAuth.stderr);

      const addPack = runCli({
        cwd: appRoot,
        args: ["add", packId, "--no-install"]
      });
      assert.equal(addPack.status, 0, addPack.stderr);

      const doctorResult = runCli({
        cwd: appRoot,
        args: ["doctor"]
      });
      assert.equal(doctorResult.status, 0, doctorResult.stderr);
    });
  });
}

test("removing workspace-admin-suite preserves db/auth packs and keeps doctor clean", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addAuth = runCli({
      cwd: appRoot,
      args: ["add", "auth-base", "--no-install"]
    });
    assert.equal(addAuth.status, 0, addAuth.stderr);

    const addSuite = runCli({
      cwd: appRoot,
      args: ["add", "workspace-admin-suite", "--no-install"]
    });
    assert.equal(addSuite.status, 0, addSuite.stderr);

    const removeSuite = runCli({
      cwd: appRoot,
      args: ["remove", "workspace-admin-suite"]
    });
    assert.equal(removeSuite.status, 0, removeSuite.stderr);

    const lock = await readJsonFile(path.join(appRoot, ".jskit", "lock.json"));
    assert.ok(lock.installedPacks.db);
    assert.ok(lock.installedPacks["auth-base"]);
    assert.equal(lock.installedPacks["workspace-admin-suite"], undefined);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);
  });
});
