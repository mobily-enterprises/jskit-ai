import assert from "node:assert/strict";
import test from "node:test";

import { createSurfaceRegistry, normalizeSurfaceId, normalizeSurfacePrefix } from "./registry.js";

test("normalizeSurfaceId lowercases and trims", () => {
  assert.equal(normalizeSurfaceId(" Admin "), "admin");
  assert.equal(normalizeSurfaceId(""), "");
  assert.equal(normalizeSurfaceId(null), "");
});

test("normalizeSurfacePrefix normalizes slash style and root prefix", () => {
  assert.equal(normalizeSurfacePrefix(" admin "), "/admin");
  assert.equal(normalizeSurfacePrefix("/admin///"), "/admin");
  assert.equal(normalizeSurfacePrefix("/"), "");
  assert.equal(normalizeSurfacePrefix(""), "");
});

test("createSurfaceRegistry keeps registered normalization with fallback", () => {
  const registry = createSurfaceRegistry({
    surfaces: {
      app: { id: "app", prefix: "" },
      admin: { id: "admin", prefix: "/admin" }
    },
    defaultSurfaceId: "app"
  });

  assert.equal(registry.normalizeSurfaceId("ADMIN"), "admin");
  assert.equal(registry.normalizeSurfaceId("unknown"), "app");
  assert.equal(registry.resolveSurfacePrefix("ADMIN"), "/admin");
});
