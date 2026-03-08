import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import { buildSurfaceAwareRoutes } from "./shellRouting.js";

test("buildSurfaceAwareRoutes adds workspace-slug aliases for surface routes", () => {
  const surfaceRuntime = createSurfaceRuntime({
    tenancyMode: "workspace",
    defaultSurfaceId: "app",
    surfaces: {
      app: { id: "app", prefix: "/app", enabled: true, requiresWorkspace: false },
      coffie: { id: "coffie", prefix: "/coffie", enabled: true, requiresWorkspace: true }
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
        path: "/auth/login",
        name: "auth-login",
        scope: "global",
        component: {}
      }
    ],
    surfaceRuntime,
    surfaceMode: "all",
    notFoundComponent: {}
  });

  const routePaths = routes.map((route) => route.path);
  assert.equal(routePaths.includes("/coffie/w/:workspaceSlug"), true);
  assert.equal(routePaths.includes("/coffie/w/:workspaceSlug/members"), true);
  assert.equal(routePaths.includes("/coffie/w/:workspaceSlug/workspaces"), false);
  assert.equal(routePaths.includes("/app/w/:workspaceSlug/home"), true);
});
