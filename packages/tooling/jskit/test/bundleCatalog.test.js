import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);
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
const SUPABASE_OPTION_ARGS = [
  "--auth-supabase-url",
  "https://example.supabase.co",
  "--auth-supabase-publishable-key",
  "sb_publishable_example"
];
const OPENAI_OPTION_ARGS = ["--ai-api-key", "sk-test-openai"];
const BILLING_SHARED_OPTION_ARGS = [
  "--billing-operation-key-secret",
  "billing-op-secret",
  "--billing-provider-idempotency-key-secret",
  "billing-idempotency-secret"
];
const BILLING_STRIPE_OPTION_ARGS = [
  "--billing-stripe-secret-key",
  "sk_test_stripe",
  "--billing-stripe-api-version",
  "2024-06-20",
  "--billing-stripe-webhook-endpoint-secret",
  "whsec_test"
];
const BILLING_PADDLE_OPTION_ARGS = [
  "--billing-paddle-api-key",
  "paddle_test_key",
  "--billing-paddle-webhook-endpoint-secret",
  "paddle_whsec_test"
];

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
const REQUIRES_AUTH_PROVIDER = new Set([
  "auth-base",
  "chat-base",
  "community-suite",
  "workspace-core",
  "workspace-console",
  "workspace-admin-suite",
  "saas-full"
]);
// Bundle IDs that require the assistant provider capability to be installed first.
const BUNDLES_REQUIRING_ASSISTANT_PROVIDER = new Set(["assistant", "saas-full"]);
// Bundle IDs that require a billing provider capability to be installed first.
const BUNDLES_REQUIRING_BILLING_PROVIDER = new Set(["billing-base", "billing-worker", "saas-full"]);

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
          args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
        });
        assert.equal(addDb.status, 0, addDb.stderr);
      }

      if (REQUIRES_AUTH_PROVIDER.has(bundle.bundleId) && bundle.bundleId !== "auth-supabase") {
        const addAuthProvider = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "auth-supabase", "--no-install", ...SUPABASE_OPTION_ARGS]
        });
        assert.equal(addAuthProvider.status, 0, addAuthProvider.stderr);
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
          args: ["add", "bundle", "assistant-openai", "--no-install", ...OPENAI_OPTION_ARGS]
        });
        assert.equal(addAssistantProvider.status, 0, addAssistantProvider.stderr);
      }

      if (BUNDLES_REQUIRING_BILLING_PROVIDER.has(bundle.bundleId)) {
        const addBillingProvider = runCli({
          cwd: appRoot,
          args: [
            "add",
            "bundle",
            "billing-stripe",
            "--no-install",
            ...BILLING_SHARED_OPTION_ARGS,
            ...BILLING_STRIPE_OPTION_ARGS
          ]
        });
        assert.equal(addBillingProvider.status, 0, addBillingProvider.stderr);
      }

      const addArgs = ["add", "bundle", bundle.bundleId, "--no-install"];
      if (bundle.bundleId === "db-mysql") {
        addArgs.push(...MYSQL_OPTION_ARGS);
      }
      if (bundle.bundleId === "auth-supabase") {
        addArgs.push(...SUPABASE_OPTION_ARGS);
      }
      if (bundle.bundleId === "assistant-openai") {
        addArgs.push(...OPENAI_OPTION_ARGS);
      }
      if (bundle.bundleId === "billing-stripe") {
        addArgs.push(...BILLING_SHARED_OPTION_ARGS, ...BILLING_STRIPE_OPTION_ARGS);
      }
      if (bundle.bundleId === "billing-paddle") {
        addArgs.push(...BILLING_SHARED_OPTION_ARGS, ...BILLING_PADDLE_OPTION_ARGS);
      }
      if (bundle.bundleId === "billing-base" || bundle.bundleId === "billing-worker") {
        addArgs.push(...BILLING_SHARED_OPTION_ARGS);
      }
      const addResult = runCli({
        cwd: appRoot,
        args: addArgs
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
