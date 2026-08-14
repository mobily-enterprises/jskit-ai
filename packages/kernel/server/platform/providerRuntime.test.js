import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createProviderRuntimeFromApp } from "./providerRuntime.js";

async function createTestAppRoot(prefix) {
  const appRoot = await mkdtemp(path.join(tmpdir(), prefix));
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({ name: "fixture-app", private: true, type: "module" }, null, 2)}\n`,
    "utf8"
  );
  return appRoot;
}

async function declareLocalPackage(appRoot, packageId, packagePath, jskit = {}) {
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify({
      name: "fixture-app",
      private: true,
      type: "module",
      dependencies: {
        [packageId]: `file:${packagePath}`
      }
    }, null, 2)}\n`,
    "utf8"
  );
  const packageRoot = path.join(appRoot, packagePath);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: packageId,
      version: "0.1.0",
      description: "Local example package",
      type: "module",
      jskit
    }, null, 2)}\n`,
    "utf8"
  );
}

test("createProviderRuntimeFromApp discovers package providers from package metadata", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-discover-");
  try {
    await mkdir(path.join(appRoot, "packages", "local-example", "src", "server", "providers"), { recursive: true });
    await declareLocalPackage(appRoot, "@local/example", "packages/local-example", {
      capabilities: { provides: [], requires: [] },
      runtime: {
        server: {
          providers: [
            { discover: { dir: "src/server/providers", pattern: "*Provider.js" } }
          ]
        }
      }
    });
    await writeFile(
      path.join(appRoot, "packages", "local-example", "src", "server", "providers", "AlphaProvider.js"),
      [
        "export default class AlphaProvider {",
        "  static id = \"example.alpha\";",
        "  register(app) {",
        "    app.instance(\"example.alpha.value\", 42);",
        "  }",
        "  boot() {}",
        "}"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "local-example", "src", "server", "providers", "ignored.js"),
      "export const value = 1;\n",
      "utf8"
    );

    const runtime = await createProviderRuntimeFromApp({
      appRoot,
      profile: "app"
    });

    assert.deepEqual(runtime.packageOrder, ["@local/example"]);
    assert.deepEqual(runtime.providerPackageOrder, ["@local/example"]);
    assert.equal(runtime.appLocalProviderOrder.length, 0);
    assert.deepEqual(runtime.diagnostics.providerOrder, ["example.alpha", "runtime.actions", "runtime.server"]);
    assert.equal(runtime.app.make("example.alpha.value"), 42);
    assert.equal(typeof runtime.app.make("actionExecutor")?.execute, "function");
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("createProviderRuntimeFromApp ignores app-local src/server/providers folder", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-app-local-");
  try {
    await mkdir(path.join(appRoot, "src", "server", "providers"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "server", "providers", "IgnoredProvider.js"),
      [
        "export default class IgnoredProvider {",
        "  static id = \"ignored.app.local\";",
        "  register(app) {",
        "    app.instance(\"ignored.value\", true);",
        "  }",
        "  boot() {}",
        "}"
      ].join("\n"),
      "utf8"
    );

    const runtime = await createProviderRuntimeFromApp({
      appRoot,
      profile: "app"
    });

    assert.deepEqual(runtime.packageOrder, []);
    assert.deepEqual(runtime.providerPackageOrder, []);
    assert.equal(runtime.appLocalProviderOrder.length, 0);
    assert.deepEqual(runtime.diagnostics.providerOrder, ["runtime.actions", "runtime.server"]);
    assert.equal(runtime.app.has("ignored.value"), false);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("createProviderRuntimeFromApp resolves package metadata from a file dependency", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-local-package-");
  try {
    await mkdir(path.join(appRoot, "packages", "local-example"), { recursive: true });
    await declareLocalPackage(appRoot, "@local/example", "packages/local-example", {
      capabilities: { provides: [], requires: [] },
      runtime: { server: { providers: [] } }
    });

    const runtime = await createProviderRuntimeFromApp({
      appRoot,
      profile: "app"
    });

    assert.deepEqual(runtime.packageOrder, ["@local/example"]);
    assert.deepEqual(runtime.providerPackageOrder, []);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("createProviderRuntimeFromApp wires fastify onClose to provider shutdown exactly once", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-fastify-close-");
  try {
    await mkdir(path.join(appRoot, "packages", "local-example", "src", "server", "providers"), { recursive: true });
    await declareLocalPackage(appRoot, "@local/example", "packages/local-example", {
      capabilities: { provides: [], requires: [] },
      runtime: {
        server: {
          providers: [
            { discover: { dir: "src/server/providers", pattern: "*Provider.js" } }
          ]
        }
      }
    });
    await writeFile(
      path.join(appRoot, "packages", "local-example", "src", "server", "providers", "CloseAwareProvider.js"),
      [
        "export default class CloseAwareProvider {",
        "  static id = \"example.close-aware\";",
        "  register(app) {",
        "    app.instance(\"example.close.state\", { shutdownCalls: 0 });",
        "  }",
        "  async boot() {}",
        "  async shutdown(app) {",
        "    app.make(\"example.close.state\").shutdownCalls += 1;",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const hooks = [];
    const fastify = {
      route() {},
      setErrorHandler() {},
      addContentTypeParser() {},
      hasContentTypeParser() {
        return false;
      },
      getDefaultJsonParser() {
        return (_request, body, done) => done(null, body);
      },
      addHook(name, handler) {
        hooks.push({ name, handler });
      }
    };

    const runtime = await createProviderRuntimeFromApp({
      appRoot,
      profile: "app",
      fastify
    });

    const closeHook = hooks.find((entry) => entry.name === "onClose");
    assert.ok(closeHook);
    assert.equal(runtime.app.make("example.close.state").shutdownCalls, 0);

    await closeHook.handler();
    await closeHook.handler();

    assert.equal(runtime.app.make("example.close.state").shutdownCalls, 1);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
