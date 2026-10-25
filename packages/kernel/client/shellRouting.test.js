import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import { DEFAULT_GUARD_EVALUATOR_KEY, buildSurfaceAwareRoutes, createShellBeforeEachGuard } from "./shellRouting.js";

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

test("createShellBeforeEachGuard reads surfaces and the default root from the surface runtime", () => {
  const surfaceRuntime = createSurfaceRuntime({
    defaultSurfaceId: "app",
    surfaces: {
      home: { pagesRoot: "" },
      app: { pagesRoot: "w/app", requiresAuth: true }
    }
  });
  const evaluations = [];
  const previousEvaluator = globalThis[DEFAULT_GUARD_EVALUATOR_KEY];
  globalThis[DEFAULT_GUARD_EVALUATOR_KEY] = ({ guard, context }) => {
    evaluations.push({ policy: guard.policy, pathname: context.location.pathname });
    return { allow: false, redirectTo: "/auth/login" };
  };

  try {
    const guard = createShellBeforeEachGuard({ surfaceRuntime, webRootAllowed: "no" });
    assert.equal(guard({ path: "/", fullPath: "/?next=1#top", hash: "#top" }), "/w/app?next=1#top");
    assert.equal(guard({ path: "/about", fullPath: "/about", matched: [] }), true);
    assert.equal(guard({ path: "/w/app/projects", fullPath: "/w/app/projects", matched: [] }), "/auth/login");
    assert.deepEqual(evaluations, [{ policy: "authenticated", pathname: "/w/app/projects" }]);

    const openGuard = createShellBeforeEachGuard({ surfaceRuntime });
    assert.equal(openGuard({ path: "/", fullPath: "/", matched: [] }), true);
  } finally {
    globalThis[DEFAULT_GUARD_EVALUATOR_KEY] = previousEvaluator;
  }
});
