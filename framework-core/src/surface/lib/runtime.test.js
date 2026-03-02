import assert from "node:assert/strict";
import test from "node:test";

import { createSurfaceRuntime, filterRoutesBySurface } from "./runtime.js";

test("createSurfaceRuntime normalizes mode and resolves enabled surfaces", () => {
  const runtime = createSurfaceRuntime({
    allMode: "all",
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true },
      console: { id: "console", prefix: "/console", enabled: false }
    }
  });

  assert.equal(runtime.normalizeSurfaceMode("admin"), "admin");
  assert.equal(runtime.normalizeSurfaceMode("unknown"), "all");
  assert.deepEqual(runtime.listEnabledSurfaceIds(), ["app", "admin"]);
  assert.equal(runtime.isSurfaceEnabled("console"), false);
  assert.equal(runtime.isSurfaceEnabled("admin"), true);
});

test("createSurfaceRuntime resolves pathname by surface prefix", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true },
      console: { id: "console", prefix: "/console", enabled: true }
    }
  });

  assert.equal(runtime.resolveSurfaceFromPathname("/admin/users"), "admin");
  assert.equal(runtime.resolveSurfaceFromPathname("/console"), "console");
  assert.equal(runtime.resolveSurfaceFromPathname("/"), "app");
});

test("filterRoutesBySurface keeps enabled routes for chosen mode", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true },
      console: { id: "console", prefix: "/console", enabled: false }
    }
  });

  const filteredAll = filterRoutesBySurface(
    [{ path: "/" }, { path: "/admin" }, { path: "/console" }],
    {
      surfaceRuntime: runtime,
      surfaceMode: "all"
    }
  );
  assert.deepEqual(
    filteredAll.map((route) => route.path),
    ["/", "/admin"]
  );

  const filteredAdmin = filterRoutesBySurface(
    [{ path: "/" }, { path: "/admin/users" }, { path: "/console" }],
    {
      surfaceRuntime: runtime,
      surfaceMode: "admin"
    }
  );
  assert.deepEqual(
    filteredAdmin.map((route) => route.path),
    ["/admin/users"]
  );
});
