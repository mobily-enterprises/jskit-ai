import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));

const REQUIRES_DB = new Set([
  "security-audit",
  "assistant-base",
  "assistant-openai",
  "billing-base",
  "billing-stripe",
  "billing-paddle",
  "billing-worker",
  "chat-base",
  "social-base",
  "users-profile",
  "community-suite",
  "workspace-core",
  "workspace-console",
  "workspace-admin-suite"
]);

const REQUIRES_AUTH = new Set([
  "workspace-core",
  "workspace-console",
  "workspace-admin-suite"
]);

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
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-bundles-"));
  try {
    await writeJsonFile(path.join(appRoot, "package.json"), {
      name: "bundle-catalog-app",
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

function getRequiredOptionArgs(pack) {
  const args = [];
  for (const [optionName, optionSchema] of Object.entries(pack.options || {})) {
    if (!optionSchema.required) {
      continue;
    }
    const value = Array.isArray(optionSchema.values) && optionSchema.values.length > 0
      ? optionSchema.values[0]
      : "default";
    args.push(`--${optionName}`, value);
  }
  return args;
}

test("jskit list --json returns enriched bundle metadata", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list", "--json"]
    });
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    const dbPack = payload.available.find((entry) => entry.packId === "db");
    assert.ok(dbPack, "Expected db pack in list output.");
    assert.ok(Number.isInteger(dbPack.packageCount));
    assert.ok(Array.isArray(dbPack.packages));
    assert.ok(Array.isArray(dbPack.requiredCapabilities));
    assert.ok(Array.isArray(dbPack.providedCapabilities));
    assert.ok(dbPack.options && typeof dbPack.options === "object");
  });
});

test("every bundle add/update/remove lifecycle succeeds with prerequisites", async () => {
  const available = await (async () => {
    let packs = [];
    await withTempApp(async (appRoot) => {
      const listResult = runCli({
        cwd: appRoot,
        args: ["list", "--json"]
      });
      assert.equal(listResult.status, 0, listResult.stderr);
      packs = JSON.parse(listResult.stdout).available;
    });
    return packs;
  })();

  for (const pack of available) {
    if (pack.packId === "db") {
      continue;
    }

    await withTempApp(async (appRoot) => {
      if (REQUIRES_DB.has(pack.packId)) {
        const addDb = runCli({
          cwd: appRoot,
          args: ["add", "db", "--provider", "mysql", "--no-install"]
        });
        assert.equal(addDb.status, 0, addDb.stderr);
      }

      if (REQUIRES_AUTH.has(pack.packId)) {
        const addAuth = runCli({
          cwd: appRoot,
          args: ["add", "auth-base", "--no-install"]
        });
        assert.equal(addAuth.status, 0, addAuth.stderr);
      }

      const optionArgs = getRequiredOptionArgs(pack);
      const addArgs = ["add", pack.packId, "--no-install", ...optionArgs];
      const updateArgs = ["update", pack.packId, "--no-install", ...optionArgs];

      const addResult = runCli({ cwd: appRoot, args: addArgs });
      assert.equal(addResult.status, 0, `add failed for ${pack.packId}: ${addResult.stderr}`);

      const updateResult = runCli({ cwd: appRoot, args: updateArgs });
      assert.equal(updateResult.status, 0, `update failed for ${pack.packId}: ${updateResult.stderr}`);

      const removeResult = runCli({ cwd: appRoot, args: ["remove", pack.packId] });
      assert.equal(removeResult.status, 0, `remove failed for ${pack.packId}: ${removeResult.stderr}`);
    });
  }
});

test("bundle conflict checks fail for impossible capability combinations", async () => {
  await withTempApp(async (appRoot) => {
    const listResult = runCli({
      cwd: appRoot,
      args: ["list", "--json"]
    });
    assert.equal(listResult.status, 0, listResult.stderr);
    const securityWithoutDb = runCli({
      cwd: appRoot,
      args: ["add", "security-audit", "--no-install"]
    });
    assert.notEqual(securityWithoutDb.status, 0);
    assert.match(securityWithoutDb.stderr, /\[capability-violation\]/);

    const workspaceWithoutAuth = runCli({
      cwd: appRoot,
      args: ["add", "workspace-console", "--no-install"]
    });
    assert.notEqual(workspaceWithoutAuth.status, 0);
    assert.match(workspaceWithoutAuth.stderr, /\[capability-violation\]/);
  });
});
