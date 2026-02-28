import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_TIERS } from "../src/shared/descriptor.js";
import {
  detectRouteConflicts,
  detectActionConflicts,
  detectTopicConflicts,
  resolveConflicts
} from "../src/shared/conflicts.js";

function moduleDescriptor(overrides = {}) {
  return {
    id: "module-a",
    version: "1.0.0",
    tier: MODULE_TIERS.feature,
    ...overrides
  };
}

test("conflict detectors identify duplicates", () => {
  const routeConflicts = detectRouteConflicts([
    { method: "GET", path: "/health" },
    { method: "GET", path: "/health" }
  ]);
  const actionConflicts = detectActionConflicts([{ id: "action.read" }, { id: "action.read" }]);
  const topicConflicts = detectTopicConflicts([{ topic: "workspace.updated" }, { topic: "workspace.updated" }]);

  assert.equal(routeConflicts.conflicts.length, 1);
  assert.equal(actionConflicts.conflicts.length, 1);
  assert.equal(topicConflicts.conflicts.length, 1);
});

test("resolveConflicts strict mode throws on duplicate contributions", () => {
  assert.throws(
    () =>
      resolveConflicts({
        mode: "strict",
        modules: [moduleDescriptor({ id: "a" })],
        routes: [
          { method: "GET", path: "/health", moduleId: "a" },
          { method: "GET", path: "/health", moduleId: "b" }
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "ROUTE_CONFLICT")
  );
});

test("resolveConflicts permissive mode throws on route conflicts", () => {
  assert.throws(
    () =>
      resolveConflicts({
        mode: "permissive",
        modules: [moduleDescriptor({ id: "a" }), moduleDescriptor({ id: "b" })],
        routes: [
          { method: "GET", path: "/health", moduleId: "a" },
          { method: "GET", path: "/health", moduleId: "b" }
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "ROUTE_CONFLICT")
  );
});

test("resolveConflicts permissive mode throws on action conflicts", () => {
  assert.throws(
    () =>
      resolveConflicts({
        mode: "permissive",
        modules: [moduleDescriptor({ id: "a" }), moduleDescriptor({ id: "b" })],
        actions: [{ id: "action.read", moduleId: "a" }, { id: "action.read", moduleId: "b" }]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "ACTION_CONFLICT")
  );
});

test("resolveConflicts permissive mode keeps first topic entry with warnings", () => {
  const result = resolveConflicts({
    mode: "permissive",
    modules: [moduleDescriptor({ id: "a" }), moduleDescriptor({ id: "b" })],
    topics: [
      { topic: "workspace.updated", moduleId: "a" },
      { topic: "workspace.updated", moduleId: "b" }
    ]
  });

  assert.equal(result.topics.length, 1);
  assert.ok(result.diagnostics.toJSON().some((entry) => entry.code === "TOPIC_CONFLICT"));
});
