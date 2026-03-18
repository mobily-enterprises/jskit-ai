import assert from "node:assert/strict";
import test from "node:test";

import { createSurfaceRuntime, filterRoutesBySurface } from "./runtime.js";

test("createSurfaceRuntime normalizes mode and resolves enabled surfaces", () => {
  const runtime = createSurfaceRuntime({
    allMode: "all",
    tenancyMode: "none",
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
  assert.equal(runtime.surfaceRequiresWorkspace("app"), false);
  assert.equal(runtime.surfaceRequiresWorkspace("missing"), false);
  assert.equal(runtime.getSurfaceDefinition("missing"), null);
  assert.equal(runtime.TENANCY_MODE, "none");
  assert.deepEqual(runtime.listWorkspaceSurfaceIds(), []);
  assert.deepEqual(runtime.listNonWorkspaceSurfaceIds(), ["app", "admin"]);
  assert.deepEqual(
    runtime.listSurfaceDefinitions({ enabledOnly: true }).map((entry) => entry.id),
    ["app", "admin"]
  );
});

test("createSurfaceRuntime resolves pathname by surface prefix", () => {
  const runtime = createSurfaceRuntime({
    tenancyMode: "none",
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

test("createSurfaceRuntime resolves workspace-first surface paths", () => {
  const runtime = createSurfaceRuntime({
    tenancyMode: "workspace",
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "/", enabled: true, requiresWorkspace: true },
      admin: { id: "admin", prefix: "/admin", enabled: true, requiresWorkspace: true },
      console: { id: "console", prefix: "/console", enabled: true, requiresWorkspace: false }
    }
  });

  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/projects"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/admin"), "admin");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/admin/contacts"), "admin");
  assert.equal(runtime.resolveSurfaceFromPathname("/console"), "console");
});

test("filterRoutesBySurface keeps enabled routes for chosen mode", () => {
  const runtime = createSurfaceRuntime({
    tenancyMode: "none",
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
    tenancyMode: "none",
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
    tenancyMode: "none",
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

test("createSurfaceRuntime rejects workspace surfaces when tenancyMode is none", () => {
  assert.throws(
    () =>
      createSurfaceRuntime({
        tenancyMode: "none",
        defaultSurfaceId: "app",
        surfaces: {
          app: { id: "app", prefix: "", enabled: true },
          admin: { id: "admin", prefix: "/admin", enabled: true, requiresWorkspace: true }
        }
      }),
    /tenancyMode "none" cannot enable workspace surfaces/
  );
});

test("createSurfaceRuntime rejects non-none tenancy mode with no workspace surfaces", () => {
  assert.throws(
    () =>
      createSurfaceRuntime({
        tenancyMode: "workspace",
        defaultSurfaceId: "app",
        surfaces: {
          app: { id: "app", prefix: "", enabled: true },
          admin: { id: "admin", prefix: "/admin", enabled: true }
        }
      }),
    /requires at least one enabled workspace surface/
  );
});

test("createSurfaceRuntime accepts personal/workspace tenancy with workspace-enabled surface", () => {
  const runtime = createSurfaceRuntime({
    tenancyMode: "personal",
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "/app", enabled: true },
      coffie: { id: "coffie", prefix: "/coffie", enabled: true, requiresWorkspace: true }
    }
  });

  assert.equal(runtime.TENANCY_MODE, "personal");
  assert.deepEqual(runtime.listWorkspaceSurfaceIds(), ["coffie"]);
  assert.deepEqual(runtime.listNonWorkspaceSurfaceIds(), ["app"]);
});

test("createSurfaceRuntime applies workspace surface policy preferred ids", () => {
  const runtime = createSurfaceRuntime({
    tenancyMode: "workspace",
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "/app", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true },
      console: { id: "console", prefix: "/console", enabled: false }
    },
    workspaceSurfacePolicy: {
      preferredSurfaceIds: ["app", "admin"],
      ensureAtLeastOneWorkspaceSurface: true
    }
  });

  assert.deepEqual(runtime.listWorkspaceSurfaceIds(), ["app", "admin"]);
});

test("createSurfaceRuntime applies workspace surface policy fallback to first enabled surface", () => {
  const runtime = createSurfaceRuntime({
    tenancyMode: "workspace",
    defaultSurfaceId: "web",
    surfaces: {
      web: { id: "web", prefix: "/web", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true }
    },
    workspaceSurfacePolicy: {
      preferredSurfaceIds: ["app"],
      ensureAtLeastOneWorkspaceSurface: true
    }
  });

  assert.deepEqual(runtime.listWorkspaceSurfaceIds(), ["web"]);
});
