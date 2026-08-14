import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLIENT_BOOTSTRAP_RESOLVED_ID,
  CLIENT_BOOTSTRAP_VIRTUAL_ID,
  createJskitClientBootstrapPlugin,
  createVirtualModuleSource,
  resolveCanonicalLocalPackageId,
  resolveLocalPackageForSpecifier,
  resolveLocalPackageSources,
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

async function writePackageMetadata(packageRoot, packageMetadata) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const { packageId, version, description, ...jskit } = packageMetadata;
  packageJson.name = packageId || packageJson.name;
  packageJson.version = version || packageJson.version;
  if (description) {
    packageJson.description = description;
  }
  packageJson.jskit = Object.keys(jskit).length > 0 ? jskit : { kind: "runtime" };
  await writeJson(packageJsonPath, packageJson);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function declareInstalledPackages(appRoot, packages = {}) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = (await pathExists(packageJsonPath))
    ? JSON.parse(await readFile(packageJsonPath, "utf8"))
    : { name: "fixture-app", private: true, type: "module" };
  packageJson.dependencies = { ...(packageJson.dependencies || {}) };

  for (const [packageId, options] of Object.entries(packages)) {
    const packagePath = String(options?.packagePath || "").trim();
    const packageRoot = packagePath
      ? path.join(appRoot, packagePath)
      : path.join(appRoot, "node_modules", ...packageId.split("/"));
    packageJson.dependencies[packageId] = packagePath ? `file:${packagePath}` : "1.0.0";
    await mkdir(packageRoot, { recursive: true });
    const installedPackageJsonPath = path.join(packageRoot, "package.json");
    if (!(await pathExists(installedPackageJsonPath))) {
      await writeJson(installedPackageJsonPath, {
        name: packageId,
        version: "1.0.0",
        exports: options?.exports || {}
      });
    }
    if (!JSON.parse(await readFile(installedPackageJsonPath, "utf8")).jskit) {
      await writePackageMetadata(packageRoot, {
        packageId,
        version: "1.0.0"
      });
    }
  }

  await writeJson(packageJsonPath, packageJson);
}

test("resolveLocalPackageSources includes every file dependency regardless of scope or exports", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-local-resolution-"));
  await declareInstalledPackages(tempRoot, {
    "@local/main": { packagePath: "packages/main" },
    "@local/feature": { packagePath: "packages/feature" },
    "@example/local-utility": { packagePath: "packages/utility" },
    "@example/published": {}
  });

  const localPackages = await resolveLocalPackageSources({ appRoot: tempRoot });
  assert.deepEqual(localPackages.map((entry) => entry.packageId), [
    "@example/local-utility",
    "@local/feature",
    "@local/main"
  ]);
  const mainPackage = localPackages.find((entry) => entry.packageId === "@local/main");
  assert.equal(
    mainPackage.installedPackageRoot,
    path.join(tempRoot, "node_modules", "@local", "main")
  );
  assert.equal(
    mainPackage.sourcePackageRoot,
    path.join(tempRoot, "packages", "main")
  );
  assert.equal(resolveLocalPackageForSpecifier("@local/main/client", localPackages), mainPackage);
  assert.equal(
    resolveLocalPackageForSpecifier("@example/local-utility/shared?raw", localPackages)?.packageId,
    "@example/local-utility"
  );
  assert.equal(resolveLocalPackageForSpecifier("@example/published/client", localPackages), null);
});

test("resolveCanonicalLocalPackageId translates Vite's selected export target to source", () => {
  const localPackage = {
    installedPackageRoot: path.join("/app", "node_modules", "@local", "main"),
    sourcePackageRoot: path.join("/app", "packages", "main")
  };

  assert.equal(
    resolveCanonicalLocalPackageId(
      "/app/node_modules/@local/main/browser/condition-entry.js?vue&type=script",
      localPackage
    ),
    "/app/packages/main/browser/condition-entry.js?vue&type=script"
  );
  assert.equal(
    resolveCanonicalLocalPackageId("/app/packages/main/browser/already-source.js", localPackage),
    "/app/packages/main/browser/already-source.js"
  );
  assert.equal(resolveCanonicalLocalPackageId("/app/node_modules/published/index.js", localPackage), "");
});

test("createVirtualModuleSource renders deterministic client module imports", () => {
  const source = createVirtualModuleSource([
    {
      packageId: "@z/pkg",
      packageMetadataUiRoutes: [{ id: "z.route", path: "/z", scope: "global", componentKey: "z-view" }],
      packageMetadataClientProviders: [{ export: "ZProvider", entrypoint: "src/client/providers/ZProvider.js" }]
    },
    {
      packageId: "@a/pkg",
      packageMetadataUiRoutes: [{ id: "a.route", path: "/a", scope: "global", componentKey: "a-view" }],
      packageMetadataClientProviders: [{ export: "AProvider", entrypoint: "src/client/providers/AProvider.js" }]
    }
  ]);

  assert.match(source, /import \* as clientModule0 from "@a\/pkg\/client";/);
  assert.match(source, /import \* as clientModule1 from "@z\/pkg\/client";/);
  assert.match(source, /packageMetadataUiRoutes: \[\{"id":"a\.route","path":"\/a","scope":"global","componentKey":"a-view"\}\]/);
  assert.match(source, /packageMetadataClientProviders: \[\{"export":"AProvider","entrypoint":"src\/client\/providers\/AProvider\.js"\}\]/);
  assert.match(source, /packageMetadataUiRoutes: \[\{"id":"z\.route","path":"\/z","scope":"global","componentKey":"z-view"\}\]/);
  assert.match(source, /packageMetadataClientProviders: \[\{"export":"ZProvider","entrypoint":"src\/client\/providers\/ZProvider\.js"\}\]/);
  assert.match(source, /bootClientModules/);
  assert.match(source, /installedClientModules/);
});

test("resolveClientOptimizeExcludeSpecifiers excludes local/app-local package roots and client/shared subpaths", () => {
  const exclude = resolveClientOptimizeExcludeSpecifiers([
    {
      packageId: "@z/pkg",
      sourceType: "packages-directory",
      packageMetadataUiRoutes: []
    },
    {
      packageId: "@a/pkg",
      sourceType: "app-local-package",
      packageMetadataUiRoutes: []
    },
    {
      packageId: "@b/pkg",
      sourceType: "local-package",
      packageMetadataUiRoutes: []
    },
    {
      packageId: "@c/pkg",
      sourceType: "npm",
      packageMetadataUiRoutes: []
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

test("resolveClientOptimizeExcludeSpecifiers includes packageMetadata-declared excludes", () => {
  const exclude = resolveClientOptimizeExcludeSpecifiers([
    {
      packageId: "@z/pkg",
      sourceType: "packages-directory",
      packageMetadataUiRoutes: [],
      packageMetadataClientOptimizeExcludeSpecifiers: ["@z/pkg/client"]
    },
    {
      packageId: "@a/pkg",
      sourceType: "local-package",
      packageMetadataUiRoutes: [],
      packageMetadataClientOptimizeExcludeSpecifiers: ["external-problem-dep"]
    }
  ]);

  assert.deepEqual(exclude, [
    "@a/pkg",
    "@a/pkg/client",
    "@a/pkg/shared",
    "@z/pkg/client",
    "external-problem-dep"
  ]);
});

test("resolveClientOptimizeIncludeSpecifiers includes only non-local package clients", () => {
  const include = resolveClientOptimizeIncludeSpecifiers([
    {
      packageId: "@z/pkg",
      sourceType: "packages-directory",
      packageMetadataUiRoutes: []
    },
    {
      packageId: "@a/pkg",
      sourceType: "app-local-package",
      packageMetadataUiRoutes: []
    },
    {
      packageId: "@b/pkg",
      sourceType: "local-package",
      packageMetadataUiRoutes: []
    },
    {
      packageId: "@c/pkg",
      sourceType: "npm",
      packageMetadataUiRoutes: []
    }
  ]);

  assert.deepEqual(include, ["@c/pkg/client", "@z/pkg/client"]);
});

test("resolveClientOptimizeIncludeSpecifiers omits excluded package clients", () => {
  const include = resolveClientOptimizeIncludeSpecifiers(
    [
      {
        packageId: "@z/pkg",
        sourceType: "packages-directory",
        packageMetadataUiRoutes: []
      },
      {
        packageId: "@c/pkg",
        sourceType: "npm",
        packageMetadataUiRoutes: [],
        packageMetadataClientOptimizeIncludeSpecifiers: ["extra-dep"]
      }
    ],
    ["@z/pkg/client", "extra-dep"]
  );

  assert.deepEqual(include, ["@c/pkg/client"]);
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

  await declareInstalledPackages(appRoot, {
    "@example/has-client": {},
    "@example/no-client": {}
  });

  await mkdir(path.join(appRoot, "node_modules", "@example", "has-client"), { recursive: true });
  await writeJson(path.join(appRoot, "node_modules", "@example", "has-client", "package.json"), {
    name: "@example/has-client",
    version: "1.0.0",
    jskit: { kind: "runtime" },
    exports: {
      "./client": "./src/client/index.js"
    }
  });

  await mkdir(path.join(appRoot, "node_modules", "@example", "no-client"), { recursive: true });
  await writeJson(path.join(appRoot, "node_modules", "@example", "no-client", "package.json"), {
    name: "@example/no-client",
    version: "1.0.0",
    jskit: { kind: "runtime" },
    exports: {
      "./server": "./src/server/index.js"
    }
  });

  const packageIds = await resolveInstalledClientPackageIds({ appRoot });

  assert.deepEqual(packageIds, ["@example/has-client"]);
});

test("resolveInstalledClientModules returns installed modules with client exports", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-modules-"));

  await declareInstalledPackages(tempRoot, { "@example/has-client": {} });

  const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
  await mkdir(packageRoot, { recursive: true });
  await writeJson(path.join(packageRoot, "package.json"), {
    name: "@example/has-client",
    version: "1.0.0",
    exports: {
      "./client": "./src/client/index.js"
    }
  });
  await writePackageMetadata(packageRoot, {
    packageId: "@example/has-client",
    version: "1.0.0",
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
  const modules = await resolveInstalledClientModules({ appRoot: tempRoot });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].packageId, "@example/has-client");
  assert.equal(modules[0].sourceType, "npm-package");
  assert.equal(Array.isArray(modules[0].packageMetadataUiRoutes), true);
  assert.equal(modules[0].packageMetadataUiRoutes.length, 1);
  assert.equal(modules[0].packageMetadataUiRoutes[0].id, "auth.default-login-2");
  assert.equal(Array.isArray(modules[0].packageMetadataClientProviders), true);
  assert.equal(modules[0].packageMetadataClientProviders.length, 1);
  assert.equal(modules[0].packageMetadataClientProviders[0].export, "HasClientProvider");
  assert.equal(Array.isArray(modules[0].packageMetadataClientOptimizeIncludeSpecifiers), true);
  assert.deepEqual(modules[0].packageMetadataClientOptimizeIncludeSpecifiers, ["mime-match"]);
});

test("resolveInstalledClientModules resolves a packageMetadata from a file dependency", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-package-path-"));

  await declareInstalledPackages(tempRoot, {
    "@example/has-client": { packagePath: "packages/has-client" }
  });

  const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
  await mkdir(packageRoot, { recursive: true });
  await writeJson(path.join(packageRoot, "package.json"), {
    name: "@example/has-client",
    version: "1.0.0",
    exports: {
      "./client": "./src/client/index.js"
    }
  });
  await mkdir(path.join(tempRoot, "packages", "has-client"), { recursive: true });
  await writeJson(path.join(tempRoot, "packages", "has-client", "package.json"), {
    name: "@example/has-client",
    version: "1.0.0",
    exports: {
      "./client": "./src/client/index.js"
    }
  });
  await writePackageMetadata(path.join(tempRoot, "packages", "has-client"), {
    packageId: "@example/has-client",
    version: "1.0.0",
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

  const modules = await resolveInstalledClientModules({ appRoot: tempRoot });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].packageId, "@example/has-client");
  assert.equal(modules[0].sourceType, "local-package");
  assert.equal(modules[0].packageMetadataUiRoutes.length, 1);
  assert.equal(modules[0].packageMetadataUiRoutes[0].id, "local.route");
  assert.equal(modules[0].packageMetadataClientProviders.length, 1);
  assert.equal(modules[0].packageMetadataClientProviders[0].export, "LocalClientProvider");
});

test("resolveLocalScopePackageIds reads @local packages from package.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-local-scope-"));
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

  const packageIds = await resolveLocalScopePackageIds({ appRoot: tempRoot });

  assert.deepEqual(packageIds, ["@local/dev-only", "@local/feature"]);
});

test("createJskitClientBootstrapPlugin resolves and loads virtual module", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-plugin-"));
  const previousCwd = process.cwd();

  try {
    await declareInstalledPackages(tempRoot, { "@example/has-client": {} });

    const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
    await mkdir(packageRoot, { recursive: true });
    await writeJson(path.join(packageRoot, "package.json"), {
      name: "@example/has-client",
      version: "1.0.0",
      jskit: { kind: "runtime" },
      exports: {
        "./client": "./src/client/index.js"
      }
    });
    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();

    const resolvedId = await plugin.resolveId(CLIENT_BOOTSTRAP_VIRTUAL_ID);
    assert.equal(resolvedId, CLIENT_BOOTSTRAP_RESOLVED_ID);

    const source = await plugin.load(CLIENT_BOOTSTRAP_RESOLVED_ID);
    assert.match(String(source || ""), /@example\/has-client\/client/);
    assert.match(String(source || ""), /bootInstalledClientModules/);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin resolves multiple local packages before Vite dependency resolution", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-plugin-local-resolution-"));
  const previousCwd = process.cwd();

  try {
    await declareInstalledPackages(tempRoot, {
      "@local/main": { packagePath: "packages/main" },
      "@local/feature": { packagePath: "packages/feature" },
      "@example/local-utility": { packagePath: "packages/utility" },
      "@example/published": {}
    });

    const packageFixtures = [
      {
        packageId: "@local/main",
        packageDirectory: "main",
        exports: {
          "./client": "./custom/main-client.js",
          "./shared": "./custom/main-shared.js"
        }
      },
      {
        packageId: "@local/feature",
        packageDirectory: "feature",
        exports: {
          "./client": "./browser/feature-client.js",
          "./shared": "./browser/feature-shared.js"
        }
      },
      {
        packageId: "@example/local-utility",
        packageDirectory: "utility",
        exports: {
          ".": "./browser/utility.js",
          "./shared": "./browser/utility-shared.js"
        }
      }
    ];
    for (const fixture of packageFixtures) {
      const packageJson = {
        name: fixture.packageId,
        version: "1.0.0",
        exports: fixture.exports
      };
      const sourcePackageRoot = path.join(tempRoot, "packages", fixture.packageDirectory);
      const installedPackageRoot = path.join(tempRoot, "node_modules", ...fixture.packageId.split("/"));
      await mkdir(sourcePackageRoot, { recursive: true });
      await mkdir(installedPackageRoot, { recursive: true });
      await writeJson(path.join(sourcePackageRoot, "package.json"), packageJson);
      await writeJson(path.join(installedPackageRoot, "package.json"), packageJson);
      await writePackageMetadata(sourcePackageRoot, {
        packageId: fixture.packageId,
        version: "1.0.0"
      });
    }

    const publishedPackageRoot = path.join(tempRoot, "node_modules", "@example", "published");
    await mkdir(publishedPackageRoot, { recursive: true });
    await writeJson(path.join(publishedPackageRoot, "package.json"), {
      name: "@example/published",
      version: "1.0.0",
      exports: {
        "./client": "./src/client/index.js"
      }
    });

    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();
    await plugin.config({}, { command: "serve", mode: "development" });
    const viteResolvedIds = new Map([
      ["@local/main/client", path.join(tempRoot, "node_modules", "@local", "main", "custom", "main-client.js")],
      ["@local/main/shared", path.join(tempRoot, "node_modules", "@local", "main", "custom", "main-shared.js")],
      ["@local/feature/client", path.join(tempRoot, "node_modules", "@local", "feature", "browser", "feature-client.js")],
      ["@local/feature/shared", path.join(tempRoot, "node_modules", "@local", "feature", "browser", "feature-shared.js")],
      ["@example/local-utility", path.join(tempRoot, "node_modules", "@example", "local-utility", "browser", "utility.js")],
      ["@example/local-utility/shared", path.join(tempRoot, "node_modules", "@example", "local-utility", "browser", "utility-shared.js")]
    ]);
    plugin.configResolved({
      createResolver(options) {
        assert.equal(options.scan, true);
        return async (source, importer) => {
          assert.equal(importer, undefined);
          return viteResolvedIds.get(source);
        };
      }
    });
    const resolveId = async (source) => plugin.resolveId(source);

    assert.equal(plugin.enforce, "pre");
    assert.equal(
      await resolveId("@local/main/client"),
      path.join(tempRoot, "packages", "main", "custom", "main-client.js")
    );
    assert.equal(
      await resolveId("@local/main/shared"),
      path.join(tempRoot, "packages", "main", "custom", "main-shared.js")
    );
    assert.equal(
      await resolveId("@local/feature/client"),
      path.join(tempRoot, "packages", "feature", "browser", "feature-client.js")
    );
    assert.equal(
      await resolveId("@local/feature/shared"),
      path.join(tempRoot, "packages", "feature", "browser", "feature-shared.js")
    );
    assert.equal(
      await resolveId("@example/local-utility"),
      path.join(tempRoot, "packages", "utility", "browser", "utility.js")
    );
    assert.equal(
      await resolveId("@example/local-utility/shared"),
      path.join(tempRoot, "packages", "utility", "browser", "utility-shared.js")
    );
    assert.equal(await resolveId("@example/published/client"), null);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes installed client package specifiers from optimizeDeps", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-"));
  const previousCwd = process.cwd();

  try {
    await declareInstalledPackages(tempRoot, { "@example/has-client": {} });

    const packageRoot = path.join(tempRoot, "node_modules", "@example", "has-client");
    await mkdir(packageRoot, { recursive: true });
    await writeJson(path.join(packageRoot, "package.json"), {
      name: "@example/has-client",
      version: "1.0.0",
      jskit: { kind: "runtime" },
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
    assert.deepEqual(result.resolve.dedupe, ["@tanstack/vue-query", "pinia", "vue", "vue-router", "vuetify"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config lets packageMetadata excludes override automatic client includes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-packageMetadata-exclude-"));
  const previousCwd = process.cwd();

  try {
    await declareInstalledPackages(tempRoot, { "@example/app-bound-client": {} });

    const packageRoot = path.join(tempRoot, "node_modules", "@example", "app-bound-client");
    await mkdir(packageRoot, { recursive: true });
    await writeJson(path.join(packageRoot, "package.json"), {
      name: "@example/app-bound-client",
      version: "1.0.0",
      exports: {
        "./client": "./src/client/index.js"
      }
    });
    await writePackageMetadata(packageRoot, {
      packageId: "@example/app-bound-client",
      version: "1.0.0",
      metadata: {
        client: {
          optimizeDeps: {
            include: ["safe-helper"],
            exclude: ["@example/app-bound-client/client"]
          }
        }
      }
    });

    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();
    const result = await plugin.config({
      optimizeDeps: {
        include: ["@example/app-bound-client/client", "user-helper"],
        exclude: ["user-excluded"]
      }
    });

    assert.deepEqual(result.optimizeDeps.exclude, ["@example/app-bound-client/client", "user-excluded"]);
    assert.deepEqual(result.optimizeDeps.include, ["safe-helper", "user-helper"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes local package roots and client/shared subpaths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-local-"));
  const previousCwd = process.cwd();

  try {
    await declareInstalledPackages(tempRoot, {
      "@example/local-client": { packagePath: "packages/local-client" },
      "@example/remote-client": {}
    });

    const localPackageRoot = path.join(tempRoot, "packages", "local-client");
    await mkdir(localPackageRoot, { recursive: true });
    await writeJson(path.join(localPackageRoot, "package.json"), {
      name: "@example/local-client",
      version: "1.0.0",
      exports: {
        "./client": "./src/client/index.js"
      }
    });
    await writePackageMetadata(localPackageRoot, {
      packageId: "@example/local-client",
      version: "1.0.0",
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
      version: "1.0.0",
      jskit: { kind: "runtime" },
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
    assert.deepEqual(result.resolve.dedupe, ["@tanstack/vue-query", "pinia", "vue", "vue-router", "vuetify"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config preserves user resolve fields and merges dedupe", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-config-resolve-"));
  const previousCwd = process.cwd();

  try {
    await writeJson(path.join(tempRoot, "package.json"), {
      name: "fixture-app",
      private: true,
      type: "module"
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
    assert.deepEqual(result.resolve.dedupe, ["@tanstack/vue-query", "custom-lib", "pinia", "vue", "vue-router", "vuetify"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("createJskitClientBootstrapPlugin config excludes all @local scoped packages from package.json", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-local-scope-config-"));
  const previousCwd = process.cwd();

  try {
    await writeJson(path.join(tempRoot, "package.json"), {
      name: "fixture-app",
      dependencies: {
        "@local/main": "file:packages/main",
        "@local/feature": "file:packages/feature",
        "@example/remote-client": "^1.0.0"
      }
    });
    await declareInstalledPackages(tempRoot, {
      "@local/main": { packagePath: "packages/main" },
      "@local/feature": { packagePath: "packages/feature" },
      "@example/remote-client": {}
    });

    const remotePackageRoot = path.join(tempRoot, "node_modules", "@example", "remote-client");
    await mkdir(remotePackageRoot, { recursive: true });
    await writeJson(path.join(remotePackageRoot, "package.json"), {
      name: "@example/remote-client",
      version: "1.0.0",
      jskit: { kind: "runtime" },
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
