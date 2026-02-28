import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const WAVE_A_BUNDLES = ["auth-base", "auth-supabase", "communications-base", "observability-base"];
const MYSQL_OPTION_ARGS = [
  "--db-host",
  "127.0.0.1",
  "--db-port",
  "3306",
  "--db-name",
  "app",
  "--db-user",
  "root",
  "--db-password",
  "secret"
];

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
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-wave-a-"));

  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "wave-a-app",
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

for (const bundleId of WAVE_A_BUNDLES) {
  test(`domain wave A bundle ${bundleId} installs cleanly`, async () => {
    await withTempApp(async (appRoot) => {
      if (bundleId === "auth-base") {
        const addAuthProvider = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "auth-supabase", "--no-install"]
        });
        assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);
      }

      const addResult = runCli({
        cwd: appRoot,
        args: ["add", "bundle", bundleId, "--no-install"]
      });
      assert.equal(addResult.status, 0, addResult.stderr);

      const doctorResult = runCli({
        cwd: appRoot,
        args: ["doctor"]
      });
      assert.equal(doctorResult.status, 0, doctorResult.stderr);
    });
  });
}

test("combined auth + observability + db install passes doctor", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
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

    const addObservability = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "observability-base", "--no-install"]
    });
    assert.equal(addObservability.status, 0, addObservability.stderr);

    const doctorResult = runCli({
      cwd: appRoot,
      args: ["doctor"]
    });
    assert.equal(doctorResult.status, 0, doctorResult.stderr);
  });
});
