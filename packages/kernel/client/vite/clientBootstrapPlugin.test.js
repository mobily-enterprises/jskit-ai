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
  resolveLocalScopeOptimizeExcludeSpecifiers,
  resolveClientOptimizeIncludeSpecifiers,
  resolveClientOptimizeExcludeSpecifiers,
  resolveLocalScopePackageIds,
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

test("resolveClientOptimizeExcludeSpecifiers excludes local/app-local package roots and client/shared subpaths", () => {
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

  assert.deepEqual(exclude, [
    "@a/pkg",
    "@a/pkg/client",
    "@a/pkg/shared",
    "@b/pkg",
    "@b/pkg/client",
    "@b/pkg/shared"
  ]);
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

test("resolveLocalScopeOptimizeExcludeSpecifiers expands @local package ids to root/client/shared", () => {
  const exclude = resolveLocalScopeOptimizeExcludeSpecifiers(["@local/app", "@local/feature"]);
  assert.deepEqual(exclude, [
    "@local/app",
    "@local/app/client",
    "@local/app/shared",
    "@local/feature",
    "@local/feature/client",
    "@local/feature/shared"
  ]);
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
      client: {
        optimizeDeps: {
          include: ["mime-match"]
        }
      },
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
  assert.equal(Array.isArray(modules[0].descriptorClientOptimizeIncludeSpecifiers), true);
  assert.deepEqual(modules[0].descriptorClientOptimizeIncludeSpecifiers, ["mime-match"]);
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

test("resolveLocalScopePackageIds reads @local packages from lock and package.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-local-scope-"));
  await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
  await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
    lockVersion: 1,
    installedPackages: {
      "@local/main": {
        source: {
          type: "packages-directory"
        }
      },
      "@example/remote": {
        source: {
          type: "packages-directory"
        }
      }
    }
  });
  await writeJson(path.join(tempRoot, "package.json"), {
    name: "fixture-app",
    dependencies: {
      "@local/feature": "file:packages/feature",
      "@example/remote": "^1.0.0"
    },
    devDependencies: {
      "@local/dev-only": "file:packages/dev-only"
    }
  });

  const packageIds = await resolveLocalScopePackageIds({
    appRoot: tempRoot,
    lockPath: ".jskit/lock.json"
  });

  assert.deepEqual(packageIds, ["@local/dev-only", "@local/feature", "@local/main"]);
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
    assert.deepEqual(result.resolve.dedupe, ["@tanstack/vue-query", "vue", "vue-router", "vuetify"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes local package roots and client/shared subpaths", async () => {
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
    await writeDescriptor(path.join(localPackageRoot, "package.descriptor.mjs"), {
      metadata: {
        client: {
          optimizeDeps: {
            include: ["mime-match"]
          }
        }
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

    assert.deepEqual(result.optimizeDeps.exclude, [
      "@example/local-client",
      "@example/local-client/client",
      "@example/local-client/shared"
    ]);
    assert.deepEqual(result.optimizeDeps.include, ["@example/remote-client/client", "mime-match"]);
    assert.deepEqual(result.resolve.dedupe, ["@tanstack/vue-query", "vue", "vue-router", "vuetify"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config preserves user resolve fields and merges dedupe", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-resolve-"));
  const previousCwd = process.cwd();

  try {
    await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
    await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
      lockVersion: 1,
      installedPackages: {}
    });

    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();
    const result = await plugin.config({
      resolve: {
        alias: {
          "@": "/tmp/app/src"
        },
        dedupe: ["vue", "custom-lib"]
      }
    });

    assert.deepEqual(result.resolve.alias, {
      "@": "/tmp/app/src"
    });
    assert.deepEqual(result.resolve.dedupe, ["@tanstack/vue-query", "custom-lib", "vue", "vue-router", "vuetify"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes all @local scoped packages from lock and package.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-local-scope-config-"));
  const previousCwd = process.cwd();

  try {
    await mkdir(path.join(tempRoot, ".jskit"), { recursive: true });
    await writeJson(path.join(tempRoot, ".jskit", "lock.json"), {
      lockVersion: 1,
      installedPackages: {
        "@local/main": {
          source: {
            type: "packages-directory"
          }
        },
        "@example/remote-client": {
          source: {
            type: "packages-directory"
          }
        }
      }
    });
    await writeJson(path.join(tempRoot, "package.json"), {
      name: "fixture-app",
      dependencies: {
        "@local/feature": "file:packages/feature",
        "@example/remote-client": "^1.0.0"
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

    assert.deepEqual(result.optimizeDeps.exclude, [
      "@local/feature",
      "@local/feature/client",
      "@local/feature/shared",
      "@local/main",
      "@local/main/client",
      "@local/main/shared"
    ]);
    assert.deepEqual(result.optimizeDeps.include, ["@example/remote-client/client"]);
  } finally {
    process.chdir(previousCwd);
  }
});
