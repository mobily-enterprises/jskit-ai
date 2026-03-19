import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceVisibility,
  normalizeUsersRouteVisibility
} from "../src/shared/support/usersVisibility.js";

test("normalizeUsersRouteVisibility normalizes users visibility levels", () => {
  assert.equal(normalizeUsersRouteVisibility("WORKSPACE"), "workspace");
  assert.equal(normalizeUsersRouteVisibility("workspace_user"), "workspace_user");
  assert.equal(normalizeUsersRouteVisibility("user"), "user");
  assert.equal(normalizeUsersRouteVisibility(""), "public");
  assert.equal(normalizeUsersRouteVisibility("unknown"), "public");
  assert.equal(normalizeUsersRouteVisibility("unknown", { fallback: "workspace" }), "workspace");
});

test("isWorkspaceVisibility recognizes workspace-only visibility levels", () => {
  assert.equal(isWorkspaceVisibility("workspace"), true);
  assert.equal(isWorkspaceVisibility("workspace_user"), true);
  assert.equal(isWorkspaceVisibility("public"), false);
  assert.equal(isWorkspaceVisibility("user"), false);
});
