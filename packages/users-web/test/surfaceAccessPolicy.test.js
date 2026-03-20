import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSurfaceAccess } from "../src/client/lib/surfaceAccessPolicy.js";

function createContext(overrides = {}) {
  return {
    auth: {
      authenticated: true
    },
    workspaces: [
      {
        id: 1,
        slug: "acme"
      }
    ],
    permissions: [],
    surfaceAccess: {
      consoleowner: false
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
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "app", "console"],
      surfacesById: {
        home: {
          id: "home",
          enabled: true,
          routeBase: "/home",
          requiresWorkspace: false,
          accessPolicyId: "public"
        },
        app: {
          id: "app",
          enabled: true,
          routeBase: "/w/:workspaceSlug",
          requiresWorkspace: true,
          accessPolicyId: "workspace_member"
        },
        console: {
          id: "console",
          enabled: true,
          routeBase: "/console",
          requiresWorkspace: false,
          accessPolicyId: "console_owner"
        }
      }
    },
    ...overrides
  };
}

test("evaluateSurfaceAccess allows workspace member surfaces for accessible workspace", () => {
  const decision = evaluateSurfaceAccess({
    context: createContext(),
    surfaceId: "app",
    workspaceSlug: "acme"
  });

  assert.equal(decision.allowed, true);
});

test("evaluateSurfaceAccess denies workspace member surfaces for inaccessible workspace", () => {
  const decision = evaluateSurfaceAccess({
    context: createContext(),
    surfaceId: "app",
    workspaceSlug: "missing"
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "surface-access-workspace-membership-required");
});

test("evaluateSurfaceAccess allows unknown workspace membership when allowOnUnknown=true", () => {
  const context = createContext();
  delete context.workspaces;

  const decision = evaluateSurfaceAccess({
    context,
    surfaceId: "app",
    workspaceSlug: "acme",
    allowOnUnknown: true
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.pending, true);
});

test("evaluateSurfaceAccess enforces bootstrap surface access flags", () => {
  const deniedDecision = evaluateSurfaceAccess({
    context: createContext(),
    surfaceId: "console"
  });
  assert.equal(deniedDecision.allowed, false);

  const allowedDecision = evaluateSurfaceAccess({
    context: createContext({
      surfaceAccess: {
        consoleowner: true
      }
    }),
    surfaceId: "console"
  });
  assert.equal(allowedDecision.allowed, true);
});

test("evaluateSurfaceAccess denies workspace route with not_found status", () => {
  const decision = evaluateSurfaceAccess({
    context: createContext({
      workspaceBootstrapStatuses: {
        acme: "not_found"
      }
    }),
    surfaceId: "app",
    workspaceSlug: "acme"
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "surface-access-workspace-not-found");
});
