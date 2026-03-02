import assert from "node:assert/strict";
import test from "node:test";

import { resolveDependencyGraph, satisfiesVersion } from "../src/lib/dependencyGraph.js";
import { moduleDescriptor } from "./helpers/moduleDescriptor.js";

test("satisfiesVersion supports exact, caret, tilde, and comparator ranges", () => {
  assert.equal(satisfiesVersion("1.2.3", "1.2.3"), true);
  assert.equal(satisfiesVersion("1.4.0", "^1.2.3"), true);
  assert.equal(satisfiesVersion("2.0.0", "^1.2.3"), false);
  assert.equal(satisfiesVersion("1.2.9", "~1.2.3"), true);
  assert.equal(satisfiesVersion("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesVersion("1.2.3", ">=1.0.0 <2.0.0"), true);
  assert.equal(satisfiesVersion("1.2.3", ">=1.0.0 <2.0.0 || >=3.0.0"), true);
  assert.equal(satisfiesVersion("1.2.3", "not-a-range"), false);
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

test("resolveDependencyGraph reports invalid dependency ranges", () => {
  const result = resolveDependencyGraph({
    mode: "permissive",
    modules: [
      moduleDescriptor({ id: "core", version: "1.2.3" }),
      moduleDescriptor({
        id: "chat",
        dependsOnModules: [{ id: "core", range: "not-a-range" }]
      })
    ]
  });

  assert.deepEqual(result.modules.map((module) => module.id), ["core"]);
  assert.ok(result.diagnostics.toJSON().some((entry) => entry.code === "MODULE_DEPENDENCY_RANGE_INVALID"));
});

test("resolveDependencyGraph reports invalid dependency versions", () => {
  const result = resolveDependencyGraph({
    mode: "permissive",
    modules: [
      moduleDescriptor({ id: "core", version: "1" }),
      moduleDescriptor({
        id: "chat",
        dependsOnModules: [{ id: "core", range: "^1.0.0" }]
      })
    ]
  });

  assert.deepEqual(result.modules.map((module) => module.id), ["core"]);
  assert.ok(result.diagnostics.toJSON().some((entry) => entry.code === "MODULE_DEPENDENCY_VERSION_INVALID"));
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
