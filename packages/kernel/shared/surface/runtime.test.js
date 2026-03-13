import assert from "node:assert/strict";
import test from "node:test";

import { createSurfaceRuntime, filterRoutesBySurface, collectClientModuleRoutes } from "./runtime.js";

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

test("collectClientModuleRoutes normalizes scope metadata", () => {
  const routes = collectClientModuleRoutes({
    clientModules: [
      {
        packageId: "@jskit-ai/test-auth",
        module: {
          registerClientRoutes({ registerRoute }) {
            registerRoute({
              id: "auth.login",
              path: "/auth/login",
              scope: "global",
              component: () => null
            });
          }
        }
      }
    ]
  });

  assert.equal(routes.length, 1);
  assert.equal(routes[0].scope, "global");
  assert.equal(routes[0].meta.jskit.scope, "global");
  assert.equal(routes[0].meta.jskit.packageId, "@jskit-ai/test-auth");
});

test("collectClientModuleRoutes resolves component via resolveComponent when componentPath is declared", () => {
  const routes = collectClientModuleRoutes({
    clientModules: [
      {
        packageId: "@jskit-ai/test-auth",
        module: {
          registerClientRoutes({ registerRoute }) {
            registerRoute({
              id: "auth.login",
              path: "/auth/login",
              scope: "global",
              componentPath: "/src/views/auth/LoginView.vue"
            });
          }
        }
      }
    ],
    resolveComponent(route) {
      if (route.componentPath === "/src/views/auth/LoginView.vue") {
        return () => null;
      }
      return null;
    }
  });

  assert.equal(routes.length, 1);
  assert.equal(typeof routes[0].component, "function");
});
