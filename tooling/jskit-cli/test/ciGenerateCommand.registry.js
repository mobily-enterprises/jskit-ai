import assert from "node:assert/strict";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { createApp } from "../../create-app/src/server/index.js";
import { createCliRunner } from "../../testUtils/runCli.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  parseGithubWorkflow
} from "../src/server/cliRuntime/ci/githubWorkflow.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

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

test("package addition refreshes CI from the installed npm graph", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "ci-add-app");
    await assert.rejects(access(path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH)), /ENOENT/u);

    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));

    const document = parseGithubWorkflow(await readWorkflow(appRoot));
    assert.equal(document.jobs.verify.env.DB_CLIENT, "mysql2");
    assert.equal(document.jobs.verify.services.mariadb.image, "mariadb:11.4");
    assert.ok(document.jobs.verify.steps.some((step) => step.id === "database-migrations"));
  });
});

test("ci generate fully regenerates its one file and --check is read-only", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "ci-generate-app");
    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 0, String(addResult.stderr || ""));
    const workflowPath = path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH);
    const expected = await readWorkflow(appRoot);
    await writeFile(workflowPath, `${expected}# stale\n`, "utf8");

    const checkResult = runCli({ cwd: appRoot, args: ["ci", "generate", "--check"] });
    assert.equal(checkResult.status, 1);
    assert.match(String(checkResult.stderr || ""), /CI workflow is out of date/u);
    assert.match(await readWorkflow(appRoot), /# stale/u);

    const generateResult = runCli({ cwd: appRoot, args: ["ci", "generate"] });
    assert.equal(generateResult.status, 0, String(generateResult.stderr || ""));
    assert.equal(await readWorkflow(appRoot), expected);
  });
});

test("add fails before dependency or migration changes when package CI contributions conflict", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = await scaffoldApp(cwd, "ci-preflight-app");
    const mainPackagePath = path.join(appRoot, "packages/main/package.json");
    const mainPackage = JSON.parse(await readFile(mainPackagePath, "utf8"));
    mainPackage.jskit.ci = { environment: { DB_CLIENT: "postgres" } };
    await writeFile(mainPackagePath, `${JSON.stringify(mainPackage, null, 2)}\n`, "utf8");
    const beforePackageJson = await readFile(path.join(appRoot, "package.json"), "utf8");
    const beforeMigrationFiles = await readdir(path.join(appRoot, "migrations")).catch(() => []);

    const addResult = addMysql(appRoot);
    assert.equal(addResult.status, 1);
    assert.match(String(addResult.stderr || ""), /\[ci:environment-conflict\]/u);
    assert.equal(await readFile(path.join(appRoot, "package.json"), "utf8"), beforePackageJson);
    assert.deepEqual(
      await readdir(path.join(appRoot, "migrations")).catch(() => []),
      beforeMigrationFiles
    );
  });
});
