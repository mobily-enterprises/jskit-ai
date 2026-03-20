import assert from "node:assert/strict";
import test from "node:test";

import { createSurfaceRuntime, filterRoutesBySurface } from "./runtime.js";

test("createSurfaceRuntime resolves enabled surfaces and normalizes surface mode", () => {
  const runtime = createSurfaceRuntime({
    allMode: "all",
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", pagesRoot: "", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true },
      console: { id: "console", pagesRoot: "console", enabled: false }
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

test("createSurfaceRuntime resolves pathname by derived surface route base", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", pagesRoot: "", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true },
      console: { id: "console", pagesRoot: "console", enabled: true }
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
      app: { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true, requiresWorkspace: true },
      admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresWorkspace: true },
      console: { id: "console", pagesRoot: "console", enabled: true, requiresWorkspace: false }
    }
  });

  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/projects"), "app");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/admin"), "admin");
  assert.equal(runtime.resolveSurfaceFromPathname("/w/acme/admin/contacts"), "admin");
  assert.equal(runtime.resolveSurfaceFromPathname("/console"), "console");
  assert.equal(runtime.resolveSurfaceFromPathname("/admin/contacts"), "app");
});

test("filterRoutesBySurface keeps enabled routes for chosen mode", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", pagesRoot: "", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true },
      console: { id: "console", pagesRoot: "console", enabled: false }
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
      app: { id: "app", pagesRoot: "", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true }
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
      app: { id: "app", pagesRoot: "", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true }
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

test("filterRoutesBySurface resolves route surface from metadata before pathname", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "home",
    surfaces: {
      home: { id: "home", pagesRoot: "", enabled: true },
      app: { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true },
      admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true }
    }
  });

  const filteredAdmin = filterRoutesBySurface(
    [
      {
        path: "/w/:workspaceSlug",
        component: {},
        meta: {
          jskit: {
            surface: "app"
          }
        },
        children: [{ path: "projects", component: {} }]
      },
      {
        path: "/w/:workspaceSlug/admin",
        component: {},
        meta: {
          jskit: {
            surface: "admin"
          }
        },
        children: [{ path: "users", component: {} }]
      }
    ],
    {
      surfaceRuntime: runtime,
      surfaceMode: "admin"
    }
  );

  assert.deepEqual(
    filteredAdmin.map((route) => route.path),
    ["/w/:workspaceSlug/admin"]
  );
  assert.equal(filteredAdmin[0].children?.length, 1);
  assert.equal(filteredAdmin[0].children?.[0]?.path, "users");
});

test("filterRoutesBySurface lets children inherit nearest ancestor surface metadata", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "home",
    surfaces: {
      home: { id: "home", pagesRoot: "", enabled: true },
      app: { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true },
      admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true }
    }
  });

  const filteredApp = filterRoutesBySurface(
    [
      {
        path: "/w/:workspaceSlug",
        component: {},
        meta: {
          jskit: {
            surface: "app"
          }
        },
        children: [
          { path: "projects", component: {} },
          {
            path: "admin",
            component: {},
            meta: {
              jskit: {
                surface: "admin"
              }
            },
            children: [{ path: "users", component: {} }]
          }
        ]
      }
    ],
    {
      surfaceRuntime: runtime,
      surfaceMode: "app"
    }
  );

  assert.deepEqual(filteredApp.map((route) => route.path), ["/w/:workspaceSlug"]);
  assert.equal(filteredApp[0].children?.length, 1);
  assert.equal(filteredApp[0].children?.[0]?.path, "projects");
});

test("filterRoutesBySurface hoists cross-surface nested route wrappers to top-level records", () => {
  const runtime = createSurfaceRuntime({
    defaultSurfaceId: "home",
    surfaces: {
      home: { id: "home", pagesRoot: "", enabled: true },
      app: { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true },
      admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true }
    }
  });

  const filteredAll = filterRoutesBySurface(
    [
      {
        path: "/w/:workspaceSlug",
        component: {},
        meta: {
          jskit: {
            surface: "app"
          }
        },
        children: [
          { path: "", component: {} },
          { path: "projects", component: {} },
          {
            path: "admin",
            component: {},
            meta: {
              jskit: {
                surface: "admin"
              }
            },
            children: [
              { path: "", component: {} },
              { path: "members", component: {} }
            ]
          }
        ]
      }
    ],
    {
      surfaceRuntime: runtime,
      surfaceMode: "all"
    }
  );

  assert.deepEqual(
    filteredAll.map((route) => route.path),
    ["/w/:workspaceSlug", "/w/:workspaceSlug/admin"]
  );
  assert.deepEqual(
    (filteredAll[0].children || []).map((route) => route.path),
    ["", "projects"]
  );
  assert.deepEqual(
    (filteredAll[1].children || []).map((route) => route.path),
    ["", "members"]
  );
});
