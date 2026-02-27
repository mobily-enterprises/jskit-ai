import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const WAVE_C_BUNDLES = ["workspace-core", "workspace-console", "workspace-admin-suite"];

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

for (const bundleId of WAVE_C_BUNDLES) {
  test(`domain wave C bundle ${bundleId} installs with db+auth base and passes doctor`, async () => {
    await withTempApp(async (appRoot) => {
      const addDb = runCli({
        cwd: appRoot,
        args: ["add", "bundle", "db-mysql", "--no-install"]
      });
      assert.equal(addDb.status, 0, addDb.stderr);

      const addAuthProvider = runCli({
        cwd: appRoot,
        args: ["add", "bundle", "auth-supabase", "--no-install"]
      });
      assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);

      const addAuth = runCli({
        cwd: appRoot,
        args: ["add", "bundle", "auth-base", "--no-install"]
      });
      assert.equal(addAuth.status, 0, addAuth.stderr);

      const addBundle = runCli({
        cwd: appRoot,
        args: ["add", "bundle", bundleId, "--no-install"]
      });
      assert.equal(addBundle.status, 0, addBundle.stderr);

      const doctorResult = runCli({
        cwd: appRoot,
        args: ["doctor"]
      });
      assert.equal(doctorResult.status, 0, doctorResult.stderr);
    });
  });
}

test("removing required workspace package is blocked by dependency checks", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install"]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addAuthProvider = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-supabase", "--no-install"]
    });
    assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);

    const addAuth = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "auth-base", "--no-install"]
    });
    assert.equal(addAuth.status, 0, addAuth.stderr);

    const addSuite = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "workspace-admin-suite", "--no-install"]
    });
    assert.equal(addSuite.status, 0, addSuite.stderr);

    const removeRequired = runCli({
      cwd: appRoot,
      args: ["remove", "package", "@jskit-ai/workspace-console-core"]
    });
    assert.notEqual(removeRequired.status, 0);
    assert.match(removeRequired.stderr, /\[unresolved-dependency\]/);
  });
});
