import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { composeServerRuntimeArtifacts } from "../../server/framework/composeRuntime.js";
import { loadFrameworkExtensions } from "../../server/framework/extensionsLoader.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(TEST_DIR, "fixtures/extensions");

test("composeServerRuntimeArtifacts includes loaded extension modules", async () => {
  const extensionModules = await loadFrameworkExtensions({
    extensionModulePaths: ["sampleExtension.js"],
    cwd: FIXTURE_DIR
  });

  const artifacts = composeServerRuntimeArtifacts({
    extensionModules
  });

  assert.equal(artifacts.moduleOrder.includes("sampleExtension"), true);
  assert.equal(artifacts.disabledModules.some((entry) => entry.id === "sampleExtension"), false);
});

test("composeServerRuntimeArtifacts throws for extension modules with strict dependency failures", async () => {
  const extensionModules = await loadFrameworkExtensions({
    extensionModulePaths: ["brokenDependencyExtension.js"],
    cwd: FIXTURE_DIR
  });

  assert.throws(
    () =>
      composeServerRuntimeArtifacts({
        mode: "strict",
        extensionModules
      }),
    (error) => {
      assert.equal(error?.code, "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR");
      assert.equal(
        error.diagnostics.some(
          (entry) => entry.code === "MODULE_DEPENDENCY_MISSING" && entry.moduleId === "brokenDependencyExtension"
        ),
        true
      );
      return true;
    }
  );
});

test("composeServerRuntimeArtifacts disables extension modules with permissive dependency failures", async () => {
  const extensionModules = await loadFrameworkExtensions({
    extensionModulePaths: ["brokenDependencyExtension.js"],
    cwd: FIXTURE_DIR
  });

  const artifacts = composeServerRuntimeArtifacts({
    mode: "permissive",
    extensionModules
  });

  assert.equal(artifacts.moduleOrder.includes("brokenDependencyExtension"), false);
  assert.equal(artifacts.disabledModules.some((entry) => entry.id === "brokenDependencyExtension"), true);
});

test("composeServerRuntimeArtifacts throws for extension modules with unknown contributions in strict mode", async () => {
  const extensionModules = await loadFrameworkExtensions({
    extensionModulePaths: ["unknownContributionExtension.js"],
    cwd: FIXTURE_DIR
  });

  assert.throws(
    () =>
      composeServerRuntimeArtifacts({
        mode: "strict",
        extensionModules
      }),
    (error) => {
      assert.equal(error?.code, "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR");
      assert.equal(
        error.diagnostics.some(
          (entry) =>
            entry.code === "MODULE_CONTRIBUTION_UNKNOWN" &&
            entry.details?.contributionKey === "routes" &&
            entry.details?.id === "missingRoute"
        ),
        true
      );
      return true;
    }
  );
});

test("composeServerRuntimeArtifacts warns on unknown contributions in permissive mode", async () => {
  const extensionModules = await loadFrameworkExtensions({
    extensionModulePaths: ["unknownContributionExtension.js"],
    cwd: FIXTURE_DIR
  });

  const artifacts = composeServerRuntimeArtifacts({
    mode: "permissive",
    extensionModules
  });

  assert.equal(artifacts.moduleOrder.includes("unknownContributionExtension"), true);
  assert.equal(artifacts.routeModuleIds.includes("missingRoute"), false);
  assert.equal(
    artifacts.diagnostics.some(
      (entry) => entry.level === "warn" && entry.code === "MODULE_CONTRIBUTION_UNKNOWN"
    ),
    true
  );
});

test("composeServerRuntimeArtifacts rejects extension ids that collide with first-party ids", () => {
  assert.throws(
    () =>
      composeServerRuntimeArtifacts({
        extensionModules: [
          {
            id: "auth",
            version: "0.1.0",
            tier: "extension",
            contributions: {}
          }
        ]
      }),
    /Duplicate server module id "auth"/
  );
});
