import assert from "node:assert/strict";
import test from "node:test";

import { createSurfaceRuntime, filterRoutesBySurface } from "./runtime.js";

test("createSurfaceRuntime resolves enabled surfaces and normalizes surface mode", () => {
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
  assert.equal(runtime.DEFAULT_SURFACE_ID, "app");
  assert.equal(runtime.getSurfaceDefinition("missing"), null);
  assert.deepEqual(
    runtime.listSurfaceDefinitions({ enabledOnly: true }).map((entry) => entry.id),
    ["app", "admin"]
  );
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

test("createSurfaceRuntime does not infer workspace slug URL semantics", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "/", enabled: true, requiresWorkspace: true },
      admin: { id: "admin", prefix: "/admin", enabled: true, requiresWorkspace: true },
      console: { id: "console", prefix: "/console", enabled: true, requiresWorkspace: false }
    }
  });

  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/projects"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/admin"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/admin/contacts"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/console"), "console");
  assert.equal(runtime.resolveSurfaceFromPathname("/admin/contacts"), "admin");
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

test("filterRoutesBySurface always keeps global routes", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true }
    }
  });

  const filteredAdmin = filterRoutesBySurface(
    [
      { path: "/auth/login", scope: "global" },
      { path: "/admin/users" },
      { path: "/app-only", surface: "app" }
    ],
    {
      surfaceRuntime: runtime,
      surfaceMode: "admin"
    }
  );

  assert.deepEqual(
    filteredAdmin.map((route) => route.path),
    ["/auth/login", "/admin/users"]
  );
});

test("filterRoutesBySurface keeps parent route when a nested descendant is global", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true }
    }
  });

  const filteredAdmin = filterRoutesBySurface(
    [
      {
        path: "/account",
        children: [
          {
            path: "settings",
            children: [
              {
                path: "",
                component: {},
                meta: {
                  jskit: {
                    scope: "global"
                  }
                }
              }
            ]
          }
        ]
      },
      { path: "/admin/users" }
    ],
    {
      surfaceRuntime: runtime,
      surfaceMode: "admin"
    }
  );

  assert.deepEqual(
    filteredAdmin.map((route) => route.path),
    ["/account", "/admin/users"]
  );
});
