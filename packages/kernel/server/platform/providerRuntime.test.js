import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createProviderRuntimeFromApp } from "./providerRuntime.js";

async function createTestAppRoot(prefix) {
  const appRoot = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
  await writeFile(
    path.join(appRoot, ".jskit", "lock.json"),
    `${JSON.stringify({ lockVersion: 1, installedPackages: {} }, null, 2)}\n`,
    "utf8"
  );
  return appRoot;
}

test("createProviderRuntimeFromApp discovers package providers from descriptor discover entries", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-discover-");
  try {
    await mkdir(path.join(appRoot, "packages", "local-example", "src", "server", "providers"), { recursive: true });
    await writeFile(
      path.join(appRoot, ".jskit", "lock.json"),
      `${JSON.stringify(
        {
          lockVersion: 1,
          installedPackages: {
            "@local/example": {
              packageId: "@local/example",
              version: "0.1.0",
              source: {
                type: "local-package",
                packagePath: "packages/local-example"
              },
              managed: {
                packageJson: {
                  dependencies: {},
                  devDependencies: {},
                  scripts: {}
                },
                text: {},
                files: []
              },
              options: {},
              installedAt: "2026-01-01T00:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "local-example", "package.descriptor.mjs"),
      [
        "export default Object.freeze({",
        "  packageVersion: 1,",
        "  packageId: \"@local/example\",",
        "  version: \"0.1.0\",",
        "  description: \"Local example package\",",
        "  dependsOn: [],",
        "  capabilities: {",
        "    provides: [],",
        "    requires: []",
        "  },",
        "  runtime: {",
        "    server: {",
        "      providers: [",
        "        { discover: { dir: \"src/server/providers\", pattern: \"*Provider.js\" } }",
        "      ]",
        "    }",
        "  }",
        "});"
      ].join("\n"),
      "utf8"
    );
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

test("createProviderRuntimeFromApp ignores legacy app local src/server/providers folder", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-legacy-app-local-");
  try {
    await mkdir(path.join(appRoot, "src", "server", "providers"), { recursive: true });
    await writeFile(
      path.join(appRoot, "src", "server", "providers", "LegacyProvider.js"),
      [
        "export default class LegacyProvider {",
        "  static id = \"legacy.app.local\";",
        "  register(app) {",
        "    app.instance(\"legacy.value\", true);",
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
    assert.equal(runtime.app.has("legacy.value"), false);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});

test("createProviderRuntimeFromApp resolves descriptor using source.packagePath", async () => {
  const appRoot = await createTestAppRoot("kernel-provider-runtime-local-package-");
  try {
    await mkdir(path.join(appRoot, "packages", "local-example"), { recursive: true });
    await writeFile(
      path.join(appRoot, ".jskit", "lock.json"),
      `${JSON.stringify(
        {
          lockVersion: 1,
          installedPackages: {
            "@local/example": {
              packageId: "@local/example",
              version: "0.1.0",
              source: {
                type: "local-package",
                packagePath: "packages/local-example"
              },
              managed: {
                packageJson: {
                  dependencies: {},
                  devDependencies: {},
                  scripts: {}
                },
                text: {},
                files: []
              },
              options: {},
              installedAt: "2026-01-01T00:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(appRoot, "packages", "local-example", "package.descriptor.mjs"),
      [
        "export default Object.freeze({",
        "  packageVersion: 1,",
        "  packageId: \"@local/example\",",
        "  version: \"0.1.0\",",
        "  description: \"Local example package\",",
        "  dependsOn: [],",
        "  capabilities: {",
        "    provides: [],",
        "    requires: []",
        "  },",
        "  runtime: {",
        "    server: {",
        "      providers: []",
        "    }",
        "  }",
        "});"
      ].join("\n"),
      "utf8"
    );

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
