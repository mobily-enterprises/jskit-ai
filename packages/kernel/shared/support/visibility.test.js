import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRouteVisibility, normalizeVisibilityContext } from "./visibility.js";

test("normalizeRouteVisibility falls back to public for unsupported values", () => {
  assert.equal(normalizeRouteVisibility("workspace"), "workspace");
  assert.equal(normalizeRouteVisibility("WORKSPACE_USER"), "workspace_user");
  assert.equal(normalizeRouteVisibility(""), "public");
  assert.equal(normalizeRouteVisibility("invalid"), "public");
});

test("normalizeVisibilityContext normalizes mode and owner identifiers", () => {
  assert.deepEqual(normalizeVisibilityContext({ visibility: "user", userOwnerId: "7" }), {
    visibility: "user",
    workspaceOwnerId: null,
    userOwnerId: 7
  });

  assert.deepEqual(normalizeVisibilityContext({ visibility: "workspace_user", workspaceOwnerId: "4", userOwnerId: 9 }), {
    visibility: "workspace_user",
    workspaceOwnerId: 4,
    userOwnerId: 9
  });

  assert.deepEqual(normalizeVisibilityContext({ visibility: "workspace", workspaceOwnerId: "0" }), {
    visibility: "workspace",
    workspaceOwnerId: null,
    userOwnerId: null
  });
});
