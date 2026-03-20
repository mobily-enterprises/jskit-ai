import assert from "node:assert/strict";
import test from "node:test";
import {
  hasWorkspaceMembership,
  resolvePrimarySurfaceSwitchLink,
  resolveProfileSurfaceMenuLinks
} from "../src/client/lib/profileSurfaceMenuLinks.js";

function createPlacementContext({
  workspace = null,
  workspaces = [],
  authenticated = true,
  consoleOwner = false
} = {}) {
  return {
    auth: {
      authenticated
    },
    workspace,
    workspaces,
    permissions: [],
    surfaceAccess: {
      consoleowner: consoleOwner
    },
    surfaceAccessPolicies: {
      public: {},
      workspace_member: {
        requireAuth: true,
        requireWorkspaceMembership: true
      },
      console_owner: {
        requireAuth: true,
        requireFlagsAll: ["console_owner"]
      }
    },
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
          requiresAuth: false,
          requiresWorkspace: false,
          accessPolicyId: "public"
        },
        app: {
          id: "app",
          enabled: true,
          pagesRoot: "w/[workspaceSlug]",
          routeBase: "/w/:workspaceSlug",
          requiresAuth: true,
          requiresWorkspace: true,
          accessPolicyId: "workspace_member"
        },
        admin: {
          id: "admin",
          enabled: true,
          pagesRoot: "w/[workspaceSlug]/admin",
          routeBase: "/w/:workspaceSlug/admin",
          requiresAuth: true,
          requiresWorkspace: true,
          accessPolicyId: "workspace_member"
        },
        console: {
          id: "console",
          enabled: true,
          pagesRoot: "console",
          routeBase: "/console",
          requiresAuth: true,
          requiresWorkspace: false,
          accessPolicyId: "console_owner"
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
    id: "surface-switch.admin",
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

test("resolveProfileSurfaceMenuLinks includes console switch only for console owners", () => {
  const nonOwnerContext = createPlacementContext({
    workspace: {
      id: 1,
      slug: "acme"
    },
    workspaces: [
      {
        id: 1,
        slug: "acme"
      }
    ],
    consoleOwner: false
  });
  const ownerContext = createPlacementContext({
    workspace: {
      id: 1,
      slug: "acme"
    },
    workspaces: [
      {
        id: 1,
        slug: "acme"
      }
    ],
    consoleOwner: true
  });

  const nonOwnerLinks = resolveProfileSurfaceMenuLinks({
    context: nonOwnerContext,
    surface: "app"
  });
  const ownerLinks = resolveProfileSurfaceMenuLinks({
    context: ownerContext,
    surface: "app"
  });

  assert.equal(nonOwnerLinks.some((entry) => entry.id === "surface-switch.console"), false);
  assert.equal(ownerLinks.some((entry) => entry.id === "surface-switch.console"), true);
});
