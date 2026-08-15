import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
