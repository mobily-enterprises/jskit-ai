import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import authLocalDescriptor from "../../../packages/auth-provider-local-core/package.descriptor.mjs";
import authLocalDbDescriptor from "../../../packages/auth-provider-local-db-core/package.descriptor.mjs";
import databaseDescriptor from "../../../packages/database-runtime/package.descriptor.mjs";
import databaseMysqlDescriptor from "../../../packages/database-runtime-mysql/package.descriptor.mjs";
import { composeCiContributions } from "../../jskit-cli/src/server/cliRuntime/ci/composer.js";
import {
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  parseGithubWorkflow,
  renderGithubWorkflow
} from "../../jskit-cli/src/server/cliRuntime/ci/githubWorkflow.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const RUN_INTEGRATION = process.env.JSKIT_RUN_MARIADB_INTEGRATION === "1";
const CREATE_APP_CLI = fileURLToPath(new URL("../bin/jskit-create-app.js", import.meta.url));
const JSKIT_CLI = fileURLToPath(new URL("../../jskit-cli/bin/jskit.js", import.meta.url));

function runChecked(command, args, { cwd, env = {}, label = command, timeout = 300_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      ...env
    }
  });
  assert.equal(
    result.status,
    0,
    `${label} failed.\nstdout:\n${String(result.stdout || "")}\nstderr:\n${String(result.stderr || "")}`
  );
  return result;
}

function packageEntry(descriptor) {
  return {
    packageId: descriptor.packageId,
    descriptor
  };
}

function dockerRunArgs(containerName, service) {
  const args = ["run", "--detach", "--rm", "--name", containerName];
  for (const [key, value] of Object.entries(service.environment)) {
    args.push("--env", `${key}=${value}`);
  }
  for (const port of service.ports) {
    args.push("--publish", `127.0.0.1:${port}`);
  }
  if (service.healthCheck) {
    args.push("--health-cmd", service.healthCheck.command);
    if (service.healthCheck.interval) {
      args.push("--health-interval", service.healthCheck.interval);
    }
    if (service.healthCheck.timeout) {
      args.push("--health-timeout", service.healthCheck.timeout);
    }
    if (service.healthCheck.retries) {
      args.push("--health-retries", String(service.healthCheck.retries));
    }
  }
  args.push(service.image);
  return args;
}

async function waitForHealthyContainer(containerName) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync("docker", [
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      containerName
    ], { encoding: "utf8" });
    const status = String(result.stdout || "").trim();
    if (status === "healthy") {
      return;
    }
    if (status === "unhealthy") {
      const logs = spawnSync("docker", ["logs", containerName], { encoding: "utf8" });
      assert.fail(`MariaDB became unhealthy.\n${String(logs.stdout || "")}\n${String(logs.stderr || "")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.fail("Timed out waiting for the generated MariaDB service to become healthy.");
}

test("clean generated database-backed app verifies without .env on fresh MariaDB", {
  skip: RUN_INTEGRATION ? false : "set JSKIT_RUN_MARIADB_INTEGRATION=1 to run the MariaDB clean-runner test",
  timeout: 600_000
}, async () => {
  await withTempDir(async (cwd) => {
    const appName = "database-ci-clean-runner";
    const appRoot = path.join(cwd, appName);
    const containerName = `jskit-database-ci-${process.pid}-${Date.now()}`;

    runChecked(process.execPath, [
      CREATE_APP_CLI,
      appName,
      "--target",
      appRoot,
      "--tenancy-mode",
      "personal"
    ], { cwd, label: "create-app" });

    const packageCommands = [
      ["add", "package", "auth-provider-local-core"],
      ["add", "package", "auth-web"],
      [
        "add",
        "package",
        "database-runtime-mysql",
        "--db-host",
        "local-only",
        "--db-port",
        "3306",
        "--db-name",
        "local_only",
        "--db-user",
        "local_only",
        "--db-password",
        "local_only"
      ],
      ["add", "package", "auth-provider-local-db-core"],
      ["add", "package", "users-web"],
      ["add", "package", "workspaces-core"],
      ["add", "package", "workspaces-web"]
    ];
    for (const args of packageCommands) {
      runChecked(process.execPath, [JSKIT_CLI, ...args], {
        cwd: appRoot,
        label: `jskit ${args.join(" ")}`
      });
    }

    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit/lock.json"), "utf8"));
    for (const packageId of [
      "@jskit-ai/auth-provider-local-db-core",
      "@jskit-ai/database-runtime-mysql",
      "@jskit-ai/users-core",
      "@jskit-ai/workspaces-core"
    ]) {
      assert.ok(lock.installedPackages[packageId], `Expected ${packageId} to be installed through JSKIT.`);
    }

    const ciModel = composeCiContributions([
      packageEntry(authLocalDescriptor),
      packageEntry(authLocalDbDescriptor),
      packageEntry(databaseDescriptor),
      packageEntry(databaseMysqlDescriptor)
    ]);
    const workflowSource = await readFile(
      path.join(appRoot, JSKIT_CI_WORKFLOW_RELATIVE_PATH),
      "utf8"
    );
    assert.equal(workflowSource, renderGithubWorkflow(ciModel));
    const workflow = parseGithubWorkflow(workflowSource);
    const workflowStepIds = workflow.jobs.verify.steps.map((step) => step.id);
    assert.ok(
      workflowStepIds.indexOf("install-dependencies") < workflowStepIds.indexOf("database-migrations")
    );
    assert.ok(workflowStepIds.indexOf("database-migrations") < workflowStepIds.indexOf("verify"));
    assert.equal(workflow.jobs.verify.env.DB_CLIENT, "mysql2");
    assert.equal(workflow.jobs.verify.env.AUTH_PROVIDER, "local");
    assert.equal(workflow.jobs.verify.env.AUTH_LOCAL_BACKEND, "db");

    runChecked("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: appRoot,
      label: "create clean package-lock"
    });
    await rm(path.join(appRoot, "node_modules"), { recursive: true, force: true });
    await rm(path.join(appRoot, ".env"), { force: true });
    await assert.rejects(access(path.join(appRoot, ".env")), /ENOENT/u);

    const service = ciModel.services.find((entry) => entry.id === "mariadb");
    const commandEnv = {
      ...ciModel.environment,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
    };
    try {
      runChecked("docker", dockerRunArgs(containerName, service), {
        cwd: appRoot,
        label: "start generated MariaDB service"
      });
      await waitForHealthyContainer(containerName);

      runChecked("npm", ["ci"], {
        cwd: appRoot,
        env: commandEnv,
        label: "npm ci"
      });
      const migrationResult = runChecked("npm", ["run", "db:migrate"], {
        cwd: appRoot,
        env: commandEnv,
        label: "npm run db:migrate"
      });
      assert.match(migrationResult.stdout, /Batch 1 run: \d+ migrations/u);

      const verifyResult = runChecked("npm", ["run", "verify"], {
        cwd: appRoot,
        env: commandEnv,
        label: "npm run verify"
      });
      assert.match(verifyResult.stdout, /Doctor status: (?:healthy|warnings)/u);
      await assert.rejects(access(path.join(appRoot, ".env")), /ENOENT/u);
    } finally {
      spawnSync("docker", ["rm", "--force", containerName], { encoding: "utf8" });
    }
  }, { prefix: "jskit-database-ci-" });
});
