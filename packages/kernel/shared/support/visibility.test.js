import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRouteVisibility, normalizeVisibilityContext } from "./visibility.js";

test("normalizeRouteVisibility normalizes non-empty visibility tokens", () => {
  assert.equal(normalizeRouteVisibility("workspace"), "workspace");
  assert.equal(normalizeRouteVisibility("WORKSPACE_USER"), "workspace_user");
  assert.equal(normalizeRouteVisibility(""), "public");
  assert.equal(normalizeRouteVisibility("invalid"), "invalid");
});

test("normalizeVisibilityContext normalizes mode and owner identifiers", () => {
  assert.deepEqual(normalizeVisibilityContext({ visibility: "user", userOwnerId: "7" }), {
    visibility: "user",
    scopeKind: null,
    requiresActorScope: false,
    scopeOwnerId: null,
    userOwnerId: "7"
  });

  assert.deepEqual(normalizeVisibilityContext({ visibility: "workspace_user", scopeOwnerId: "4", userOwnerId: 9 }), {
    visibility: "workspace_user",
    scopeKind: null,
    requiresActorScope: false,
    scopeOwnerId: "4",
    userOwnerId: 9
  });

  assert.deepEqual(normalizeVisibilityContext({ visibility: "workspace", scopeOwnerId: "0" }), {
    visibility: "workspace",
    scopeKind: null,
    requiresActorScope: false,
    scopeOwnerId: "0",
    userOwnerId: null
  });
});
