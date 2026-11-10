import assert from "node:assert/strict";
import test from "node:test";
import { reactive } from "vue";
import { routeLocationKey } from "vue-router";
import { useShellNavigationLink } from "../src/client/composables/useShellNavigationLink.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../src/client/placement/inject.js";
import { resolveMenuLinkTarget } from "../src/client/support/menuLinkTarget.js";
import { mountComposable } from "./support/mountComposable.js";

function createPlacementContext() {
  return {
    surfaceConfig: {
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "app"],
      surfacesById: {
        home: {
          id: "home",
          pagesRoot: "home",
          routeBase: "/home",
          enabled: true,
          requiresWorkspace: false
        },
        app: {
          id: "app",
          pagesRoot: "w/[workspaceSlug]",
          routeBase: "/w/:workspaceSlug",
          enabled: true,
          requiresWorkspace: true
        }
      }
    }
  };
}

test("menu link target returns an explicit absolute target without resolving the target surface", () => {
  assert.equal(
    resolveMenuLinkTarget({
      to: "/w/acme/x",
      surface: "app",
      currentSurfaceId: "home",
      placementContext: createPlacementContext(),
      routeParams: {}
    }),
    "/w/acme/x"
  );
});

test("menu link target resolves suffixes for missing and relative targets", () => {
  const placementContext = createPlacementContext();
  assert.equal(
    resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "home",
      placementContext,
      scopedSuffix: "/projects",
      routeParams: { workspaceSlug: "acme" }
    }),
    "/w/acme/projects"
  );
  assert.equal(
    resolveMenuLinkTarget({
      to: "./settings",
      currentSurfaceId: "home",
      placementContext,
      unscopedSuffix: "/settings"
    }),
    "/home/settings"
  );
});

test("menu link target still requires surface params when it must build the path", () => {
  assert.throws(
    () => resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "home",
      placementContext: createPlacementContext(),
      scopedSuffix: "/projects",
      routeParams: {}
    }),
    /Missing required surface route params/
  );
});

test("menu link target reads the current surface's params from the pathname when the route declares none", () => {
  const placementContext = createPlacementContext();
  // The not-found route catches any path, so its only param is the path itself.
  assert.equal(
    resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "app",
      currentPathname: "/w/acme/no-such-page",
      placementContext,
      scopedSuffix: "/projects",
      routeParams: { pathMatch: ["w", "acme", "no-such-page"] }
    }),
    "/w/acme/projects"
  );
  assert.equal(
    resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "app",
      currentPathname: "/w/caf%C3%A9%20bar/no-such-page",
      placementContext,
      scopedSuffix: "/projects",
      routeParams: {}
    }),
    "/w/caf%C3%A9%20bar/projects"
  );
  // The route's own params still win.
  assert.equal(
    resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "app",
      currentPathname: "/w/acme/projects",
      placementContext,
      scopedSuffix: "/projects",
      routeParams: { workspaceSlug: "beta" }
    }),
    "/w/beta/projects"
  );
  // A pathname on another surface names no params of this one.
  assert.throws(
    () => resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "home",
      currentPathname: "/home/no-such-page",
      placementContext,
      scopedSuffix: "/projects",
      routeParams: {}
    }),
    /Missing required surface route params for "app": workspaceSlug/
  );
});

test("a shell menu link on the not-found route of a workspace surface links into that workspace", () => {
  const route = reactive({
    path: "/w/acme/no-such-page",
    params: { pathMatch: ["w", "acme", "no-such-page"] }
  });
  const placementRuntime = {
    getContext: () => createPlacementContext(),
    getRevision: () => 1,
    subscribe: () => () => {}
  };
  const { app, result } = mountComposable(
    () => useShellNavigationLink({ label: "Projects", surface: "app", scopedSuffix: "/projects", unscopedSuffix: "/projects" }),
    {
      provide: [
        [routeLocationKey, route],
        [SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime]
      ]
    }
  );

  assert.equal(result.resolvedTarget.value.href, "/w/acme/projects");
  app.unmount();
});
