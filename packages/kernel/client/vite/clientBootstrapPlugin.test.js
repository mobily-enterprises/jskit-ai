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
  normalizeDescriptorUiRoutes,
  resolveInstalledClientPackageIds,
  resolveInstalledClientModules
} from "./clientBootstrapPlugin.js";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeDescriptor(filePath, descriptor) {
  await writeFile(filePath, `export default ${JSON.stringify(descriptor, null, 2)};\n`, "utf8");
}

test("normalizeDescriptorUiRoutes normalizes scope and auto register flags", () => {
  const routes = normalizeDescriptorUiRoutes([
    {
      id: "auth.login",
      name: "auth-login",
      path: "/auth/login",
      scope: "global",
      componentKey: "auth-login",
      autoRegister: true,
      guard: { policy: "public" }
    },
    {
      path: "/auth/callback/:provider",
      scope: "global",
      autoRegister: false,
      purpose: "Manual callback route"
    }
  ]);

  assert.equal(routes.length, 2);
  assert.equal(routes[0].autoRegister, true);
  assert.equal(routes[1].autoRegister, false);
  assert.equal(routes[0].componentKey, "auth-login");
});

test("createVirtualModuleSource renders deterministic client module imports and descriptor routes", () => {
  const source = createVirtualModuleSource([
    {
      packageId: "@z/pkg",
      descriptorRoutes: [{ id: "z.login", path: "/z/login", scope: "global", autoRegister: true }]
    },
    {
      packageId: "@a/pkg",
      descriptorRoutes: [{ id: "a.login", path: "/a/login", scope: "global", autoRegister: true }]
    }
  ]);

  assert.match(source, /import \* as clientModule0 from "@a\/pkg\/client";/);
  assert.match(source, /import \* as clientModule1 from "@z\/pkg\/client";/);
  assert.match(source, /descriptorRoutes:/);
  assert.match(source, /bootClientModules/);
  assert.match(source, /installedClientModules/);
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

test("resolveInstalledClientModules loads descriptor ui routes", async () => {
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
    metadata: {
      ui: {
        routes: [
          {
            id: "auth.login",
            name: "auth-login",
            path: "/auth/login",
            scope: "global",
            componentKey: "auth-login",
            autoRegister: true
          },
          {
            id: "auth.callback",
            path: "/auth/callback/:provider",
            scope: "global",
            autoRegister: false
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
  assert.equal(modules[0].descriptorRoutes.length, 2);
  assert.equal(modules[0].descriptorRoutes[0].componentKey, "auth-login");
  assert.equal(modules[0].descriptorRoutes[1].autoRegister, false);
});

test("createJskitClientBootstrapPlugin resolves and loads virtual module", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-client-bootstrap-plugin-"));
  const previousCwd = process.cwd();

  try {
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
      metadata: {
        ui: {
          routes: [
            {
              id: "auth.login",
              name: "auth-login",
              path: "/auth/login",
              scope: "global",
              componentKey: "auth-login",
              autoRegister: true
            }
          ]
        }
      }
    });

    process.chdir(tempRoot);
    const plugin = createJskitClientBootstrapPlugin();

    const resolvedId = plugin.resolveId(CLIENT_BOOTSTRAP_VIRTUAL_ID);
    assert.equal(resolvedId, CLIENT_BOOTSTRAP_RESOLVED_ID);

    const source = await plugin.load(CLIENT_BOOTSTRAP_RESOLVED_ID);
    assert.match(String(source || ""), /@example\/has-client\/client/);
    assert.match(String(source || ""), /descriptorRoutes/);
    assert.match(String(source || ""), /bootInstalledClientModules/);
  } finally {
    process.chdir(previousCwd);
  }
});
