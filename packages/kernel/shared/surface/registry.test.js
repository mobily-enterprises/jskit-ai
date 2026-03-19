import assert from "node:assert/strict";
import test from "node:test";

import {
  createSurfaceRegistry,
  deriveSurfaceRouteBaseFromPagesRoot,
  normalizeSurfaceId,
  normalizeSurfacePagesRoot
} from "./registry.js";

test("normalizeSurfaceId lowercases and trims", () => {
  assert.equal(normalizeSurfaceId(" Admin "), "admin");
  assert.equal(normalizeSurfaceId(""), "");
  assert.equal(normalizeSurfaceId(null), "");
});

test("normalizeSurfacePagesRoot normalizes slash style and root pages root", () => {
  assert.equal(normalizeSurfacePagesRoot(" admin "), "admin");
  assert.equal(normalizeSurfacePagesRoot("/admin///"), "admin");
  assert.equal(normalizeSurfacePagesRoot("/"), "");
  assert.equal(normalizeSurfacePagesRoot(""), "");
});

test("deriveSurfaceRouteBaseFromPagesRoot converts dynamic segments", () => {
  assert.equal(deriveSurfaceRouteBaseFromPagesRoot(""), "/");
  assert.equal(deriveSurfaceRouteBaseFromPagesRoot("console"), "/console");
  assert.equal(deriveSurfaceRouteBaseFromPagesRoot("w/[workspaceSlug]"), "/w/:workspaceSlug");
  assert.equal(deriveSurfaceRouteBaseFromPagesRoot("w/[workspaceSlug]/admin"), "/w/:workspaceSlug/admin");
});

test("createSurfaceRegistry keeps registered normalization with fallback", () => {
  const registry = createSurfaceRegistry({
    surfaces: {
      app: { id: "app", pagesRoot: "" },
      admin: { id: "admin", pagesRoot: "admin" }
    },
    defaultSurfaceId: "app"
  });

  assert.equal(registry.normalizeSurfaceId("ADMIN"), "admin");
  assert.equal(registry.normalizeSurfaceId("unknown"), "app");
  assert.equal(registry.resolveSurfacePagesRoot("ADMIN"), "admin");
  assert.equal(registry.resolveSurfaceRouteBase("ADMIN"), "/admin");
});
