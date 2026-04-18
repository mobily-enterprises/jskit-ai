import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRouteVisibility,
  isWorkspaceRouteVisibility,
  normalizeRouteVisibilityToken,
  normalizeRouteVisibility,
  normalizeVisibilityContext
} from "./visibility.js";

test("normalizeRouteVisibility keeps kernel core visibility contract", () => {
  assert.equal(normalizeRouteVisibility("PUBLIC"), "public");
  assert.equal(normalizeRouteVisibility("user"), "user");
  assert.equal(normalizeRouteVisibility("workspace"), "public");
  assert.equal(normalizeRouteVisibility("invalid"), "public");
  assert.equal(normalizeRouteVisibility("invalid", { fallback: "user" }), "user");
  assert.equal(normalizeRouteVisibility(""), "public");
});

test("normalizeRouteVisibilityToken normalizes visibility tokens for module-level resolvers", () => {
  assert.equal(normalizeRouteVisibilityToken("workspace"), "workspace");
  assert.equal(normalizeRouteVisibilityToken("WORKSPACE_USER"), "workspace_user");
  assert.equal(normalizeRouteVisibilityToken(""), "public");
  assert.equal(normalizeRouteVisibilityToken("", { fallback: "workspace" }), "workspace");
});

test("checkRouteVisibility accepts workspace visibility tokens", () => {
  assert.equal(checkRouteVisibility("workspace"), "workspace");
  assert.equal(checkRouteVisibility("workspace_user"), "workspace_user");
  assert.throws(() => checkRouteVisibility("invalid"), /must be one of/);
});

test("isWorkspaceRouteVisibility matches only workspace-scoped tokens", () => {
  assert.equal(isWorkspaceRouteVisibility("workspace"), true);
  assert.equal(isWorkspaceRouteVisibility("workspace_user"), true);
  assert.equal(isWorkspaceRouteVisibility("public"), false);
});

test("normalizeVisibilityContext normalizes mode and owner identifiers", () => {
  assert.deepEqual(normalizeVisibilityContext({ visibility: "user", userId: "7" }), {
    visibility: "user",
    scopeKind: null,
    requiresActorScope: false,
    scopeOwnerId: null,
    userId: "7"
  });

  assert.deepEqual(normalizeVisibilityContext({ visibility: "workspace_user", scopeOwnerId: "4", userId: 9 }), {
    visibility: "workspace_user",
    scopeKind: null,
    requiresActorScope: false,
    scopeOwnerId: "4",
    userId: "9"
  });

  assert.deepEqual(normalizeVisibilityContext({ visibility: "workspace", scopeOwnerId: "0" }), {
    visibility: "workspace",
    scopeKind: null,
    requiresActorScope: false,
    scopeOwnerId: "0",
    userId: null
  });
});
