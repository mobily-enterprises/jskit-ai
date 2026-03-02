import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadFrameworkExtensions, __testables } from "../../server/framework/extensionsLoader.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(TEST_DIR, "fixtures/extensions");

test("normalizeExtensionModulePaths handles arrays and csv entries", () => {
  assert.deepEqual(__testables.normalizeExtensionModulePaths(null), []);
  assert.deepEqual(__testables.normalizeExtensionModulePaths(["./a.js", " ./a.js ", "./b.js"]), ["./a.js", "./b.js"]);
  assert.deepEqual(__testables.normalizeExtensionModulePaths(" ./a.js, , ./b.js,./a.js "), ["./a.js", "./b.js"]);
});

test("loadFrameworkExtensions loads and normalizes extension contributions", async () => {
  const modules = await loadFrameworkExtensions({
    extensionModulePaths: ["sampleExtension.js"],
    cwd: FIXTURE_DIR
  });

  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, "sampleExtension");
  assert.equal(modules[0].tier, "extension");
  assert.deepEqual(modules[0].contributions.actionContributorModules, ["workspace"]);
});

test("loadFrameworkExtensions rejects invalid contribution shapes", async () => {
  await assert.rejects(
    () =>
      loadFrameworkExtensions({
        extensionModulePaths: ["invalidContributionShapeExtension.js"],
        cwd: FIXTURE_DIR
      }),
    /expected an array/
  );
});

test("loadFrameworkExtensions rejects duplicate extension ids", async () => {
  await assert.rejects(
    () =>
      loadFrameworkExtensions({
        extensionModulePaths: ["duplicateIdsExtension.js"],
        cwd: FIXTURE_DIR
      }),
    /Duplicate extension module id/
  );
});
