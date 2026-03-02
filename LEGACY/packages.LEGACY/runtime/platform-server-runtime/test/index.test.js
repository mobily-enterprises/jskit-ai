import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPlatformRuntimeBundle,
  createProviderRuntimeApp,
  createProviderRuntimeFromApp,
  createServerRuntime,
  createServerRuntimeWithPlatformBundle
} from "../src/server/index.js";
import { TOKENS } from "@jskit-ai/support-core/tokens";

test("platform server runtime creates bundle and assembly", () => {
  const platformBundle = createPlatformRuntimeBundle({
    repositoryDefinitions: [],
    serviceDefinitions: [],
    controllerDefinitions: [],
    runtimeServiceIds: []
  });

  const runtimeA = createServerRuntime({ bundles: [platformBundle], dependencies: {} });
  const runtimeB = createServerRuntimeWithPlatformBundle({
    platformBundle,
    appFeatureBundle: createPlatformRuntimeBundle({}),
    dependencies: {}
  });

  assert.ok(runtimeA);
  assert.ok(runtimeB);
  assert.equal(typeof runtimeA.controllers, "object");
});

test("platform provider runtime boots providers and registers routes", async () => {
  const fastify = {
    routes: [],
    route(definition) {
      this.routes.push(definition);
    }
  };

  class StatusProvider {
    static id = "test.status-provider";

    boot(app) {
      const router = app.make(TOKENS.HttpRouter);
      router.get("/status", async (_request, reply) => {
        reply.code(200).send({ ok: true });
      });
    }
  }

  const runtime = await createProviderRuntimeApp({
    profile: "app",
    providers: [StatusProvider],
    fastify
  });

  assert.equal(runtime.routeCount, 1);
  assert.equal(fastify.routes.length, 1);
  assert.equal(fastify.routes[0].url, "/status");
});

async function withTempAppFixture(run) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-platform-provider-runtime-"));
  try {
    await run(appRoot);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
}

function descriptorSource({
  packageId,
  providerEntrypoint = "",
  providerExport = ""
}) {
  const providerFields = [];
  if (providerEntrypoint) {
    providerFields.push(`providerEntrypoint: ${JSON.stringify(providerEntrypoint)}`);
  }
  if (providerExport) {
    providerFields.push(`providerExport: ${JSON.stringify(providerExport)}`);
  }
  const providerRuntimeFragment = providerFields.length > 0 ? `, ${providerFields.join(", ")}` : "";

  const runtimeBlock =
    providerFields.length > 0
      ? `,\n  runtime: {\n    server: {\n      ${providerFields.join(", ")}\n    }\n  }`
      : "";

  return `export default Object.freeze({
  packageVersion: 1,
  packageId: ${JSON.stringify(packageId)},
  version: "0.1.0",
  dependsOn: [],
  capabilities: {
    provides: ["runtime.server"],
    requires: []
  }${runtimeBlock},
  mutations: {
    dependencies: { runtime: {}, dev: {} },
    packageJson: { scripts: {} },
    procfile: {},
    files: []
  }
});\n`;
}

function providerSource({ providerClassName, providerId }) {
  return `class ${providerClassName} {
  static id = ${JSON.stringify(providerId)};
  register(app) {
    app.instance("provider.loaded", true);
  }
}

export { ${providerClassName} };\n`;
}

async function writePackageFixture({
  appRoot,
  packageId,
  descriptorRelativePath,
  descriptor,
  providerEntrypointRelativePath = "",
  providerSourceCode = ""
}) {
  const packageRoot = path.join(appRoot, "node_modules", "@jskit-ai", "jskit", path.dirname(descriptorRelativePath));
  await mkdir(packageRoot, { recursive: true });

  const descriptorPath = path.join(appRoot, "node_modules", "@jskit-ai", "jskit", descriptorRelativePath);
  await mkdir(path.dirname(descriptorPath), { recursive: true });
  await writeFile(descriptorPath, descriptor, "utf8");

  if (providerEntrypointRelativePath) {
    const providerPath = path.join(packageRoot, providerEntrypointRelativePath);
    await mkdir(path.dirname(providerPath), { recursive: true });
    await writeFile(providerPath, providerSourceCode, "utf8");
  }
}

test("createProviderRuntimeFromApp loads provider packages only", async () => {
  await withTempAppFixture(async (appRoot) => {
    await writePackageFixture({
      appRoot,
      packageId: "@test/provider-package",
      descriptorRelativePath: "packages/test/provider-package/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/provider-package",
        providerEntrypoint: "src/server/index.js",
        providerExport: "ProviderPackageServiceProvider"
      }),
      providerEntrypointRelativePath: "src/server/index.js",
      providerSourceCode: providerSource({
        providerClassName: "ProviderPackageServiceProvider",
        providerId: "test.provider-package"
      })
    });

    await writePackageFixture({
      appRoot,
      packageId: "@test/legacy-package",
      descriptorRelativePath: "packages/test/legacy-package/package.descriptor.mjs",
      descriptor: descriptorSource({
        packageId: "@test/legacy-package"
      })
    });

    await mkdir(path.join(appRoot, ".jskit"), { recursive: true });
    await writeFile(
      path.join(appRoot, ".jskit/lock.json"),
      JSON.stringify(
        {
          lockVersion: 3,
          installedPackages: {
            "@test/provider-package": {
              source: {
                descriptorPath: "packages/test/provider-package/package.descriptor.mjs"
              }
            },
            "@test/legacy-package": {
              source: {
                descriptorPath: "packages/test/legacy-package/package.descriptor.mjs"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const fastify = {
      routes: [],
      closeHooks: [],
      route(definition) {
        this.routes.push(definition);
      },
      register() {},
      addHook(name, hook) {
        this.closeHooks.push({ name, hook });
      }
    };

    const runtime = await createProviderRuntimeFromApp({
      appRoot,
      fastify,
      env: {
        NODE_ENV: "test"
      }
    });

    assert.equal(runtime.app.make("provider.loaded"), true);
    assert.equal(runtime.providerPackageOrder.length, 1);
    assert.deepEqual(runtime.providerPackageOrder, ["@test/provider-package"]);
    assert.equal(runtime.routeCount, 0);
    assert.equal(fastify.routes.length, 0);
  });
});
