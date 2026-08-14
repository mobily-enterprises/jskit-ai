import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  cleanupPackageRootCaches,
  resolvePackageTemplateRoot
} from "../src/server/cliRuntime/packageTemplateResolution.js";

test.afterEach(async () => {
  await cleanupPackageRootCaches();
});

test("resolvePackageTemplateRoot uses an entry's installed source directly", async () => {
  await withTempDir(async (appRoot) => {
    const packageRoot = path.join(appRoot, "node_modules", "@acme", "demo-package");
    assert.equal(
      await resolvePackageTemplateRoot({
        appRoot,
        packageEntry: {
          packageId: "@acme/demo-package",
          rootDir: packageRoot
        }
      }),
      packageRoot
    );
  });
});

test("resolvePackageTemplateRoot reads installed package.json jskit metadata", async () => {
  await withTempDir(async (appRoot) => {
    const packageRoot = path.join(appRoot, "node_modules", "@acme", "demo-package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@acme/demo-package",
        version: "1.2.3",
        jskit: { kind: "runtime" }
      }, null, 2)}\n`,
      "utf8"
    );

    assert.equal(
      await resolvePackageTemplateRoot({
        appRoot,
        packageEntry: {
          packageId: "@acme/demo-package",
          rootDir: ""
        }
      }),
      packageRoot
    );
  });
});

test("resolvePackageTemplateRoot never downloads missing package source", async () => {
  await withTempDir(async (appRoot) => {
    await assert.rejects(
      () => resolvePackageTemplateRoot({
        appRoot,
        packageEntry: {
          packageId: "@acme/missing-package",
          version: "2.0.0",
          sourceType: "catalog",
          rootDir: ""
        }
      }),
      /Package source is not installed/
    );
    assert.equal(
      await access(path.join(appRoot, ".jskit", "cache")).then(() => true, () => false),
      false
    );
  });
});
