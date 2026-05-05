import assert from "node:assert/strict";
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(
  appRoot,
  {
    name = "feature-server-generator-contract-app",
    withConfig = false,
    withMainPackage = false
  } = {}
) {
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  if (withConfig) {
    await mkdir(path.join(appRoot, "config"), { recursive: true });
    await writeFile(
      path.join(appRoot, "config", "public.js"),
      `const config = {
  surfaceDefaultId: "admin",
  surfaceDefinitions: {
    admin: {
      id: "admin",
      pagesRoot: "admin",
      enabled: true,
      requiresAuth: true
    }
  }
};

export default config;
export { config };
`,
      "utf8"
    );
  }

  if (withMainPackage) {
    await mkdir(path.join(appRoot, "packages", "main"), { recursive: true });
    await writeFile(
      path.join(appRoot, "packages", "main", "package.json"),
      `${JSON.stringify(
        {
          name: "@local/main",
          version: "0.1.0",
          type: "module"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "main", "package.descriptor.mjs"),
      `export default Object.freeze({
  packageId: "@local/main",
  version: "0.1.0",
  kind: "runtime",
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  capabilities: {
    provides: [],
    requires: []
  },
  metadata: {},
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
`,
      "utf8"
    );
  }
}

function sortPaths(paths = []) {
  return [...paths].sort((left, right) => String(left || "").localeCompare(String(right || "")));
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function collectRelativeFiles(rootDir, currentDir = rootDir, collected = []) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectRelativeFiles(rootDir, absolutePath, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    collected.push(path.relative(rootDir, absolutePath).split(path.sep).join("/"));
  }

  return sortPaths(collected);
}

async function importGeneratedModule(absolutePath) {
  return import(`${pathToFileURL(absolutePath).href}?cacheBust=${Date.now()}-${Math.random()}`);
}

async function scaffoldFeaturePackage(appRoot, featureName, extraArgs = []) {
  const result = runCli({
    cwd: appRoot,
    args: ["generate", "feature-server-generator", "scaffold", featureName, ...extraArgs]
  });
  assert.equal(result.status, 0, String(result.stderr || ""));
}

function assertGeneratedServiceDoesNotImportPersistence(serviceSource = "") {
  assert.doesNotMatch(serviceSource, /createJsonRestContext/u);
  assert.doesNotMatch(serviceSource, /INTERNAL_JSON_REST_API/u);
  assert.doesNotMatch(serviceSource, /createWithTransaction/u);
  assert.doesNotMatch(serviceSource, /jskit\.database\.knex/u);
  assert.doesNotMatch(serviceSource, /from "\.\/repository\.js"/u);
  assert.doesNotMatch(serviceSource, /from '\.\/repository\.js'/u);
}

test("feature-server-generator json-rest scaffold emits exact inventory and delegates service work to the repository seam", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-contract-json-rest");
    await createMinimalApp(appRoot, { name: "feature-server-contract-json-rest" });
    await scaffoldFeaturePackage(appRoot, "booking-engine");

    const packageRoot = path.join(appRoot, "packages", "booking-engine");
    const generatedFiles = await collectRelativeFiles(packageRoot);
    assert.deepEqual(generatedFiles, sortPaths([
      "package.descriptor.mjs",
      "package.json",
      "src/server/BookingEngineProvider.js",
      "src/server/actions.js",
      "src/server/inputSchemas.js",
      "src/server/repository.js",
      "src/server/service.js"
    ]));

    const providerSource = await readFile(path.join(packageRoot, "src", "server", "BookingEngineProvider.js"), "utf8");
    const serviceSource = await readFile(path.join(packageRoot, "src", "server", "service.js"), "utf8");
    const repositorySource = await readFile(path.join(packageRoot, "src", "server", "repository.js"), "utf8");

    assert.match(providerSource, /INTERNAL_JSON_REST_API/);
    assert.doesNotMatch(providerSource, /jskit\.database\.knex/);
    assertGeneratedServiceDoesNotImportPersistence(serviceSource);
    assert.match(repositorySource, /createJsonRestContext/);
    assert.match(repositorySource, /persistence: "json-rest"/);
    assert.doesNotMatch(repositorySource, /createWithTransaction/);
    assert.doesNotMatch(repositorySource, /jskit\.database\.knex/);

    const { createService } = await importGeneratedModule(path.join(packageRoot, "src", "server", "service.js"));
    const calls = [];
    const featureRepository = {
      async getStatus(input, options) {
        calls.push({ method: "getStatus", input, options });
        return { ok: true, source: "repository.getStatus" };
      },
      async execute(input, options) {
        calls.push({ method: "execute", input, options });
        return { ok: true, source: "repository.execute" };
      }
    };
    const service = createService({ featureRepository });

    assert.deepEqual(
      await service.getStatus({ id: "booking-1" }, { context: { tenant: "alpha" } }),
      { ok: true, source: "repository.getStatus" }
    );
    assert.deepEqual(
      await service.execute({ action: "sync" }, { context: { tenant: "alpha" }, trx: { id: "trx-1" } }),
      { ok: true, source: "repository.execute" }
    );
    assert.deepEqual(calls, [
      {
        method: "getStatus",
        input: { id: "booking-1" },
        options: { context: { tenant: "alpha" } }
      },
      {
        method: "execute",
        input: { action: "sync" },
        options: { context: { tenant: "alpha" }, trx: { id: "trx-1" } }
      }
    ]);
  });
});

test("feature-server-generator orchestrator scaffold emits exact inventory and keeps the generated service out of persistence work", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-contract-orchestrator");
    await createMinimalApp(appRoot, { name: "feature-server-contract-orchestrator" });
    await scaffoldFeaturePackage(appRoot, "availability-engine", [
      "--mode",
      "orchestrator",
      "--route-prefix",
      "admin/availability-engine"
    ]);

    const packageRoot = path.join(appRoot, "packages", "availability-engine");
    const generatedFiles = await collectRelativeFiles(packageRoot);
    assert.deepEqual(generatedFiles, sortPaths([
      "package.descriptor.mjs",
      "package.json",
      "src/server/AvailabilityEngineProvider.js",
      "src/server/actions.js",
      "src/server/inputSchemas.js",
      "src/server/registerRoutes.js",
      "src/server/service.js"
    ]));

    const providerSource = await readFile(path.join(packageRoot, "src", "server", "AvailabilityEngineProvider.js"), "utf8");
    const serviceSource = await readFile(path.join(packageRoot, "src", "server", "service.js"), "utf8");

    assert.doesNotMatch(providerSource, /INTERNAL_JSON_REST_API/);
    assert.doesNotMatch(providerSource, /jskit\.database\.knex/);
    assertGeneratedServiceDoesNotImportPersistence(serviceSource);
    assert.equal(await fileExists(path.join(packageRoot, "src", "server", "repository.js")), false);

    const { createService } = await importGeneratedModule(path.join(packageRoot, "src", "server", "service.js"));
    const calls = [];
    const featureRepository = {
      async getStatus(...args) {
        calls.push(["getStatus", ...args]);
        return {};
      },
      async execute(...args) {
        calls.push(["execute", ...args]);
        return {};
      }
    };
    const service = createService({ featureRepository });
    const status = await service.getStatus({ probe: true }, { context: { tenant: "beta" } });
    const result = await service.execute({ command: "run" }, { trx: { id: "trx-2" } });

    assert.equal(calls.length, 0);
    assert.equal(status.mode, "orchestrator");
    assert.equal(status.customized, false);
    assert.equal(result.mode, "orchestrator");
    assert.equal(result.customized, false);
  });
});

test("feature-server-generator custom-knex scaffold emits exact inventory while keeping the service on the repository seam", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-contract-custom-knex");
    await createMinimalApp(appRoot, {
      name: "feature-server-contract-custom-knex",
      withConfig: true
    });
    await scaffoldFeaturePackage(appRoot, "invoice-rollup", [
      "--mode",
      "custom-knex",
      "--route-prefix",
      "admin/invoice-rollup",
      "--surface",
      "admin"
    ]);

    const packageRoot = path.join(appRoot, "packages", "invoice-rollup");
    const generatedFiles = await collectRelativeFiles(packageRoot);
    assert.deepEqual(generatedFiles, sortPaths([
      "package.descriptor.mjs",
      "package.json",
      "src/server/InvoiceRollupProvider.js",
      "src/server/actions.js",
      "src/server/inputSchemas.js",
      "src/server/registerRoutes.js",
      "src/server/repository.js",
      "src/server/service.js"
    ]));

    const providerSource = await readFile(path.join(packageRoot, "src", "server", "InvoiceRollupProvider.js"), "utf8");
    const serviceSource = await readFile(path.join(packageRoot, "src", "server", "service.js"), "utf8");
    const repositorySource = await readFile(path.join(packageRoot, "src", "server", "repository.js"), "utf8");

    assert.match(providerSource, /jskit\.database\.knex/);
    assert.doesNotMatch(providerSource, /INTERNAL_JSON_REST_API/);
    assertGeneratedServiceDoesNotImportPersistence(serviceSource);
    assert.match(repositorySource, /createWithTransaction/);
    assert.match(repositorySource, /persistence: "custom-knex"/);
    assert.doesNotMatch(repositorySource, /createJsonRestContext/);

    const { createService } = await importGeneratedModule(path.join(packageRoot, "src", "server", "service.js"));
    const calls = [];
    const featureRepository = {
      async getStatus(input, options) {
        calls.push({ method: "getStatus", input, options });
        return { ok: true, source: "repository.getStatus" };
      },
      async execute(input, options) {
        calls.push({ method: "execute", input, options });
        return { ok: true, source: "repository.execute" };
      }
    };
    const service = createService({ featureRepository });
    await service.getStatus({ reportId: "rollup-1" }, { context: { tenant: "gamma" } });
    await service.execute({ reportId: "rollup-1" }, { context: { tenant: "gamma" }, trx: { id: "trx-3" } });

    assert.deepEqual(calls, [
      {
        method: "getStatus",
        input: { reportId: "rollup-1" },
        options: { context: { tenant: "gamma" } }
      },
      {
        method: "execute",
        input: { reportId: "rollup-1" },
        options: { context: { tenant: "gamma" }, trx: { id: "trx-3" } }
      }
    ]);
  });
});

test("feature-server-generator end-to-end scaffolds dedicated feature packages outside packages/main", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-contract-outside-main");
    await createMinimalApp(appRoot, {
      name: "feature-server-contract-outside-main",
      withMainPackage: true
    });

    const mainPackageRoot = path.join(appRoot, "packages", "main");
    const mainBefore = await collectRelativeFiles(mainPackageRoot);
    await scaffoldFeaturePackage(appRoot, "billing-engine");

    const generatedPackageRoot = path.join(appRoot, "packages", "billing-engine");
    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));

    assert.equal(await fileExists(path.join(generatedPackageRoot, "package.descriptor.mjs")), true);
    assert.equal(await fileExists(path.join(appRoot, "packages", "main", "billing-engine")), false);
    assert.equal(
      await fileExists(path.join(appRoot, "packages", "main", "src", "server", "BillingEngineProvider.js")),
      false
    );
    assert.deepEqual(await collectRelativeFiles(mainPackageRoot), mainBefore);
    assert.equal(appPackageJson.dependencies["@local/billing-engine"], "file:packages/billing-engine");
    assert.equal(lock.installedPackages["@local/billing-engine"].source.packagePath, "packages/billing-engine");
    assert.equal(lock.installedPackages["@local/billing-engine"].source.type, "app-local-package");
  });
});
