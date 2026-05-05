import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import { createCliRunner } from "../../testUtils/runCli.js";

const CLI_PATH = fileURLToPath(new URL("../bin/jskit.js", import.meta.url));
const runCli = createCliRunner(CLI_PATH);

async function createMinimalApp(appRoot, { name = "feature-server-generator-app", withConfig = false } = {}) {
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
    },
    home: {
      id: "home",
      pagesRoot: "",
      enabled: true,
      requiresAuth: false
    }
  }
};

export default config;
export { config };
`,
      "utf8"
    );
  }
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

test("generate feature-server-generator scaffold creates the default json-rest package shape", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-json-rest");
    await createMinimalApp(appRoot, { name: "feature-server-json-rest" });

    const result = runCli({
      cwd: appRoot,
      args: ["generate", "feature-server-generator", "scaffold", "booking-engine"]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));
    assert.match(String(result.stdout || ""), /Generated with @jskit-ai\/feature-server-generator\./);

    const packageRoot = path.join(appRoot, "packages", "booking-engine");
    const providerSource = await readFile(path.join(packageRoot, "src", "server", "BookingEngineProvider.js"), "utf8");
    const repositorySource = await readFile(path.join(packageRoot, "src", "server", "repository.js"), "utf8");
    const descriptorSource = await readFile(path.join(packageRoot, "package.descriptor.mjs"), "utf8");
    const appPackageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(appRoot, ".jskit", "lock.json"), "utf8"));

    assert.match(providerSource, /INTERNAL_JSON_REST_API/);
    assert.match(providerSource, /feature\.booking-engine\.repository/);
    assert.match(repositorySource, /createJsonRestContext/);
    assert.match(repositorySource, /persistence: "json-rest"/);
    assert.match(descriptorSource, /scaffoldMode: "json-rest"/);
    assert.match(descriptorSource, /lane: "default"/);
    assert.equal(await fileExists(path.join(packageRoot, "src", "server", "registerRoutes.js")), false);
    assert.match(providerSource, /boot\(\) \{\}/);
    assert.doesNotMatch(providerSource, /import \{ registerRoutes \}/);
    assert.equal(appPackageJson.dependencies["@local/booking-engine"], "file:packages/booking-engine");
    assert.equal(typeof appPackageJson.dependencies["@jskit-ai/kernel"], "string");
    assert.equal(typeof appPackageJson.dependencies["@jskit-ai/json-rest-api-core"], "string");
    assert.equal(typeof appPackageJson.dependencies["@jskit-ai/database-runtime"], "string");
    assert.equal(typeof appPackageJson.dependencies["@jskit-ai/database-runtime-mysql"], "string");
    assert.equal(appPackageJson.dependencies["json-rest-schema"], "1.x.x");
    assert.equal(appPackageJson.dependencies["@jskit-ai/feature-server-generator"], undefined);
    assert.equal(lock.installedPackages["@local/booking-engine"].source.type, "app-local-package");
  });
});

test("generate feature-server-generator scaffold supports orchestrator mode with optional routes", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-orchestrator");
    await createMinimalApp(appRoot, {
      name: "feature-server-orchestrator",
      withConfig: true
    });

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "feature-server-generator",
        "scaffold",
        "availability-engine",
        "--mode",
        "orchestrator",
        "--route-prefix",
        "admin/availability-engine",
        "--surface",
        "admin"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));

    const packageRoot = path.join(appRoot, "packages", "availability-engine");
    const actionsSource = await readFile(path.join(packageRoot, "src", "server", "actions.js"), "utf8");
    const serviceSource = await readFile(path.join(packageRoot, "src", "server", "service.js"), "utf8");
    const routesSource = await readFile(path.join(packageRoot, "src", "server", "registerRoutes.js"), "utf8");
    const descriptorSource = await readFile(path.join(packageRoot, "package.descriptor.mjs"), "utf8");

    assert.equal(await fileExists(path.join(packageRoot, "src", "server", "repository.js")), false);
    assert.equal(await fileExists(path.join(packageRoot, "src", "server", "registerRoutes.js")), true);
    assert.match(actionsSource, /surfaces: \["admin"\]/);
    assert.match(serviceSource, /orchestration logic/);
    assert.match(routesSource, /surface: normalizedRouteSurface/);
    assert.match(routesSource, /auth: "public"/);
    assert.match(descriptorSource, /scaffoldMode: "orchestrator"/);
    assert.match(descriptorSource, /lane: "default"/);
  });
});

test("generate feature-server-generator scaffold supports the explicit custom-knex lane", async () => {
  await withTempDir(async (cwd) => {
    const appRoot = path.join(cwd, "feature-server-custom-knex");
    await createMinimalApp(appRoot, { name: "feature-server-custom-knex" });

    const result = runCli({
      cwd: appRoot,
      args: [
        "generate",
        "feature-server-generator",
        "scaffold",
        "invoice-rollup",
        "--mode",
        "custom-knex"
      ]
    });

    assert.equal(result.status, 0, String(result.stderr || ""));

    const packageRoot = path.join(appRoot, "packages", "invoice-rollup");
    const providerSource = await readFile(path.join(packageRoot, "src", "server", "InvoiceRollupProvider.js"), "utf8");
    const repositorySource = await readFile(path.join(packageRoot, "src", "server", "repository.js"), "utf8");
    const descriptorSource = await readFile(path.join(packageRoot, "package.descriptor.mjs"), "utf8");

    assert.match(providerSource, /jskit\.database\.knex/);
    assert.match(repositorySource, /createWithTransaction/);
    assert.match(repositorySource, /persistence: "custom-knex"/);
    assert.match(descriptorSource, /scaffoldMode: "custom-knex"/);
    assert.match(descriptorSource, /lane: "weird-custom"/);
  });
});

test("generate feature-server-generator scaffold help exposes mode guidance and examples", () => {
  const result = runCli({
    args: ["generate", "feature-server-generator", "scaffold", "help"]
  });

  assert.equal(result.status, 0, String(result.stderr || ""));
  const stdout = String(result.stdout || "");
  assert.match(stdout, /Generator subcommand help: @jskit-ai\/feature-server-generator scaffold/);
  assert.match(stdout, /--mode <text> \[optional; default: json-rest\]/);
  assert.match(stdout, /custom-knex is the explicit weird\/custom lane/);
  assert.match(stdout, /booking-engine/);
  assert.match(stdout, /availability-engine/);
  assert.match(stdout, /billing-engine/);
  assert.match(stdout, /invoice-rollup/);
});
