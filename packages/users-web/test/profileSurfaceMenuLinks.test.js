import assert from "node:assert/strict";
import test from "node:test";
import {
  hasWorkspaceMembership,
  resolvePrimarySurfaceSwitchLink
} from "../src/client/lib/profileSurfaceMenuLinks.js";

function createPlacementContext({
  workspace = null,
  workspaces = [],
  authenticated = true
} = {}) {
  return {
    auth: {
      authenticated
    },
    workspace,
    workspaces,
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["home", "app", "admin", "console"],
      surfacesById: {
        home: {
          id: "home",
          enabled: true,
          pagesRoot: "",
          routeBase: "/",
          requiresWorkspace: false
        },
        app: {
          id: "app",
          enabled: true,
          pagesRoot: "w/[workspaceSlug]",
          routeBase: "/w/:workspaceSlug",
          requiresWorkspace: true
        },
        admin: {
          id: "admin",
          enabled: true,
          pagesRoot: "w/[workspaceSlug]/admin",
          routeBase: "/w/:workspaceSlug/admin",
          requiresWorkspace: true
        },
        console: {
          id: "console",
          enabled: true,
          pagesRoot: "console",
          routeBase: "/console",
          requiresWorkspace: false
        }
      }
    }
  };
}

const originalWindow = globalThis.window;

test.afterEach(() => {
  if (typeof originalWindow === "undefined") {
    delete globalThis.window;
    return;
  }
  globalThis.window = originalWindow;
});

test("hasWorkspaceMembership matches context.workspace slug", () => {
  const context = createPlacementContext({
    workspace: {
      id: 1,
      slug: "acme"
    },
    workspaces: []
  });

  assert.equal(hasWorkspaceMembership(context, "acme"), true);
});

test("hasWorkspaceMembership matches context.workspaces slug", () => {
  const context = createPlacementContext({
    workspace: null,
    workspaces: [
      {
        id: 1,
        slug: "acme"
      }
    ]
  });

  assert.equal(hasWorkspaceMembership(context, "acme"), true);
});

test("resolvePrimarySurfaceSwitchLink shows Go to admin only for member workspace", () => {
  const context = createPlacementContext({
    workspace: {
      id: 1,
      slug: "acme"
    },
    workspaces: [
      {
        id: 1,
        slug: "acme"
      }
    ]
  });

  const link = resolvePrimarySurfaceSwitchLink({
    context,
    surface: "app"
  });

  assert.deepEqual(link, {
    id: "surface-switch.primary",
    label: "Go to admin",
    to: "/w/acme/admin"
  });
});

test("resolvePrimarySurfaceSwitchLink hides workspace switch when slug is only in URL and user is not member", () => {
  globalThis.window = {
    location: {
      pathname: "/w/acme/admin",
      search: "",
      hash: ""
    }
  };

  const context = createPlacementContext({
    workspace: null,
    workspaces: []
  });

  const link = resolvePrimarySurfaceSwitchLink({
    context,
    surface: "admin"
  });

  assert.equal(link, null);
});
