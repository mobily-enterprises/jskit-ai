import assert from "node:assert/strict";
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPackageMetadata,
  discoverInstalledPackages,
  JSKIT_PACKAGE_CONFIG_KEYS
} from "./installedPackages.js";

test("createPackageMetadata derives package identity from package.json", () => {
  const metadata = createPackageMetadata({
    name: "@example/runtime",
    version: "0.1.0",
    description: "Example runtime.",
    jskit: {
      kind: "runtime",
      runtime: {
        server: {
          providers: []
        }
      }
    }
  });

  assert.equal(metadata.packageId, "@example/runtime");
  assert.equal(metadata.version, "0.1.0");
  assert.equal(metadata.description, "Example runtime.");
});

test("createPackageMetadata accepts only the canonical package.json.jskit fields", () => {
  assert.deepEqual(JSKIT_PACKAGE_CONFIG_KEYS, [
    "capabilities",
    "kind",
    "metadata",
    "migrations",
    "runtime",
    "vite"
  ]);
  assert.throws(
    () => createPackageMetadata({
      name: "@example/runtime",
      version: "0.1.0",
      jskit: {
        kind: "runtime",
        packageId: "@example/other-runtime"
      }
    }),
    /unknown field: packageId/
  );
});

test("discoverInstalledPackages resolves file tarballs from node_modules", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-package-tarball-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  const installedPackageRoot = path.join(
    appRoot,
    "node_modules",
    "@jskit-ai",
    "shell-web"
  );

  await mkdir(path.join(appRoot, "archives"), { recursive: true });
  await mkdir(installedPackageRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({
      dependencies: {
        "@jskit-ai/shell-web": "file:archives/shell-web.tgz"
      }
    })
  );
  await writeFile(path.join(appRoot, "archives", "shell-web.tgz"), "fixture");
  await writeFile(
    path.join(installedPackageRoot, "package.json"),
    JSON.stringify({
      name: "@jskit-ai/shell-web",
      version: "0.1.0",
      jskit: {
        kind: "runtime"
      }
    })
  );

  const packages = await discoverInstalledPackages({ appRoot });

  assert.equal(packages.length, 1);
  assert.equal(packages[0].packageId, "@jskit-ai/shell-web");
  assert.equal(packages[0].packageRoot, installedPackageRoot);
  assert.equal(packages[0].sourceType, "npm-package");
});

test("discoverInstalledPackages excludes development-only packages from runtime composition", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-package-dev-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  const runtimeRoot = path.join(appRoot, "node_modules", "@example", "runtime");
  const docsRoot = path.join(appRoot, "node_modules", "@example", "docs");
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(docsRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({
      dependencies: { "@example/runtime": "1.0.0" },
      devDependencies: { "@example/docs": "1.0.0" }
    })
  );
  for (const [packageRoot, name] of [[runtimeRoot, "@example/runtime"], [docsRoot, "@example/docs"]]) {
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name, version: "1.0.0", jskit: { kind: "runtime" } })
    );
  }

  const packages = await discoverInstalledPackages({ appRoot });
  assert.deepEqual(packages.map((entry) => entry.packageId), ["@example/runtime"]);
});

test("discoverInstalledPackages walks npm alias dependencies but rejects aliased JSKIT packages", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-package-alias-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  const aliasRoot = path.join(appRoot, "node_modules", "@example", "sdk-v0_3");
  const runtimeRoot = path.join(appRoot, "node_modules", "@example", "runtime");
  await mkdir(aliasRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(appRoot, "package.json"),
    JSON.stringify({ dependencies: { "@example/sdk-v0_3": "npm:@example/sdk@0.3.0" } })
  );
  await writeFile(
    path.join(aliasRoot, "package.json"),
    JSON.stringify({ name: "@example/sdk", version: "0.3.0", dependencies: { "@example/runtime": "1.0.0" } })
  );
  await writeFile(
    path.join(runtimeRoot, "package.json"),
    JSON.stringify({ name: "@example/runtime", version: "1.0.0", jskit: { kind: "runtime" } })
  );

  const packages = await discoverInstalledPackages({ appRoot });
  assert.deepEqual(packages.map((entry) => entry.packageId), ["@example/runtime"]);

  await writeFile(
    path.join(aliasRoot, "package.json"),
    JSON.stringify({ name: "@example/sdk", version: "0.3.0", jskit: { kind: "runtime" } })
  );
  await assert.rejects(
    () => discoverInstalledPackages({ appRoot }),
    /Installed package manifest mismatch: expected @example\/sdk-v0_3, received @example\/sdk\./
  );
});

test("discoverInstalledPackages keeps an installed app's discovery until a manifest or the install changes", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-package-kept-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  const runtimeRoot = path.join(appRoot, "node_modules", "@example", "runtime");
  const localRoot = path.join(appRoot, "packages", "main");
  const lockfilePath = path.join(appRoot, "node_modules", ".package-lock.json");
  const writeJson = (filePath, value) => writeFile(filePath, JSON.stringify(value));
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(localRoot, { recursive: true });
  const appDependencies = { "@example/runtime": "1.0.0", "@local/main": "file:packages/main" };
  await writeJson(path.join(appRoot, "package.json"), { dependencies: appDependencies });
  await writeJson(path.join(runtimeRoot, "package.json"), {
    name: "@example/runtime",
    version: "1.0.0",
    jskit: { kind: "runtime", capabilities: { provides: ["feature.example"] } }
  });
  await writeJson(path.join(localRoot, "package.json"), { name: "@local/main", version: "0.1.0", jskit: { kind: "runtime" } });
  await writeJson(lockfilePath, { lockfileVersion: 3, packages: {} });

  const first = await discoverInstalledPackages({ appRoot });
  assert.deepEqual(first.map((entry) => entry.packageId), ["@example/runtime", "@local/main"]);
  assert.equal(await discoverInstalledPackages({ appRoot }), first);
  assert.ok(Object.isFrozen(first[0].packageMetadata.capabilities.provides));

  await writeJson(path.join(localRoot, "package.json"), {
    name: "@local/main",
    version: "0.1.0",
    description: "Main package.",
    jskit: { kind: "runtime" }
  });
  const afterLocalEdit = await discoverInstalledPackages({ appRoot });
  assert.equal(afterLocalEdit[1].packageMetadata.description, "Main package.");

  await writeJson(path.join(runtimeRoot, "package.json"), { name: "@example/runtime", version: "1.1.0", jskit: { kind: "runtime" } });
  await writeJson(lockfilePath, { lockfileVersion: 3, packages: { "node_modules/@example/runtime": { version: "1.1.0" } } });
  const afterInstall = await discoverInstalledPackages({ appRoot });
  assert.equal(afterInstall[0].version, "1.1.0");

  await writeJson(path.join(appRoot, "package.json"), { dependencies: { "@local/main": appDependencies["@local/main"] } });
  const afterAppEdit = await discoverInstalledPackages({ appRoot });
  assert.deepEqual(afterAppEdit.map((entry) => entry.packageId), ["@local/main"]);

  await rm(lockfilePath);
  const withoutLockfile = await discoverInstalledPackages({ appRoot });
  assert.notEqual(await discoverInstalledPackages({ appRoot }), withoutLockfile);
});

/**
 * Runs `work` and counts its calls to the node:fs/promises functions discovery uses.
 * @param {() => Promise<unknown>} work
 */
async function fileSystemCallsDuring(work) {
  const names = ["access", "readFile", "realpath", "stat"];
  const originals = Object.fromEntries(names.map((name) => [name, fsPromises[name]]));
  let calls = 0;
  for (const name of names) {
    fsPromises[name] = function countedCall(...args) {
      calls += 1;
      return originals[name].apply(this, args);
    };
  }
  syncBuiltinESMExports();
  try {
    await work();
  } finally {
    Object.assign(fsPromises, originals);
    syncBuiltinESMExports();
  }
  return calls;
}

test("discovery costs a few file system calls per installed package, however many there are", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-installed-package-calls-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  // Each direct dependency depends on a package npm hoisted beside it.
  async function writeApp(count) {
    const root = path.join(appRoot, String(count));
    const writePackage = async (name, dependencies = {}) => {
      await mkdir(path.join(root, "node_modules", name), { recursive: true });
      await writeFile(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies }));
    };
    const dependencies = {};
    for (let index = 0; index < count; index += 1) {
      dependencies[`direct-${index}`] = "1.0.0";
      await writePackage(`direct-${index}`, { [`hoisted-${index}`]: "1.0.0" });
      await writePackage(`hoisted-${index}`);
    }
    await writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies }));
    return root;
  }
  const [small, large] = [await writeApp(10), await writeApp(200)];

  const smallCalls = await fileSystemCallsDuring(() => discoverInstalledPackages({ appRoot: small }));
  const largeCalls = await fileSystemCallsDuring(() => discoverInstalledPackages({ appRoot: large }));

  // Reading a manifest, resolving its real path and finding it, with one miss for a hoisted package.
  assert.ok((largeCalls - smallCalls) / (2 * 190) <= 4, `${smallCalls} calls for 20 packages, ${largeCalls} for 400`);
});
