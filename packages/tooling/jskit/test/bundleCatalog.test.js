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
  "assistant",
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
  "workspace-admin-suite",
  "saas-full"
]);

const REQUIRES_AUTH = new Set(["workspace-core", "workspace-console", "workspace-admin-suite"]);
// Bundle IDs that require the assistant provider capability to be installed first.
const BUNDLES_REQUIRING_ASSISTANT_PROVIDER = new Set(["assistant", "saas-full"]);

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

test("jskit list --json returns enriched bundle and package metadata", async () => {
  await withTempApp(async (appRoot) => {
    const result = runCli({
      cwd: appRoot,
      args: ["list", "--json"]
    });
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    const dbMySqlBundle = payload.availableBundles.find((entry) => entry.bundleId === "db-mysql");
    assert.ok(dbMySqlBundle, "Expected db-mysql bundle in list output.");
    assert.ok(Number.isInteger(dbMySqlBundle.packageCount));
    assert.ok(Array.isArray(dbMySqlBundle.packages));
    assert.ok(Array.isArray(dbMySqlBundle.requiredCapabilities));
    assert.ok(Array.isArray(dbMySqlBundle.providedCapabilities));

    const dbPackage = payload.availablePackages.find((entry) => entry.packageId === "@jskit-ai/db-mysql");
    assert.ok(dbPackage, "Expected @jskit-ai/db-mysql package in list output.");
    assert.ok(Array.isArray(dbPackage.dependsOn));
    assert.ok(Array.isArray(dbPackage.requiredCapabilities));
    assert.ok(Array.isArray(dbPackage.providedCapabilities));
  });
});

test("every bundle add succeeds with prerequisites and passes doctor", async () => {
  const available = await (async () => {
    let bundles = [];
    await withTempApp(async (appRoot) => {
      const listResult = runCli({
        cwd: appRoot,
        args: ["list", "bundles", "all", "--json"]
      });
      assert.equal(listResult.status, 0, listResult.stderr);
      bundles = JSON.parse(listResult.stdout).availableBundles;
    });
    return bundles;
  })();

  for (const bundle of available) {
    if (bundle.bundleId === "db-postgres") {
      continue;
    }

    await withTempApp(async (appRoot) => {
      if (REQUIRES_DB.has(bundle.bundleId) && bundle.bundleId !== "db-mysql") {
        const addDb = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "db-mysql", "--no-install"]
        });
        assert.equal(addDb.status, 0, addDb.stderr);
      }

      if (REQUIRES_AUTH.has(bundle.bundleId) && bundle.bundleId !== "auth-base") {
        const addAuth = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "auth-base", "--no-install"]
        });
        assert.equal(addAuth.status, 0, addAuth.stderr);
      }

      if (BUNDLES_REQUIRING_ASSISTANT_PROVIDER.has(bundle.bundleId) && bundle.bundleId !== "assistant-openai") {
        const addAssistantProvider = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "assistant-openai", "--no-install"]
        });
        assert.equal(addAssistantProvider.status, 0, addAssistantProvider.stderr);
      }

      const addResult = runCli({
        cwd: appRoot,
        args: ["add", "bundle", bundle.bundleId, "--no-install"]
      });
      assert.equal(addResult.status, 0, `add failed for ${bundle.bundleId}: ${addResult.stderr}`);

      const doctorResult = runCli({ cwd: appRoot, args: ["doctor"] });
      assert.equal(doctorResult.status, 0, `doctor failed for ${bundle.bundleId}: ${doctorResult.stderr}`);
    });
  }
});

test("bundle capability checks fail for missing providers", async () => {
  await withTempApp(async (appRoot) => {
    const securityWithoutDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "security-audit", "--no-install"]
    });
    assert.notEqual(securityWithoutDb.status, 0);
    assert.match(securityWithoutDb.stderr, /\[capability-violation\]/);

    const workspaceWithoutAuth = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "workspace-console", "--no-install"]
    });
    assert.notEqual(workspaceWithoutAuth.status, 0);
    assert.match(workspaceWithoutAuth.stderr, /\[capability-violation\]/);
  });
});
