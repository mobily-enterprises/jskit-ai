import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const WAVE_D_BUNDLES = [
  "assistant-base",
  "assistant-openai",
  "billing-base",
  "billing-stripe",
  "billing-paddle",
  "billing-worker"
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

async function readJsonFile(absolutePath) {
  const source = await readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function withTempApp(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-wave-d-"));
  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "wave-d-app",
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

for (const bundleId of WAVE_D_BUNDLES) {
  test(`domain wave D bundle ${bundleId} installs with db provider and passes doctor`, async () => {
    await withTempApp(async (appRoot) => {
      const addDb = runCli({
        cwd: appRoot,
        args: ["add", "bundle", "db-mysql", "--no-install"]
      });
      assert.equal(addDb.status, 0, addDb.stderr);

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

test("assistant-base enforces transcript db-provider capability", async () => {
  await withTempApp(async (appRoot) => {
    const addAssistant = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "assistant-base", "--no-install"]
    });
    assert.notEqual(addAssistant.status, 0);
    assert.match(addAssistant.stderr, /\[capability-violation\]/);
    assert.match(addAssistant.stderr, /db-provider/i);
  });
});

test("billing bundles can install stripe and paddle providers in same app", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install"]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addStripe = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "billing-stripe", "--no-install"]
    });
    assert.equal(addStripe.status, 0, addStripe.stderr);

    const addPaddle = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "billing-paddle", "--no-install"]
    });
    assert.equal(addPaddle.status, 0, addPaddle.stderr);

    const lock = await readJsonFile(path.join(appRoot, ".jskit", "lock.json"));
    assert.ok(lock.installedPackages["@jskit-ai/billing-provider-paddle"]);
    assert.ok(lock.installedPackages["@jskit-ai/billing-provider-stripe"]);
  });
});

test("saas-full fails fast without provider intents", async () => {
  await withTempApp(async (appRoot) => {
    const addSaas = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "saas-full", "--no-install"]
    });
    assert.notEqual(addSaas.status, 0);
    assert.match(addSaas.stderr, /\[capability-violation\]/);
    assert.match(addSaas.stderr, /db-provider/i);
    assert.match(addSaas.stderr, /install one provider bundle first/i);
  });
});
