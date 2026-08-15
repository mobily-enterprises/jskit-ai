import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";

test("installed runtime composes explicit package providers and application inputs", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-runtime-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
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
        capabilities: {
          requires: ["runtime.env"],
          provides: ["feature.example"]
        },
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
    logger: { info() {} },
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

test("installed runtime attaches one idempotent Fastify shutdown hook", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-runtime-close-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  const hooks = [];
  const fastify = {
    addHook(name, handler) {
      hooks.push({ name, handler });
    }
  };
  const installed = await createInstalledRuntime({ appRoot, fastify });
  const closeHook = hooks.find((entry) => entry.name === "onClose");
  assert.ok(closeHook);
  await closeHook.handler();
  await closeHook.handler();
  assert.equal(installed.runtime.diagnostics().lifecycleState, "stopped");
});
