import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const WAVE_B_BUNDLES = ["chat-base", "social-base", "users-profile", "community-suite"];
const WAVE_B_REQUIRES_AUTH_PROVIDER = new Set(["chat-base", "community-suite"]);

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

for (const bundleId of WAVE_B_BUNDLES) {
  test(`domain wave B bundle ${bundleId} installs cleanly`, async () => {
    await withTempApp(async (appRoot) => {
      const addDb = runCli({
        cwd: appRoot,
        args: ["add", "bundle", "db-mysql", "--no-install"]
      });
      assert.equal(addDb.status, 0, addDb.stderr);

      if (WAVE_B_REQUIRES_AUTH_PROVIDER.has(bundleId)) {
        const addAuthProvider = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "auth-supabase", "--no-install"]
        });
        assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);
      }

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

test("removing optional chat client package keeps doctor clean", async () => {
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

    for (const bundleId of ["chat-base", "social-base", "users-profile"]) {
      const addBundle = runCli({
        cwd: appRoot,
        args: ["add", "bundle", bundleId, "--no-install"]
      });
      assert.equal(addBundle.status, 0, addBundle.stderr);
    }

    const removeChatClient = runCli({
      cwd: appRoot,
      args: ["remove", "package", "@jskit-ai/chat-client-element"]
    });
    assert.equal(removeChatClient.status, 0, removeChatClient.stderr);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);
  });
});
