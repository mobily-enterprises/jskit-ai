import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const WAVE_B_PACKS = ["chat-base", "social-base", "users-profile", "community-suite"];

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
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-wave-b-"));
  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "wave-b-app",
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

for (const packId of WAVE_B_PACKS) {
  test(`domain wave B pack ${packId} installs and removes cleanly`, async () => {
    await withTempApp(async (appRoot) => {
      const addDb = runCli({
        cwd: appRoot,
        args: ["add", "db", "--provider", "mysql", "--no-install"]
      });
      assert.equal(addDb.status, 0, addDb.stderr);

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

      const removePack = runCli({
        cwd: appRoot,
        args: ["remove", packId]
      });
      assert.equal(removePack.status, 0, removePack.stderr);
    });
  });
}

test("shared package ownership is preserved when removing chat-base from a combined install", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "db", "--provider", "mysql", "--no-install"]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    for (const packId of ["chat-base", "social-base", "users-profile"]) {
      const addPack = runCli({
        cwd: appRoot,
        args: ["add", packId, "--no-install"]
      });
      assert.equal(addPack.status, 0, addPack.stderr);
    }

    const removeChat = runCli({
      cwd: appRoot,
      args: ["remove", "chat-base"]
    });
    assert.equal(removeChat.status, 0, removeChat.stderr);

    const lock = await readJsonFile(path.join(appRoot, ".jskit", "lock.json"));
    assert.ok(lock.installedPacks["social-base"]);
    assert.ok(lock.installedPacks["users-profile"]);
    assert.equal(lock.installedPacks["chat-base"], undefined);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);
  });
});
