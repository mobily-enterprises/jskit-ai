import assert from "node:assert/strict";
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

/**
 * Writes a fixture app with one package whose provider requires runtime.env and provides feature.example.
 * @param {{ requires: string[], provides: string[] }} capabilities The package manifest's capabilities.
 */
async function writeExampleApp(capabilities) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-runtime-"));
  const packageRoot = path.join(appRoot, "packages", "example");
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({
      name: "fixture-app",
      private: true,
      dependencies: { "@fixture/example": "file:packages/example" }
    })
  );
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@fixture/example",
      version: "0.1.0",
      type: "module",
      jskit: {
        kind: "runtime",
        capabilities,
        runtime: {
          server: {
            providers: [{ entrypoint: "src/provider.js", export: "ExampleProvider" }]
          }
        }
      }
    })
  );
  await writeFile(
    path.join(packageRoot, "src", "provider.js"),
    [
      "export const ExampleProvider = {",
      "  id: 'feature.example',",
      "  requires: { env: 'runtime.env' },",
      "  provides: { example: 'feature.example' },",
      "  setup({ env }) { return { example: { name: env.APP_NAME } }; }",
      "};"
    ].join("\n")
  );
  return appRoot;
}

/**
 * Runs `work` and lists the package.json files under appRoot that it read.
 * @param {string} appRoot
 * @param {() => Promise<unknown>} work
 */
async function manifestReadsDuring(appRoot, work) {
  const { readFile } = fsPromises;
  const reads = [];
  fsPromises.readFile = function countedReadFile(filePath, ...rest) {
    const readPath = String(filePath);
    if (readPath.startsWith(appRoot) && path.basename(readPath) === "package.json") {
      reads.push(path.relative(appRoot, readPath));
    }
    return readFile.call(this, filePath, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await work();
  } finally {
    fsPromises.readFile = readFile;
    syncBuiltinESMExports();
  }
  return reads.sort();
}

test("installed runtime composes explicit package providers and application inputs", async (context) => {
  const appRoot = await writeExampleApp({
    requires: ["runtime.env"],
    provides: ["feature.example"]
  });
  context.after(() => rm(appRoot, { recursive: true, force: true }));

  let observed = null;
  const observer = defineProvider({
    id: "fixture.observer",
    requires: {
      actions: "runtime.actions",
      example: "feature.example",
      logger: "runtime.logger"
    },
    setup(dependencies) {
      observed = dependencies;
    }
  });
  const runtime = await createInstalledRuntime({
    appRoot,
    env: { APP_NAME: "Books" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    providers: [observer]
  });

  assert.equal(observed.example.name, "Books");
  assert.equal(typeof observed.actions.execute, "function");
  assert.equal(typeof observed.logger.info, "function");
  assert.deepEqual(runtime.packageOrder, ["@fixture/example"]);
  assert.deepEqual(runtime.providerPackageOrder, ["@fixture/example"]);
  assert.deepEqual(runtime.diagnostics.providerOrder, [
    "feature.example",
    "runtime.events",
    "runtime.actions",
    "fixture.observer"
  ]);
  assert.equal(Object.hasOwn(runtime, "app"), false);
});

test("a second boot of an installed app reads no package manifests until its packages change", async (context) => {
  const appRoot = await writeExampleApp({
    requires: ["runtime.env"],
    provides: ["feature.example"]
  });
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  const lockfilePath = path.join(appRoot, "node_modules", ".package-lock.json");
  await mkdir(path.dirname(lockfilePath), { recursive: true });
  await writeFile(lockfilePath, JSON.stringify({ name: "fixture-app", lockfileVersion: 3, packages: {} }));
  const boot = () => createInstalledRuntime({ appRoot, env: { APP_NAME: "Books" }, logger: silentLogger });
  const manifests = ["package.json", path.join("packages", "example", "package.json")];

  assert.deepEqual(await manifestReadsDuring(appRoot, boot), manifests);
  assert.deepEqual(await manifestReadsDuring(appRoot, boot), []);
  assert.deepEqual(await manifestReadsDuring(appRoot, boot), []);

  // npm rewrites its hidden lockfile on every install.
  await writeFile(lockfilePath, JSON.stringify({ name: "fixture-app", lockfileVersion: 3, packages: { "": {} } }));
  assert.deepEqual(await manifestReadsDuring(appRoot, boot), manifests);
  assert.deepEqual(await manifestReadsDuring(appRoot, boot), []);
});

test("installed runtime attaches one idempotent Fastify shutdown hook", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-runtime-close-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  const hooks = [];
  const fastify = {
    addHook(name, handler) {
      hooks.push({ name, handler });
    },
    route() {},
    setErrorHandler() {}
  };
  const installed = await createInstalledRuntime({ appRoot, fastify, logger: silentLogger });
  const closeHook = hooks.find((entry) => entry.name === "onClose");
  assert.ok(closeHook);
  await closeHook.handler();
  await closeHook.handler();
  assert.equal(installed.runtime.diagnostics().lifecycleState, "stopped");
});

test("installed runtime refuses a package whose manifest disagrees with its providers", async (context) => {
  const appRoot = await writeExampleApp({
    requires: [],
    provides: ["feature.example"]
  });
  context.after(() => rm(appRoot, { recursive: true, force: true }));

  await assert.rejects(
    createInstalledRuntime({ appRoot, env: {}, logger: silentLogger }),
    { message: "Package @fixture/example requires capability runtime.env in its providers but not in its manifest." }
  );
});
