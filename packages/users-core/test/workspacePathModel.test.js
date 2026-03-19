import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePathname,
  normalizeSurfaceSegmentFromRouteBase,
  parseWorkspacePathname,
  resolveDefaultWorkspaceSurfaceId,
  resolveWorkspaceSurfaceIdFromSuffixSegments
} from "../src/shared/support/workspacePathModel.js";

test("normalizePathname trims query/hash and trailing slashes", () => {
  assert.equal(normalizePathname("w/acme/admin/?a=1#x"), "/w/acme/admin");
  assert.equal(normalizePathname("///w//acme///"), "/w/acme");
});

test("normalizeSurfaceSegmentFromRouteBase resolves workspace-aware segment", () => {
  assert.equal(normalizeSurfaceSegmentFromRouteBase("/w/:workspaceSlug/admin"), "admin");
  assert.equal(normalizeSurfaceSegmentFromRouteBase("/w/:workspaceSlug"), "");
  assert.equal(normalizeSurfaceSegmentFromRouteBase("/"), "");
  assert.equal(normalizeSurfaceSegmentFromRouteBase(""), "");
});

test("parseWorkspacePathname reads workspace slug and suffix segments", () => {
  assert.deepEqual(parseWorkspacePathname("/w/acme/admin/contacts"), {
    workspaceSlug: "acme",
    suffixSegments: ["admin", "contacts"]
  });
  assert.equal(parseWorkspacePathname("/admin/settings"), null);
});

test("resolveDefaultWorkspaceSurfaceId keeps workspace default or first workspace fallback", () => {
  assert.equal(
    resolveDefaultWorkspaceSurfaceId({
      defaultSurfaceId: "app",
      workspaceSurfaceIds: ["admin", "app"],
      surfaceRequiresWorkspace: (surfaceId) => surfaceId === "app"
    }),
    "app"
  );

  assert.equal(
    resolveDefaultWorkspaceSurfaceId({
      defaultSurfaceId: "app",
      workspaceSurfaceIds: ["admin", "app"],
      surfaceRequiresWorkspace: (surfaceId) => surfaceId === "admin"
    }),
    "admin"
  );
});

test("resolveWorkspaceSurfaceIdFromSuffixSegments resolves prefixed workspace surfaces", () => {
  assert.equal(
    resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments: [],
      defaultWorkspaceSurfaceId: "app",
      workspaceSurfaces: [
        { id: "app", routeBase: "/w/:workspaceSlug" },
        { id: "admin", routeBase: "/w/:workspaceSlug/admin" }
      ]
    }),
    "app"
  );

  assert.equal(
    resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments: ["admin", "contacts"],
      defaultWorkspaceSurfaceId: "app",
      workspaceSurfaces: [
        { id: "app", routeBase: "/w/:workspaceSlug" },
        { id: "admin", routeBase: "/w/:workspaceSlug/admin" }
      ]
    }),
    "admin"
  );

  assert.equal(
    resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments: ["projects", "123"],
      defaultWorkspaceSurfaceId: "app",
      workspaceSurfaces: [
        { id: "app", routeBase: "/w/:workspaceSlug" },
        { id: "admin", routeBase: "/w/:workspaceSlug/admin" }
      ]
    }),
    "app"
  );
});
