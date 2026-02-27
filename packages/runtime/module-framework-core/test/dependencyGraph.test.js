import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_TIERS } from "../src/shared/descriptor.js";
import { resolveDependencyGraph, satisfiesVersion } from "../src/shared/dependencyGraph.js";

function moduleDescriptor(overrides = {}) {
  return {
    id: "module-a",
    version: "1.0.0",
    tier: MODULE_TIERS.feature,
    ...overrides
  };
}

test("satisfiesVersion supports exact, caret, tilde, and comparator ranges", () => {
  assert.equal(satisfiesVersion("1.2.3", "1.2.3"), true);
  assert.equal(satisfiesVersion("1.4.0", "^1.2.3"), true);
  assert.equal(satisfiesVersion("2.0.0", "^1.2.3"), false);
  assert.equal(satisfiesVersion("1.2.9", "~1.2.3"), true);
  assert.equal(satisfiesVersion("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesVersion("1.2.3", ">=1.0.0 <2.0.0"), true);
});

test("resolveDependencyGraph orders modules deterministically", () => {
  const result = resolveDependencyGraph({
    modules: [
      moduleDescriptor({ id: "chat", dependsOnModules: [{ id: "core" }] }),
      moduleDescriptor({ id: "social", dependsOnModules: [{ id: "core" }] }),
      moduleDescriptor({ id: "core" })
    ]
  });

  assert.deepEqual(result.modules.map((module) => module.id), ["core", "chat", "social"]);
});

test("resolveDependencyGraph strict mode fails on missing required dependency", () => {
  assert.throws(
    () =>
      resolveDependencyGraph({
        mode: "strict",
        modules: [moduleDescriptor({ id: "chat", dependsOnModules: [{ id: "core" }] })]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_DEPENDENCY_MISSING")
  );
});

test("resolveDependencyGraph permissive mode disables modules with missing required dependency", () => {
  const result = resolveDependencyGraph({
    mode: "permissive",
    modules: [moduleDescriptor({ id: "chat", dependsOnModules: [{ id: "core" }] })]
  });

  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.disabledModules.map((entry) => entry.id), ["chat"]);
  assert.ok(result.diagnostics.toJSON().some((entry) => entry.code === "MODULE_DEPENDENCY_MISSING"));
});

test("resolveDependencyGraph strict mode fails on dependency cycle", () => {
  assert.throws(
    () =>
      resolveDependencyGraph({
        mode: "strict",
        modules: [
          moduleDescriptor({ id: "a", dependsOnModules: [{ id: "b" }] }),
          moduleDescriptor({ id: "b", dependsOnModules: [{ id: "a" }] })
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_DEPENDENCY_CYCLE")
  );
});

test("resolveDependencyGraph permissive mode disables modules involved in cycles", () => {
  const result = resolveDependencyGraph({
    mode: "permissive",
    modules: [
      moduleDescriptor({ id: "a", dependsOnModules: [{ id: "b" }] }),
      moduleDescriptor({ id: "b", dependsOnModules: [{ id: "a" }] })
    ]
  });

  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.disabledModules.map((entry) => entry.id), ["a", "b"]);
});

test("resolveDependencyGraph evaluates module enablement predicates", () => {
  const result = resolveDependencyGraph({
    mode: "permissive",
    context: {
      featureFlags: {
        social: false
      }
    },
    modules: [
      moduleDescriptor({
        id: "social",
        enabled({ featureFlags }) {
          return featureFlags.social;
        }
      })
    ]
  });

  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.disabledModules.map((entry) => entry.reason), ["disabled-by-predicate"]);
});
