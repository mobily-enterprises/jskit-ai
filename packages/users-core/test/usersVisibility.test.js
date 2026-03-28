import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceVisibility,
  checkRouteVisibility
} from "../src/shared/support/usersVisibility.js";

test("checkRouteVisibility normalizes valid users visibility levels and throws on invalid input", () => {
  assert.equal(checkRouteVisibility("WORKSPACE"), "workspace");
  assert.equal(checkRouteVisibility("workspace_user"), "workspace_user");
  assert.equal(checkRouteVisibility("user"), "user");
  assert.throws(
    () => checkRouteVisibility(""),
    /must be one of/
  );
  assert.throws(
    () => checkRouteVisibility("unknown"),
    /must be one of/
  );
});

test("isWorkspaceVisibility recognizes workspace-only visibility levels", () => {
  assert.equal(isWorkspaceVisibility("workspace"), true);
  assert.equal(isWorkspaceVisibility("workspace_user"), true);
  assert.equal(isWorkspaceVisibility("public"), false);
  assert.equal(isWorkspaceVisibility("user"), false);
});
