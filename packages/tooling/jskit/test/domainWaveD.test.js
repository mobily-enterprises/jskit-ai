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
  "assistant",
  "assistant-openai",
  "billing-base",
  "billing-stripe",
  "billing-paddle",
  "billing-worker"
];
const REQUIRES_BILLING_PROVIDER = new Set(["billing-base", "billing-worker"]);
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
        args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
      });
      assert.equal(addDb.status, 0, addDb.stderr);

      if (bundleId === "assistant") {
        const addAssistantProvider = runCli({
          cwd: appRoot,
          args: ["add", "bundle", "assistant-openai", "--no-install", ...OPENAI_OPTION_ARGS]
        });
        assert.equal(addAssistantProvider.status, 0, addAssistantProvider.stderr);
      }

      if (REQUIRES_BILLING_PROVIDER.has(bundleId)) {
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

      const addArgs = ["add", "bundle", bundleId, "--no-install"];
      if (bundleId === "assistant-openai") {
        addArgs.push(...OPENAI_OPTION_ARGS);
      }
      if (bundleId === "billing-stripe") {
        addArgs.push(...BILLING_SHARED_OPTION_ARGS, ...BILLING_STRIPE_OPTION_ARGS);
      }
      if (bundleId === "billing-paddle") {
        addArgs.push(...BILLING_SHARED_OPTION_ARGS, ...BILLING_PADDLE_OPTION_ARGS);
      }
      if (bundleId === "billing-base" || bundleId === "billing-worker") {
        addArgs.push(...BILLING_SHARED_OPTION_ARGS);
      }
      const addBundle = runCli({
        cwd: appRoot,
        args: addArgs
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

test("assistant enforces assistant.provider capability", async () => {
  await withTempApp(async (appRoot) => {
    const addAssistant = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "assistant", "--no-install"]
    });
    assert.notEqual(addAssistant.status, 0);
    assert.match(addAssistant.stderr, /\[capability-violation\]/);
    assert.match(addAssistant.stderr, /assistant\.provider/i);
  });
});

test("assistant enforces transcript db-provider capability", async () => {
  await withTempApp(async (appRoot) => {
    const addAssistantProvider = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "assistant-openai", "--no-install", ...OPENAI_OPTION_ARGS]
    });
    assert.equal(addAssistantProvider.status, 0, addAssistantProvider.stderr);

    const addAssistant = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "assistant", "--no-install"]
    });
    assert.notEqual(addAssistant.status, 0);
    assert.match(addAssistant.stderr, /\[capability-violation\]/);
    assert.match(addAssistant.stderr, /db-provider/i);
  });
});

test("billing bundles enforce a single provider package", async () => {
  await withTempApp(async (appRoot) => {
    const addDb = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "db-mysql", "--no-install", ...MYSQL_OPTION_ARGS]
    });
    assert.equal(addDb.status, 0, addDb.stderr);

    const addStripe = runCli({
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
    assert.equal(addStripe.status, 0, addStripe.stderr);

    const addPaddle = runCli({
      cwd: appRoot,
      args: [
        "add",
        "bundle",
        "billing-paddle",
        "--no-install",
        ...BILLING_SHARED_OPTION_ARGS,
        ...BILLING_PADDLE_OPTION_ARGS
      ]
    });
    assert.notEqual(addPaddle.status, 0);
    assert.match(addPaddle.stderr, /\[capability-violation\]/i);
    assert.match(addPaddle.stderr, /multiple installed providers/i);

    const lock = await readJsonFile(path.join(appRoot, ".jskit", "lock.json"));
    assert.ok(lock.installedPackages["@jskit-ai/billing-provider-stripe"]);
    assert.equal(lock.installedPackages["@jskit-ai/billing-provider-paddle"], undefined);
  });
});

test("saas-full fails fast without provider intents", async () => {
  await withTempApp(async (appRoot) => {
    const addSaas = runCli({
      cwd: appRoot,
      args: ["add", "bundle", "saas-full", "--no-install", ...BILLING_SHARED_OPTION_ARGS]
    });
    assert.notEqual(addSaas.status, 0);
    assert.match(addSaas.stderr, /\[capability-violation\]/);
    assert.match(addSaas.stderr, /db-provider/i);
    assert.match(addSaas.stderr, /install one provider bundle first/i);
  });
});
