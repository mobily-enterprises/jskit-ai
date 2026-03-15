import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLIENT_BOOTSTRAP_RESOLVED_ID,
  CLIENT_BOOTSTRAP_VIRTUAL_ID,
  createJskitClientBootstrapPlugin,
  createVirtualModuleSource,
  resolveClientOptimizeIncludeSpecifiers,
  resolveClientOptimizeExcludeSpecifiers,
  resolveInstalledClientPackageIds,
  resolveInstalledClientModules
} from "./clientBootstrapPlugin.js";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeDescriptor(filePath, descriptor) {
  await writeFile(filePath, `export default ${JSON.stringify(descriptor, null, 2)};\n`, "utf8");
}

test("createVirtualModuleSource renders deterministic client module imports", () => {
  const source = createVirtualModuleSource([
    {
      packageId: "@z/pkg",
      descriptorUiRoutes: [{ id: "z.route", path: "/z", scope: "global", componentKey: "z-view" }],
      descriptorClientProviders: [{ export: "ZProvider", entrypoint: "src/client/providers/ZProvider.js" }]
    },
    {
      packageId: "@a/pkg",
      descriptorUiRoutes: [{ id: "a.route", path: "/a", scope: "global", componentKey: "a-view" }],
      descriptorClientProviders: [{ export: "AProvider", entrypoint: "src/client/providers/AProvider.js" }]
    }
  ]);

  assert.match(source, /import \* as clientModule0 from "@a\/pkg\/client";/);
  assert.match(source, /import \* as clientModule1 from "@z\/pkg\/client";/);
  assert.match(source, /descriptorUiRoutes: \[\{"id":"a\.route","path":"\/a","scope":"global","componentKey":"a-view"\}\]/);
  assert.match(source, /descriptorClientProviders: \[\{"export":"AProvider","entrypoint":"src\/client\/providers\/AProvider\.js"\}\]/);
  assert.match(source, /descriptorUiRoutes: \[\{"id":"z\.route","path":"\/z","scope":"global","componentKey":"z-view"\}\]/);
  assert.match(source, /descriptorClientProviders: \[\{"export":"ZProvider","entrypoint":"src\/client\/providers\/ZProvider\.js"\}\]/);
  assert.match(source, /bootClientModules/);
  assert.match(source, /installedClientModules/);
});

test("resolveClientOptimizeExcludeSpecifiers excludes only local/app-local package clients", () => {
  const exclude = resolveClientOptimizeExcludeSpecifiers([
    {
      packageId: "@z/pkg",
      sourceType: "packages-directory",
      descriptorUiRoutes: []
    },
    {
      packageId: "@a/pkg",
      sourceType: "app-local-package",
      descriptorUiRoutes: []
    },
    {
      packageId: "@b/pkg",
      sourceType: "local-package",
      descriptorUiRoutes: []
    },
    {
      packageId: "@c/pkg",
      sourceType: "npm",
      descriptorUiRoutes: []
    }
  ]);

  assert.deepEqual(exclude, ["@a/pkg/client", "@b/pkg/client"]);
});

test("resolveClientOptimizeIncludeSpecifiers includes only non-local package clients", () => {
  const include = resolveClientOptimizeIncludeSpecifiers([
    {
      packageId: "@z/pkg",
      sourceType: "packages-directory",
      descriptorUiRoutes: []
    },
    {
      packageId: "@a/pkg",
      sourceType: "app-local-package",
      descriptorUiRoutes: []
    },
    {
      packageId: "@b/pkg",
      sourceType: "local-package",
      descriptorUiRoutes: []
    },
    {
      packageId: "@c/pkg",
      sourceType: "npm",
      descriptorUiRoutes: []
    }
  ]);

  assert.deepEqual(include, ["@c/pkg/client", "@z/pkg/client"]);
});

test("resolveInstalledClientPackageIds returns only installed packages with a client export", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-"));
  const appRoot = tempRoot;

  await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
  await writeJson(path.join(appRoot, ".jskit", "lock.json"), {
    lockVersion: 1,
    installedPackages: {
      "@example/has-client": {},
      "@example/no-client": {}
    }
  });

  await mkdir(path.join(appRoot, "node_modules", "@example", "has-client"), { recursive: true });
  await writeJson(path.join(appRoot, "node_modules", "@example", "has-client", "package.json"), {
    name: "@example/has-client",
    exports: {
      "./client": "./src/client/index.js"
    }
  });

  await mkdir(path.join(appRoot, "node_modules", "@example", "no-client"), { recursive: true });
  await writeJson(path.join(appRoot, "node_modules", "@example", "no-client", "package.json"), {
    name: "@example/no-client",
    exports: {
      "./server": "./src/server/index.js"
    }
  });

  const packageIds = await resolveInstalledClientPackageIds({
    appRoot,
    lockPath: ".jskit/lock.json"
  });

  assert.deepEqual(packageIds, ["@example/has-client"]);
});

test("resolveInstalledClientModules returns installed modules with client exports", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-modules-"));

  await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
  await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
    lockVersion: 1,
    installedPackages: {
      "@example/has-client": {}
    }
  });

  const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
  await mkdir(packageRoot, { recursive: true });
  await writeJson(path.join(packageRoot, "package.json"), {
    name: "@example/has-client",
    exports: {
      "./client": "./src/client/index.js"
    }
  });
  await writeDescriptor(path.join(packageRoot, "package.descriptor.mjs"), {
    runtime: {
      client: {
        providers: [
          {
            entrypoint: "src/client/providers/HasClientProvider.js",
            export: "HasClientProvider"
          }
        ]
      }
    },
    metadata: {
      ui: {
        routes: [
          {
            id: "auth.default-login-2",
            path: "/auth/default-login-2",
            scope: "global",
            componentKey: "auth-login",
            autoRegister: true
          }
        ]
      }
    }
  });
  const modules = await resolveInstalledClientModules({
    appRoot: tempRoot,
    lockPath: ".jskit/lock.json"
  });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].packageId, "@example/has-client");
  assert.equal(modules[0].sourceType, "");
  assert.equal(Array.isArray(modules[0].descriptorUiRoutes), true);
  assert.equal(modules[0].descriptorUiRoutes.length, 1);
  assert.equal(modules[0].descriptorUiRoutes[0].id, "auth.default-login-2");
  assert.equal(Array.isArray(modules[0].descriptorClientProviders), true);
  assert.equal(modules[0].descriptorClientProviders.length, 1);
  assert.equal(modules[0].descriptorClientProviders[0].export, "HasClientProvider");
});

test("resolveInstalledClientModules resolves descriptor via source.packagePath", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-package-path-"));

  await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
  await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
    lockVersion: 1,
    installedPackages: {
      "@example/has-client": {
        source: {
          type: "local-package",
          packagePath: "packages/has-client"
        }
      }
    }
  });

  const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
  await mkdir(packageRoot, { recursive: true });
  await writeJson(path.join(packageRoot, "package.json"), {
    name: "@example/has-client",
    exports: {
      "./client": "./src/client/index.js"
    }
  });
  await mkdir(path.join(tempRoot, "packages", "has-client"), { recursive: true });
  await writeDescriptor(path.join(tempRoot, "packages", "has-client", "package.descriptor.mjs"), {
    runtime: {
      client: {
        providers: [
          {
            entrypoint: "src/client/providers/LocalClientProvider.js",
            export: "LocalClientProvider"
          }
        ]
      }
    },
    metadata: {
      ui: {
        routes: [
          {
            id: "local.route",
            path: "/local",
            scope: "global",
            componentKey: "local-view",
            autoRegister: true
          }
        ]
      }
    }
  });

  const modules = await resolveInstalledClientModules({
    appRoot: tempRoot,
    lockPath: ".jskit/lock.json"
  });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].packageId, "@example/has-client");
  assert.equal(modules[0].sourceType, "local-package");
  assert.equal(modules[0].descriptorUiRoutes.length, 1);
  assert.equal(modules[0].descriptorUiRoutes[0].id, "local.route");
  assert.equal(modules[0].descriptorClientProviders.length, 1);
  assert.equal(modules[0].descriptorClientProviders[0].export, "LocalClientProvider");
});

test("createJskitClientBootstrapPlugin resolves and loads virtual module", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-plugin-"));
  const previousCwd = process.cwd();

  try {
    await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
    await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
      lockVersion: 1,
      installedPackages: {
        "@example/has-client": {
          source: {
            type: "packages-directory"
          }
        }
      }
    });

    const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
    await mkdir(packageRoot, { recursive: true });
    await writeJson(path.join(packageRoot, "package.json"), {
      name: "@example/has-client",
      exports: {
        "./client": "./src/client/index.js"
      }
    });
    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();

    const resolvedId = plugin.resolveId(CLIENT_BOOTSTRAP_VIRTUAL_ID);
    assert.equal(resolvedId, CLIENT_BOOTSTRAP_RESOLVED_ID);

    const source = await plugin.load(CLIENT_BOOTSTRAP_RESOLVED_ID);
    assert.match(String(source || ""), /@example\/has-client\/client/);
    assert.match(String(source || ""), /bootInstalledClientModules/);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes installed client package specifiers from optimizeDeps", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-"));
  const previousCwd = process.cwd();

  try {
    await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
    await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
      lockVersion: 1,
      installedPackages: {
        "@example/has-client": {
          source: {
            type: "packages-directory"
          }
        }
      }
    });

    const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
    await mkdir(packageRoot, { recursive: true });
    await writeJson(path.join(packageRoot, "package.json"), {
      name: "@example/has-client",
      exports: {
        "./client": "./src/client/index.js"
      }
    });

    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();
    const result = await plugin.config({
      optimizeDeps: {
        include: ["a"],
        exclude: ["already/excluded"]
      }
    });

    assert.equal(Array.isArray(result?.optimizeDeps?.exclude), true);
    assert.deepEqual(result.optimizeDeps.exclude, ["already/excluded"]);
    assert.deepEqual(result.optimizeDeps.include, ["@example/has-client/client", "a"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes only local package clients", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-local-"));
  const previousCwd = process.cwd();

  try {
    await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
    await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
      lockVersion: 1,
      installedPackages: {
        "@example/local-client": {
          source: {
            type: "local-package"
          }
        },
        "@example/remote-client": {
          source: {
            type: "packages-directory"
          }
        }
      }
    });

    const localPackageRoot = path.join(tempRoot, "node_modules", "@example", "local-client");
    await mkdir(localPackageRoot, { recursive: true });
    await writeJson(path.join(localPackageRoot, "package.json"), {
      name: "@example/local-client",
      exports: {
        "./client": "./src/client/index.js"
      }
    });

    const remotePackageRoot = path.join(tempRoot, "node_modules", "@example", "remote-client");
    await mkdir(remotePackageRoot, { recursive: true });
    await writeJson(path.join(remotePackageRoot, "package.json"), {
      name: "@example/remote-client",
      exports: {
        "./client": "./src/client/index.js"
      }
    });

    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();
    const result = await plugin.config({});

    assert.deepEqual(result.optimizeDeps.exclude, ["@example/local-client/client"]);
    assert.deepEqual(result.optimizeDeps.include, ["@example/remote-client/client"]);
  } finally {
    process.chdir(previousCwd);
  }
});
