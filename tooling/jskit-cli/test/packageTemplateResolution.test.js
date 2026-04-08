import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { withTempDir } from "../../testUtils/tempDir.mjs";
import {
  materializeCatalogPackageRoot,
  resolvePackageTemplateRoot,
  cleanupMaterializedPackageRoots
} from "../src/server/cliRuntime/packageTemplateResolution.js";

test.afterEach(async () => {
  await cleanupMaterializedPackageRoots();
});

test("resolvePackageTemplateRoot uses catalog materialization for missing internal catalog packages", async () => {
  await withTempDir(async (appRoot) => {
    const calls = [];
    const resolvedRoot = await resolvePackageTemplateRoot({
      appRoot,
      packageEntry: {
        packageId: "@jskit-ai/demo-package",
        version: "1.2.3",
        sourceType: "catalog",
        rootDir: ""
      },
      materializeCatalogRoot: async ({ packageEntry, appRoot: resolvedAppRoot }) => {
        calls.push({
          packageId: packageEntry.packageId,
          version: packageEntry.version,
          appRoot: resolvedAppRoot
        });
        return path.join(resolvedAppRoot, ".jskit", "cache", "mock-package-root");
      }
    });

    assert.equal(
      resolvedRoot,
      path.join(appRoot, ".jskit", "cache", "mock-package-root")
    );
    assert.deepEqual(calls, [
      {
        packageId: "@jskit-ai/demo-package",
        version: "1.2.3",
        appRoot
      }
    ]);
  });
});

test("resolvePackageTemplateRoot keeps failing for non-internal catalog packages with no local source", async () => {
  await withTempDir(async (appRoot) => {
    await assert.rejects(
      () =>
        resolvePackageTemplateRoot({
          appRoot,
          packageEntry: {
            packageId: "@acme/external-package",
            version: "2.0.0",
            sourceType: "catalog",
            rootDir: ""
          }
        }),
      /Unable to resolve local template source/
    );
  });
});

test("materializeCatalogPackageRoot reuses cached package roots after first materialization", async () => {
  await withTempDir(async (appRoot) => {
    const calls = [];
    const expectedRoot = path.join(
      appRoot,
      ".jskit",
      "cache",
      "package-sources",
      encodeURIComponent("@jskit-ai/demo-package"),
      encodeURIComponent("1.2.3"),
      "node_modules",
      "@jskit-ai",
      "demo-package"
    );

    const first = await materializeCatalogPackageRoot({
      appRoot,
      packageEntry: {
        packageId: "@jskit-ai/demo-package",
        version: "1.2.3",
        sourceType: "catalog"
      },
      installCatalogPackage: async ({ installRoot }) => {
        calls.push(installRoot);
        const descriptorPath = path.join(
          installRoot,
          "node_modules",
          "@jskit-ai",
          "demo-package",
          "package.descriptor.mjs"
        );
        await import("node:fs/promises").then(({ mkdir, writeFile }) =>
          mkdir(path.dirname(descriptorPath), { recursive: true }).then(() =>
            writeFile(descriptorPath, "export default {};\n", "utf8")
          )
        );
      }
    });
    const second = await materializeCatalogPackageRoot({
      appRoot,
      packageEntry: {
        packageId: "@jskit-ai/demo-package",
        version: "1.2.3",
        sourceType: "catalog"
      },
      installCatalogPackage: async () => {
        calls.push("unexpected");
      }
    });

    assert.equal(first, expectedRoot);
    assert.equal(second, expectedRoot);
    assert.equal(calls.length, 1);
  });
});
