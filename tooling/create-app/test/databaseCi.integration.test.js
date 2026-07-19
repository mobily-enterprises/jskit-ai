import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import authLocalDescriptor from "../../../packages/auth-provider-local-core/package.descriptor.mjs";
import authLocalDbDescriptor from "../../../packages/auth-provider-local-db-core/package.descriptor.mjs";
import databaseDescriptor from "../../../packages/database-runtime/package.descriptor.mjs";
import databaseMysqlDescriptor from "../../../packages/database-runtime-mysql/package.descriptor.mjs";
import { DIALECT_ID as MYSQL_DIALECT_ID } from "../../../packages/database-runtime-mysql/src/shared/dialect.js";
import databasePostgresDescriptor from "../../../packages/database-runtime-postgres/package.descriptor.mjs";
import { DIALECT_ID as POSTGRES_DIALECT_ID } from "../../../packages/database-runtime-postgres/src/shared/dialect.js";
import { composeCiContributions } from "../../jskit-cli/src/server/cliRuntime/ci/composer.js";
import {
  JSKIT_CI_WORKFLOW_RELATIVE_PATH,
  parseGithubWorkflow,
  renderGithubWorkflow
} from "../../jskit-cli/src/server/cliRuntime/ci/githubWorkflow.js";
import { withTempDir } from "../../testUtils/tempDir.mjs";

const CREATE_APP_CLI = fileURLToPath(new URL("../bin/jskit-create-app.js", import.meta.url));
const JSKIT_CLI = fileURLToPath(new URL("../../jskit-cli/bin/jskit.js", import.meta.url));
const AGENT_DOCS_PACKAGE_ROOT = fileURLToPath(new URL("../../../packages/agent-docs", import.meta.url));
const CONFIG_ESLINT_PACKAGE_ROOT = fileURLToPath(new URL("../../config-eslint", import.meta.url));
const JSKIT_CLI_PACKAGE_ROOT = fileURLToPath(new URL("../../jskit-cli", import.meta.url));
const JSKIT_CATALOG_PACKAGE_ROOT = fileURLToPath(new URL("../../jskit-catalog", import.meta.url));
const DATABASE_CASES = Object.freeze([
  Object.freeze({
    id: "mariadb",
    label: "MariaDB",
    descriptor: databaseMysqlDescriptor,
    dialectId: MYSQL_DIALECT_ID,
    serviceId: "mariadb",
    packageRoot: fileURLToPath(new URL("../../../packages/database-runtime-mysql", import.meta.url))
  }),
  Object.freeze({
    id: "postgres",
    label: "PostgreSQL",
    descriptor: databasePostgresDescriptor,
    dialectId: POSTGRES_DIALECT_ID,
    serviceId: "postgres",
    packageRoot: fileURLToPath(new URL("../../../packages/database-runtime-postgres", import.meta.url))
  })
]);
const DATABASE_CASE_BY_ID = new Map(DATABASE_CASES.map((entry) => [entry.id, entry]));

function resolveDatabaseIntegrationDriver(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || DATABASE_CASE_BY_ID.has(normalized)) {
    return normalized;
  }
  throw new Error(
    `Unsupported JSKIT_DATABASE_INTEGRATION_DRIVER "${normalized}". Use one of: ${DATABASE_CASES.map((entry) => entry.id).join(", ")}.`
  );
}

const SELECTED_DATABASE_DRIVER = resolveDatabaseIntegrationDriver(
  process.env.JSKIT_DATABASE_INTEGRATION_DRIVER
);

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

async function useCurrentCiPackageSources(appRoot, databaseCase) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.dependencies = packageJson.dependencies || {};
  packageJson.devDependencies = packageJson.devDependencies || {};
  packageJson.dependencies[databaseCase.descriptor.packageId] =
    `file:${databaseCase.packageRoot}`;
  packageJson.devDependencies["@jskit-ai/agent-docs"] =
    `file:${AGENT_DOCS_PACKAGE_ROOT}`;
  packageJson.devDependencies["@jskit-ai/config-eslint"] =
    `file:${CONFIG_ESLINT_PACKAGE_ROOT}`;
  packageJson.devDependencies["@jskit-ai/jskit-cli"] =
    `file:${JSKIT_CLI_PACKAGE_ROOT}`;
  packageJson.devDependencies["@jskit-ai/jskit-catalog"] =
    `file:${JSKIT_CATALOG_PACKAGE_ROOT}`;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

async function restoreManagedToolingSpecifiers(appRoot) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.devDependencies["@jskit-ai/agent-docs"] = "0.x";
  packageJson.devDependencies["@jskit-ai/config-eslint"] = "0.x";
  packageJson.devDependencies["@jskit-ai/jskit-cli"] = "0.x";
  delete packageJson.devDependencies["@jskit-ai/jskit-catalog"];
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
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

function resolveContainerPort(service) {
  const portMapping = String(service?.ports?.[0] || "").trim();
  const containerPort = portMapping.split(":").at(-1)?.trim() || "";
  assert.match(containerPort, /^\d+$/u, `Invalid service port mapping: ${portMapping || "<empty>"}`);
  return containerPort;
}

async function waitForHealthyContainer(containerName, databaseCase) {
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
      assert.fail(
        `${databaseCase.label} became unhealthy.\n${String(logs.stdout || "")}\n${String(logs.stderr || "")}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.fail(`Timed out waiting for the generated ${databaseCase.label} service to become healthy.`);
}

test("database integration driver selection rejects unknown values", () => {
  assert.throws(
    () => resolveDatabaseIntegrationDriver("sqlite"),
    /Unsupported JSKIT_DATABASE_INTEGRATION_DRIVER "sqlite"\. Use one of: mariadb, postgres\./u
  );
});

for (const databaseCase of DATABASE_CASES) {
  test(`clean generated database-backed app verifies without .env on fresh ${databaseCase.label}`, {
    skip: SELECTED_DATABASE_DRIVER === databaseCase.id
      ? false
      : SELECTED_DATABASE_DRIVER
        ? `selected database integration driver is ${SELECTED_DATABASE_DRIVER}`
        : `set JSKIT_DATABASE_INTEGRATION_DRIVER=${databaseCase.id} to run the ${databaseCase.label} clean-runner test`,
    timeout: 600_000
  }, async () => {
    await withTempDir(async (cwd) => {
      const appName = `database-ci-clean-runner-${databaseCase.id}`;
      const appRoot = path.join(cwd, appName);
      const containerName = `jskit-database-ci-${databaseCase.id}-${process.pid}-${Date.now()}`;
      const databaseService = databaseCase.descriptor.ci.services.find(
        (entry) => entry.id === databaseCase.serviceId
      );
      assert.ok(databaseService, `Expected ${databaseCase.label} descriptor service ${databaseCase.serviceId}.`);

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
          databaseCase.descriptor.packageId,
          "--db-host",
          "local-only",
          "--db-port",
          resolveContainerPort(databaseService),
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
        databaseCase.descriptor.packageId,
        "@jskit-ai/users-core",
        "@jskit-ai/workspaces-core"
      ]) {
        assert.ok(lock.installedPackages[packageId], `Expected ${packageId} to be installed through JSKIT.`);
      }

      const ciModel = composeCiContributions([
        packageEntry(authLocalDescriptor),
        packageEntry(authLocalDbDescriptor),
        packageEntry(databaseDescriptor),
        packageEntry(databaseCase.descriptor)
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
      assert.equal(workflow.jobs.verify.env.DB_CLIENT, databaseCase.dialectId);
      assert.equal(workflow.jobs.verify.env.AUTH_PROVIDER, "local");
      assert.equal(workflow.jobs.verify.env.AUTH_LOCAL_BACKEND, "db");

      await useCurrentCiPackageSources(appRoot, databaseCase);
      runChecked("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: appRoot,
        label: "create clean package-lock"
      });
      await rm(path.join(appRoot, "node_modules"), { recursive: true, force: true });
      await rm(path.join(appRoot, ".env"), { force: true });
      await assert.rejects(access(path.join(appRoot, ".env")), /ENOENT/u);

      const service = ciModel.services.find((entry) => entry.id === databaseCase.serviceId);
      assert.deepEqual(service, databaseService);
      const commandEnv = {
        ...ciModel.environment,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
      };
      try {
        runChecked("docker", dockerRunArgs(containerName, service), {
          cwd: appRoot,
          label: `start generated ${databaseCase.label} service`
        });
        await waitForHealthyContainer(containerName, databaseCase);

        runChecked("npm", ["ci"], {
          cwd: appRoot,
          env: commandEnv,
          label: "npm ci"
        });
        await restoreManagedToolingSpecifiers(appRoot);
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
    }, { prefix: `jskit-database-ci-${databaseCase.id}-` });
  });
}
