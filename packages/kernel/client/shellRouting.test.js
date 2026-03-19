import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import { buildSurfaceAwareRoutes } from "./shellRouting.js";

test("buildSurfaceAwareRoutes keeps declared route paths and filters by surface mode", () => {
  const surfaceRuntime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", pagesRoot: "app", enabled: true, requiresWorkspace: false },
      coffie: { id: "coffie", pagesRoot: "coffie", enabled: true, requiresWorkspace: true },
      console: { id: "console", pagesRoot: "console", enabled: true, requiresWorkspace: false }
    }
  });

  const routes = buildSurfaceAwareRoutes({
    routes: [
      {
        path: "/app/home",
        name: "app-home",
        component: {}
      },
      {
        path: "/coffie",
        name: "coffie-home",
        component: {}
      },
      {
        path: "/coffie/members",
        name: "coffie-members",
        component: {}
      },
      {
        path: "/coffie/workspaces",
        name: "coffie-workspaces",
        component: {}
      },
      {
        path: "/console/settings",
        name: "console-settings",
        component: {}
      },
      {
        path: "/auth/login",
        name: "auth-login",
        scope: "global",
        component: {}
      },
      {
        path: "/",
        name: "root-global",
        component: {},
        meta: {
          jskit: {
            scope: "global"
          }
        }
      }
    ],
    surfaceRuntime,
    surfaceMode: "all",
    notFoundComponent: {}
  });

  const routePaths = routes.map((route) => route.path);
  assert.equal(routePaths.includes("/coffie"), true);
  assert.equal(routePaths.includes("/coffie/members"), true);
  assert.equal(routePaths.includes("/coffie/workspaces"), true);
  assert.equal(routePaths.includes("/app/home"), true);
  assert.equal(routePaths.includes("/console/settings"), true);
  assert.equal(routePaths.includes("/auth/login"), true);
  assert.equal(routePaths.includes("/"), true);
});

test("buildSurfaceAwareRoutes preserves parent path when nested descendants are global", () => {
  const surfaceRuntime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", pagesRoot: "w/[workspaceSlug]", enabled: true, requiresWorkspace: true },
      admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", enabled: true, requiresWorkspace: true }
    }
  });

  const routes = buildSurfaceAwareRoutes({
    routes: [
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
      }
    ],
    surfaceRuntime,
    surfaceMode: "all",
    notFoundComponent: {}
  });

  const routePaths = routes.map((route) => route.path);
  assert.equal(routePaths.includes("/account"), true);
});
