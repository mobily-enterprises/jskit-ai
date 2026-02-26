import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const SHELL_PACKS = ["core-shell", "web-shell", "api-shell"];

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

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-shells-"));

  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "shell-app",
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

for (const packId of SHELL_PACKS) {
  test(`shell pack ${packId} can add, doctor, and remove cleanly`, async () => {
    await withTempApp(async (appRoot) => {
      const addResult = runCli({
        cwd: appRoot,
        args: ["add", packId, "--no-install"]
      });
      assert.equal(addResult.status, 0, addResult.stderr);
      assert.match(addResult.stdout, new RegExp(`Added pack ${packId}`));

      const doctorResult = runCli({
        cwd: appRoot,
        args: ["doctor"]
      });
      assert.equal(doctorResult.status, 0, doctorResult.stderr);

      const removeResult = runCli({
        cwd: appRoot,
        args: ["remove", packId]
      });
      assert.equal(removeResult.status, 0, removeResult.stderr);
      assert.match(removeResult.stdout, new RegExp(`Removed pack ${packId}`));

      await assert.rejects(access(path.join(appRoot, ".jskit/lock.json")), /ENOENT/);
    });
  });
}
