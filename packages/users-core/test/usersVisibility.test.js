import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceVisibility,
  normalizeScopedRouteVisibility
} from "../src/shared/support/usersVisibility.js";

test("normalizeScopedRouteVisibility normalizes users visibility levels", () => {
  assert.equal(normalizeScopedRouteVisibility("WORKSPACE"), "workspace");
  assert.equal(normalizeScopedRouteVisibility("workspace_user"), "workspace_user");
  assert.equal(normalizeScopedRouteVisibility("user"), "user");
  assert.equal(normalizeScopedRouteVisibility(""), "public");
  assert.equal(normalizeScopedRouteVisibility("unknown"), "public");
  assert.equal(normalizeScopedRouteVisibility("unknown", { fallback: "workspace" }), "workspace");
});

test("isWorkspaceVisibility recognizes workspace-only visibility levels", () => {
  assert.equal(isWorkspaceVisibility("workspace"), true);
  assert.equal(isWorkspaceVisibility("workspace_user"), true);
  assert.equal(isWorkspaceVisibility("public"), false);
  assert.equal(isWorkspaceVisibility("user"), false);
});
