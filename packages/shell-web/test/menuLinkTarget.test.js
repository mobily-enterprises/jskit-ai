import assert from "node:assert/strict";
import test from "node:test";
import { resolveMenuLinkTarget } from "../src/client/support/menuLinkTarget.js";

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
