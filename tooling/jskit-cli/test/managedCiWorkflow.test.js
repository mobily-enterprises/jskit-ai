import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { createApp } from "../../create-app/src/server/index.js";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/server/cliRuntime/ioAndMigrations.js";
import { composeCiContributions } from "../src/server/cliRuntime/ci/composer.js";
import {
  GENERATED_WORKFLOW_HEADER,
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  LEGACY_CI_WORKFLOW_RELATIVE_PATH,
  parseGithubWorkflow,
  renderGithubWorkflow
} from "../src/server/cliRuntime/ci/githubWorkflow.js";
import {
  validateAppCiWorkflow,
  validateManagedCiWorkflow
} from "../src/server/cliRuntime/ci/managedWorkflow.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);
const LEGACY_VERIFY_WORKFLOW = `name: Verify

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run verify
        run: npm run verify
`;

async function scaffoldApp(cwd, name) {
  await createApp({
    appName: name,
    target: name,
    tenancyMode: "personal",
    cwd
  });
  return path.join(cwd, name);
}

function addMysql(appRoot) {
  return runCli({
    cwd: appRoot,
    args: [
      "add",
      "package",
      "database-runtime-mysql",
      "--db-host",
      "local-db",
      "--db-port",
      "3306",
      "--db-name",
      "local_app",
      "--db-user",
      "local_user",
      "--db-password",
      "local_password"
    ]
  });
}

async function readWorkflow(appRoot) {
  return readFile(path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH), "utf8");
}

async function readLock(appRoot) {
  return JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
}

async function writeWorkflowAndRecordedHash(appRoot, document) {
  const content = `${GENERATED_WORKFLOW_HEADER}${YAML.stringify(document, { lineWidth: 0 })}`;
  await writeFile(path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH), content, "utf8");
  const lock = await readLock(appRoot);
  lock.managed.ciWorkflow.hash = hashBuffer(Buffer.from(content, "utf8"));
  await writeFile(path.join(appRoot, ".jskit/lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return content;
}

test("package addition, update, and removal keep the managed database CI projection current", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "managed-ci-lifecycle-app");
    const baselineWorkflow = await readWorkflow(appRoot);
    assert.doesNotMatch(baselineWorkflow, /mariadb/u);

    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    const addedDocument = parseGithubWorkflow(await readWorkflow(appRoot));
    assert.equal(addedDocument.jobs.verify.env.DB_CLIENT, "mysql2");
    assert.equal(addedDocument.jobs.verify.services.mariadb.image, "mariadb:11.4");
    assert.ok(addedDocument.jobs.verify.steps.some((step) => step.id === "database-migrations"));

    const staleWorkflow = renderGithubWorkflow(composeCiContributions([]));
    await writeFile(path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH), staleWorkflow, "utf8");
    const staleLock = await readLock(appRoot);
    staleLock.managed.ciWorkflow.hash = hashBuffer(Buffer.from(staleWorkflow, "utf8"));
    await writeFile(path.join(appRoot, ".jskit/lock.json"), `${JSON.stringify(staleLock, null, 2)}\n`, "utf8");

    const updateResult = runCli({
      cwd: appRoot,
      args: ["update", "package", "database-runtime-mysql"]
    });
    assert.equal(updateResult.status, 0, String(updateResult.stderr || ""));
    assert.ok(parseGithubWorkflow(await readWorkflow(appRoot)).jobs.verify.services.mariadb);

    const removeDriverResult = runCli({
      cwd: appRoot,
      args: ["remove", "package", "database-runtime-mysql"]
    });
    assert.equal(removeDriverResult.status, 0, String(removeDriverResult.stderr || ""));
    const driverRemovedDocument = parseGithubWorkflow(await readWorkflow(appRoot));
    assert.equal(driverRemovedDocument.jobs.verify.services, undefined);
    assert.ok(driverRemovedDocument.jobs.verify.steps.some((step) => step.id === "database-migrations"));

    const removeRuntimeResult = runCli({
      cwd: appRoot,
      args: ["remove", "package", "database-runtime"]
    });
    assert.equal(removeRuntimeResult.status, 0, String(removeRuntimeResult.stderr || ""));
    const runtimeRemovedDocument = parseGithubWorkflow(await readWorkflow(appRoot));
    assert.equal(runtimeRemovedDocument.jobs.verify.services, undefined);
    assert.equal(runtimeRemovedDocument.jobs.verify.env, undefined);
    assert.equal(runtimeRemovedDocument.jobs.verify.steps.some((step) => step.id === "database-migrations"), false);
  });
});

test("package operations refuse a user-modified managed workflow and sync-ci explicitly recovers it", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "managed-ci-protection-app");
    await writeFile(
      path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH),
      `${await readWorkflow(appRoot)}# application edit\n`,
      "utf8"
    );

    const refusedResult = addMysql(appRoot);
    assert.equal(refusedResult.status, 1);
    assert.match(refusedResult.stderr, /\[ci:workflow-modified\]/u);
    assert.match(refusedResult.stderr, /npx jskit app sync-ci --force/u);
    const refusedLock = await readLock(appRoot);
    assert.equal(refusedLock.installedPackages["@jskit-ai/database-runtime-mysql"], undefined);

    const safeSyncResult = runCli({ cwd: appRoot, args: ["app", "sync-ci"] });
    assert.equal(safeSyncResult.status, 1);
    assert.match(safeSyncResult.stderr, /npx jskit app sync-ci --force/u);

    const syncResult = runCli({ cwd: appRoot, args: ["app", "sync-ci", "--force"] });
    assert.equal(syncResult.status, 0, String(syncResult.stderr || ""));
    assert.match(syncResult.stdout, /Replaced the modified JSKIT-managed CI workflow/u);
    assert.doesNotMatch(await readWorkflow(appRoot), /application edit/u);

    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
  });
});

test("package operations replace only the untouched legacy scaffold workflow", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "managed-ci-legacy-app");
    await rm(path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH));
    const lock = await readLock(appRoot);
    delete lock.managed.ciWorkflow;
    await writeFile(path.join(appRoot, ".jskit/lock.json"), `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const legacyPath = path.join(appRoot, LEGACY_CI_WORKFLOW_RELATIVE_PATH);
    await writeFile(legacyPath, LEGACY_VERIFY_WORKFLOW, "utf8");

    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    await assert.rejects(access(legacyPath), /ENOENT/u);
    assert.ok(parseGithubWorkflow(await readWorkflow(appRoot)).jobs.verify.services.mariadb);
    const updatedLock = await readLock(appRoot);
    assert.equal(updatedLock.managed.ciWorkflow.path, JSKIT_CI_WORKFLOW_RELATIVE_PATH);
  });
});

test("doctor identifies stale database service, environment, and migration requirements", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "managed-ci-doctor-app");
    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const document = parseGithubWorkflow(await readWorkflow(appRoot));
    delete document.jobs.verify.services.mariadb;
    document.jobs.verify.env.DB_CLIENT = "mysql";
    document.jobs.verify.steps = document.jobs.verify.steps.filter(
      (step) => step.id !== "database-migrations"
    );
    await writeWorkflowAndRecordedHash(appRoot, document);

    const doctorResult = runCli({ cwd: appRoot, args: ["doctor", "--json"] });
    assert.equal(doctorResult.status, 1);
    const payload = JSON.parse(String(doctorResult.stdout || "{}"));
    assert.ok(payload.issues.some((issue) => issue.includes("[ci:workflow-out-of-date]")));
    assert.ok(payload.issues.some((issue) => issue.includes("[ci:service-missing]")));
    assert.ok(payload.issues.some((issue) => issue.includes("[ci:environment-incorrect]")));
    assert.ok(payload.issues.some((issue) => issue.includes("[ci:step-missing]")));
    assert.ok(payload.issues.some((issue) => issue.includes("DB_CLIENT=mysql2")));
  });
});

test("CI validation detects preparation steps placed after verification", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "managed-ci-order-app");
    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const document = parseGithubWorkflow(await readWorkflow(appRoot));
    const migrationIndex = document.jobs.verify.steps.findIndex(
      (step) => step.id === "database-migrations"
    );
    const [migrationStep] = document.jobs.verify.steps.splice(migrationIndex, 1);
    document.jobs.verify.steps.push(migrationStep);
    await writeWorkflowAndRecordedHash(appRoot, document);

    const validation = await validateAppCiWorkflow({ appRoot });
    assert.equal(validation.valid, false);
    assert.ok(validation.issues.some((issue) => issue.code === "ci:step-order-incorrect"));
  });
});

test("app verify rejects invalid CI before running application scripts", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "managed-ci-verify-app");
    const workflow = await readWorkflow(appRoot);
    await writeFile(path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH), `${workflow}# stale\n`, "utf8");

    const binRoot = path.join(cwd, "bin");
    const npmLog = path.join(cwd, "npm.log");
    await mkdir(binRoot, { recursive: true });
    const npmPath = path.join(binRoot, "npm");
    await writeFile(
      npmPath,
      `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(npmLog)}, "ran\\n");\n`,
      { encoding: "utf8", mode: 0o755 }
    );

    const verifyResult = runCli({
      cwd: appRoot,
      args: ["app", "verify"],
      env: { PATH: `${binRoot}${path.delimiter}${process.env.PATH || ""}` }
    });
    assert.equal(verifyResult.status, 1);
    assert.match(verifyResult.stderr, /\[ci:workflow-modified\]/u);
    await assert.rejects(access(npmLog), /ENOENT/u);
  });
});

test("shared CI validation reports conflicting installed package contributions", async () => {
  await withTempDir(async (appRoot) => {
    const lock = {
      lockVersion: 1,
      installedPackages: {
        "@jskit-ai/mysql-test": {},
        "@jskit-ai/postgres-test": {}
      }
    };
    const packageRegistry = new Map([
      ["@jskit-ai/mysql-test", {
        packageId: "@jskit-ai/mysql-test",
        descriptor: { ci: { environment: { DB_CLIENT: "mysql2" } } }
      }],
      ["@jskit-ai/postgres-test", {
        packageId: "@jskit-ai/postgres-test",
        descriptor: { ci: { environment: { DB_CLIENT: "pg" } } }
      }]
    ]);

    const validation = await validateManagedCiWorkflow({
      appRoot,
      lock,
      packageRegistry
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.issues[0].code, "ci:contribution-conflict");
    assert.match(validation.issues[0].message, /environment-conflict/u);
    assert.match(validation.issues[0].message, /@jskit-ai\/mysql-test/u);
    assert.match(validation.issues[0].message, /@jskit-ai\/postgres-test/u);
  });
});
