import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMenuLinkPathname,
  resolveMenuLinkTarget
} from "../src/client/support/menuLinkTarget.js";

const WORKSPACE_PLACEMENT_CONTEXT = Object.freeze({
  surfaceConfig: {
    enabledSurfaceIds: ["admin"],
    surfacesById: {
      admin: {
        id: "admin",
        requiresWorkspace: true
      }
    }
  }
});

const MIXED_PLACEMENT_CONTEXT = Object.freeze({
  surfaceConfig: {
    enabledSurfaceIds: ["app", "admin"],
    surfacesById: {
      app: {
        id: "app",
        requiresWorkspace: false
      },
      admin: {
        id: "admin",
        requiresWorkspace: true
      }
    }
  }
});

function createPageResolver() {
  return function resolvePagePath(relativePath = "", options = {}) {
    return `page:${String(options.surface || "")}:${String(relativePath || "")}`;
  };
}

test("resolveMenuLinkTarget resolves suffix targets when no explicit to is provided", () => {
  assert.equal(
    resolveMenuLinkTarget({
      surface: "admin",
      placementContext: WORKSPACE_PLACEMENT_CONTEXT,
      workspaceSuffix: "/practice/vets",
      nonWorkspaceSuffix: "/practice/vets",
      resolvePagePath: createPageResolver()
    }),
    "page:admin:/practice/vets"
  );
});

test("resolveMenuLinkTarget resolves relative targets through suffix templates", () => {
  assert.equal(
    resolveMenuLinkTarget({
      to: "./notes",
      surface: "admin",
      placementContext: WORKSPACE_PLACEMENT_CONTEXT,
      workspaceSuffix: "/contacts/[contactId]/notes",
      nonWorkspaceSuffix: "/contacts/[contactId]/notes",
      routeParams: {
        contactId: 42
      },
      resolvePagePath: createPageResolver()
    }),
    "page:admin:/contacts/42/notes"
  );
});

test("resolveMenuLinkTarget returns empty string for unresolved relative targets", () => {
  assert.equal(
    resolveMenuLinkTarget({
      to: "./notes",
      surface: "admin",
      placementContext: WORKSPACE_PLACEMENT_CONTEXT,
      workspaceSuffix: "/contacts/[contactId]/notes",
      nonWorkspaceSuffix: "/contacts/[contactId]/notes",
      resolvePagePath: createPageResolver()
    }),
    ""
  );
});

test("resolveMenuLinkTarget keeps absolute targets unchanged", () => {
  assert.equal(
    resolveMenuLinkTarget({
      to: "/practice/vets",
      surface: "admin",
      placementContext: WORKSPACE_PLACEMENT_CONTEXT,
      workspaceSuffix: "/ignored",
      nonWorkspaceSuffix: "/ignored",
      resolvePagePath: createPageResolver()
    }),
    "/practice/vets"
  );
});

test("resolveMenuLinkTarget uses non-workspace suffix for non-workspace surfaces", () => {
  assert.equal(
    resolveMenuLinkTarget({
      surface: "app",
      currentSurfaceId: "admin",
      placementContext: MIXED_PLACEMENT_CONTEXT,
      workspaceSuffix: "/workspace-only",
      nonWorkspaceSuffix: "/public-page",
      resolvePagePath: createPageResolver()
    }),
    "page:app:/public-page"
  );
});

test("normalizeMenuLinkPathname removes query strings and hashes", () => {
  assert.equal(normalizeMenuLinkPathname("/practice/vets?tab=all#section"), "/practice/vets");
});
