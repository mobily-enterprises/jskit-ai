import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeServerContributions,
  mergeServerContributions,
  createServerRuntimeFromContributions,
  loadServerContributionsFromLock,
  createServerRuntimeFromLock,
  createServerRuntimeFromApp,
  applyContributedRuntimeLifecycle
} from "../src/shared/serverContributions.js";

function descriptorSource({
  packageId,
  dependsOn = [],
  provides = [],
  requires = [],
  entrypoint = "",
  exportName = "createServerContributions"
}) {
  const runtimeBlock = entrypoint
    ? `runtime: { server: { entrypoint: ${JSON.stringify(entrypoint)}, export: ${JSON.stringify(exportName)} } },`
    : "";
  return `export default Object.freeze({
  packageVersion: 1,
  packageId: ${JSON.stringify(packageId)},
  version: "0.1.0",
  dependsOn: ${JSON.stringify(dependsOn)},
  capabilities: {
    provides: ${JSON.stringify(provides)},
    requires: ${JSON.stringify(requires)}
  },
  ${runtimeBlock}
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: []
  }
});\n`;
}

function contributionSource({ repositoryId = "", serviceId = "", controllerId = "", routeId = "", routePath = "" }) {
  const repositoriesBlock = repositoryId
    ? `repositories: [{ id: ${JSON.stringify(repositoryId)}, create: () => ({ ping: () => "pong" }) }],`
    : "";
  const servicesBlock = serviceId
    ? `services: [{ id: ${JSON.stringify(serviceId)}, create: ({ repositories }) => ({ list: () => repositories.${repositoryId}.ping() }) }],`
    : "";
  const controllersBlock = controllerId
    ? `controllers: [{ id: ${JSON.stringify(controllerId)}, create: ({ services }) => ({ get: () => services.${serviceId}.list() }) }],`
    : "";
  const routesBlock = routeId
    ? `routes: [{ id: ${JSON.stringify(routeId)}, buildRoutes: (controllers) => [{ method: "GET", path: ${JSON.stringify(routePath)}, handler: controllers.${controllerId}.get }] }],`
    : "";

  return `export function createServerContributions() {
  return {
    ${repositoriesBlock}
    ${servicesBlock}
    ${controllersBlock}
    ${routesBlock}
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: []
  };
}\n`;
}

async function withTempAppFixture(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-server-contrib-"));
  try {
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

async function writePackageFixture({
  appRoot,
  packageId,
  descriptorRelativePath,
  descriptor,
  contributionEntrypointRelativePath = "",
  contributionSourceCode = ""
}) {
  const packageRoot = path.join(appRoot, "node_modules", "@jskit-ai", "jskit", path.dirname(descriptorRelativePath));
  await mkdir(packageRoot, { recursive: true });

  const descriptorPath = path.join(appRoot, "node_modules", "@jskit-ai", "jskit", descriptorRelativePath);
  await mkdir(path.dirname(descriptorPath), { recursive: true });
  await writeFile(descriptorPath, descriptor, "utf8");

  if (contributionEntrypointRelativePath) {
    const contributionPath = path.join(packageRoot, contributionEntrypointRelativePath);
    await mkdir(path.dirname(contributionPath), { recursive: true });
    await writeFile(contributionPath, contributionSourceCode, "utf8");
  }

  return {
    packageId,
    descriptorPath
  };
}

test("normalizeServerContributions validates contract shape", () => {
  const normalized = normalizeServerContributions({
    repositories: [{ id: "repo", create: () => ({}) }],
    services: [{ id: "service", create: () => ({}) }],
    controllers: [{ id: "controller", create: () => ({}) }],
    routes: [{ id: "route", buildRoutes: () => [] }],
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: []
  });

  assert.equal(normalized.repositories.length, 1);
  assert.equal(normalized.routes.length, 1);
  assert.throws(
    () =>
      normalizeServerContributions({
        routes: [{ id: "bad-route", buildRoutes: "nope" }]
      }),
    /buildRoutes must be a function/
  );
  assert.throws(
    () =>
      normalizeServerContributions({
        repositories: [],
        unknown: []
      }),
    /unknown keys/
  );
});

test("mergeServerContributions rejects duplicate IDs across packages", () => {
  assert.throws(
    () =>
      mergeServerContributions([
        {
          packageId: "@test/a",
          contributions: {
            repositories: [{ id: "sharedRepo", create: () => ({}) }]
          }
        },
        {
          packageId: "@test/b",
          contributions: {
            repositories: [{ id: "sharedRepo", create: () => ({}) }]
          }
        }
      ]),
    /duplicated/
  );
});

test("createServerRuntimeFromContributions assembles runtime and route list", () => {
  const runtimeResult = createServerRuntimeFromContributions({
    mergedContributions: {
      repositories: [{ id: "repo", create: () => ({ ping: () => "pong" }) }],
      services: [{ id: "service", create: ({ repositories }) => ({ list: () => repositories.repo.ping() }) }],
      controllers: [{ id: "health", create: ({ services }) => ({ get: () => services.service.list() }) }],
      routes: [{ id: "health-route", buildRoutes: (controllers) => [{ method: "GET", path: "/health", handler: controllers.health.get }] }],
      actions: [],
      plugins: [],
      workers: [],
      lifecycle: []
    }
  });

  assert.equal(runtimeResult.runtime.controllers.health.get(), "pong");
  assert.equal(runtimeResult.routes.length, 1);
  assert.equal(runtimeResult.routes[0].path, "/health");
});

test("createServerRuntimeFromContributions injects shared dependency bag under dependencies key", () => {
  const runtimeResult = createServerRuntimeFromContributions({
    mergedContributions: {
      repositories: [],
      services: [
        {
          id: "probeService",
          create({ dependencies = {} } = {}) {
            return {
              marker: String(dependencies.marker || "")
            };
          }
        }
      ],
      controllers: [],
      routes: [],
      actions: [],
      plugins: [],
      workers: [],
      lifecycle: []
    },
    dependencies: {
      marker: "injected"
    }
  });

  assert.equal(runtimeResult.runtime.services.probeService.marker, "injected");
});

test("loadServerContributionsFromLock resolves descriptors and composes by dependency order", async () => {
  await withTempAppFixture(async (appRoot) => {
    await writePackageFixture({
      appRoot,
      packageId: "@test/foundation",
      descriptorRelativePath: "packages/test/foundation/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/foundation",
        provides: ["runtime.server"],
        entrypoint: "src/server/contributions.js"
      }),
      contributionEntrypointRelativePath: "src/server/contributions.js",
      contributionSourceCode: contributionSource({
        repositoryId: "foundationRepo",
        serviceId: "foundationService",
        controllerId: "foundationController",
        routeId: "foundationRoute",
        routePath: "/foundation"
      })
    });

    await writePackageFixture({
      appRoot,
      packageId: "@test/feature",
      descriptorRelativePath: "packages/test/feature/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/feature",
        dependsOn: ["@test/foundation"],
        provides: ["feature.server-routes"],
        requires: ["runtime.server"],
        entrypoint: "src/server/contributions.js"
      }),
      contributionEntrypointRelativePath: "src/server/contributions.js",
      contributionSourceCode: contributionSource({
        repositoryId: "featureRepo",
        serviceId: "featureService",
        controllerId: "featureController",
        routeId: "featureRoute",
        routePath: "/feature"
      })
    });

    const lock = {
      lockVersion: 3,
      installedPackages: {
        "@test/feature": {
          source: {
            descriptorPath: "packages/test/feature/package.descriptor.mjs"
          }
        },
        "@test/foundation": {
          source: {
            descriptorPath: "packages/test/foundation/package.descriptor.mjs"
          }
        }
      }
    };

    const catalog = await loadServerContributionsFromLock({
      appRoot,
      lock,
      strict: true
    });

    assert.deepEqual(catalog.packageOrder, ["@test/foundation", "@test/feature"]);
    assert.equal(catalog.mergedContributions.routes.length, 2);

    const runtimeResult = await createServerRuntimeFromLock({
      appRoot,
      lock,
      strict: true
    });
    assert.equal(runtimeResult.routes.length, 2);
  });
});

test("loadServerContributionsFromLock resolves descriptor paths relative to tooling/jskit package root", async () => {
  await withTempAppFixture(async (appRoot) => {
    await writePackageFixture({
      appRoot,
      packageId: "@test/tooling-relative",
      descriptorRelativePath: "packages/test/tooling-relative/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/tooling-relative",
        provides: ["feature.server-routes"],
        entrypoint: "src/server/contributions.js"
      }),
      contributionEntrypointRelativePath: "src/server/contributions.js",
      contributionSourceCode: contributionSource({
        repositoryId: "toolingRepo",
        serviceId: "toolingService",
        controllerId: "toolingController",
        routeId: "toolingRoute",
        routePath: "/tooling-relative"
      })
    });

    const lock = {
      lockVersion: 3,
      installedPackages: {
        "@test/tooling-relative": {
          source: {
            descriptorPath: "../../test/tooling-relative/package.descriptor.mjs"
          }
        }
      }
    };

    const runtimeResult = await createServerRuntimeFromLock({
      appRoot,
      lock,
      strict: true
    });
    assert.equal(runtimeResult.routes.length, 1);
    assert.equal(runtimeResult.routes[0].path, "/tooling-relative");
  });
});

test("strict mode fails when server capability package lacks runtime.server contribution entrypoint", async () => {
  await withTempAppFixture(async (appRoot) => {
    await writePackageFixture({
      appRoot,
      packageId: "@test/missing-server-runtime",
      descriptorRelativePath: "packages/test/missing-runtime/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/missing-server-runtime",
        provides: ["auth.server-routes"]
      })
    });

    const lock = {
      lockVersion: 3,
      installedPackages: {
        "@test/missing-server-runtime": {
          source: {
            descriptorPath: "packages/test/missing-runtime/package.descriptor.mjs"
          }
        }
      }
    };

    await assert.rejects(
      () =>
        loadServerContributionsFromLock({
          appRoot,
          lock,
          strict: true
        }),
      /provides server route capabilities but does not declare runtime\.server/
    );
  });
});

test("createServerRuntimeFromApp reads .jskit/lock.json and composes runtime", async () => {
  await withTempAppFixture(async (appRoot) => {
    await writePackageFixture({
      appRoot,
      packageId: "@test/app-lock-package",
      descriptorRelativePath: "packages/test/app-lock-package/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/app-lock-package",
        entrypoint: "src/server/contributions.js"
      }),
      contributionEntrypointRelativePath: "src/server/contributions.js",
      contributionSourceCode: contributionSource({
        repositoryId: "lockRepo",
        serviceId: "lockService",
        controllerId: "lockController",
        routeId: "lockRoute",
        routePath: "/lock"
      })
    });

    const lock = {
      lockVersion: 3,
      installedPackages: {
        "@test/app-lock-package": {
          source: {
            descriptorPath: "packages/test/app-lock-package/package.descriptor.mjs"
          }
        }
      }
    };

    const lockPath = path.join(appRoot, ".jskit", "lock.json");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const runtimeResult = await createServerRuntimeFromApp({
      appRoot
    });
    assert.equal(runtimeResult.routes.length, 1);
    assert.equal(runtimeResult.routes[0].path, "/lock");
  });
});

test("applyContributedRuntimeLifecycle initializes plugins/workers and runs lifecycle hooks", async () => {
  const calls = [];
  const closeHooks = [];
  const app = {
    registeredPlugins: [],
    async register(pluginFn) {
      this.registeredPlugins.push(pluginFn);
      await pluginFn(this);
    },
    addHook(name, hookFn) {
      if (name === "onClose") {
        closeHooks.push(hookFn);
      }
    }
  };

  const runtimeResult = createServerRuntimeFromContributions({
    mergedContributions: {
      repositories: [],
      services: [],
      controllers: [],
      routes: [],
      actions: [],
      plugins: [
        {
          id: "plugin-a",
          create({ dependencies = {} } = {}) {
            return async function pluginA() {
              calls.push(`plugin:${String(dependencies.marker || "")}`);
            };
          }
        }
      ],
      workers: [
        {
          id: "worker-a",
          create() {
            return {
              async start() {
                calls.push("worker:start");
              },
              async stop() {
                calls.push("worker:stop");
              }
            };
          }
        }
      ],
      lifecycle: [
        {
          id: "lifecycle-a",
          async onBoot() {
            calls.push("lifecycle:onBoot");
          },
          async onShutdown() {
            calls.push("lifecycle:onShutdown");
          }
        }
      ]
    }
  });

  const applied = await applyContributedRuntimeLifecycle({
    app,
    runtimeResult,
    dependencies: {
      marker: "ok"
    }
  });

  assert.equal(applied.pluginCount, 1);
  assert.equal(applied.workerCount, 1);
  assert.equal(applied.onBootCount, 1);
  assert.equal(closeHooks.length, 1);
  assert.deepEqual(calls, ["plugin:ok", "worker:start", "lifecycle:onBoot"]);

  await closeHooks[0]();
  assert.deepEqual(calls, ["plugin:ok", "worker:start", "lifecycle:onBoot", "lifecycle:onShutdown", "worker:stop"]);
});
