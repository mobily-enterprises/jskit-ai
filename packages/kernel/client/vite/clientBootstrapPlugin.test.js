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
    },
    {
      packageId: "@a/pkg",
    }
  ]);

  assert.match(source, /import \* as clientModule0 from "@a\/pkg\/client";/);
  assert.match(source, /import \* as clientModule1 from "@z\/pkg\/client";/);
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
  const modules = await resolveInstalledClientModules({
    appRoot: tempRoot,
    lockPath: ".jskit/lock.json"
  });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].packageId, "@example/has-client");
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
