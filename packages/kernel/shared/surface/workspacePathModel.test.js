import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePathname,
  normalizeSurfaceSegmentFromPrefix,
  parseWorkspacePathname,
  resolveDefaultWorkspaceSurfaceId,
  resolveWorkspaceSurfaceIdFromSuffixSegments
} from "./workspacePathModel.js";

test("normalizePathname trims query/hash and trailing slashes", () => {
  assert.equal(normalizePathname("w/acme/admin/?a=1#x"), "/w/acme/admin");
  assert.equal(normalizePathname("///w//acme///"), "/w/acme");
});

test("normalizeSurfaceSegmentFromPrefix strips leading slash and handles root", () => {
  assert.equal(normalizeSurfaceSegmentFromPrefix("/admin/"), "admin");
  assert.equal(normalizeSurfaceSegmentFromPrefix("/"), "");
  assert.equal(normalizeSurfaceSegmentFromPrefix(""), "");
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
      workspaceSurfaces: [{ id: "app", prefix: "/app" }, { id: "admin", prefix: "/admin" }]
    }),
    "app"
  );

  assert.equal(
    resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments: ["admin", "contacts"],
      defaultWorkspaceSurfaceId: "app",
      workspaceSurfaces: [{ id: "app", prefix: "/app" }, { id: "admin", prefix: "/admin" }]
    }),
    "admin"
  );

  assert.equal(
    resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments: ["projects", "123"],
      defaultWorkspaceSurfaceId: "app",
      workspaceSurfaces: [{ id: "app", prefix: "/app" }, { id: "admin", prefix: "/admin" }]
    }),
    "app"
  );
});
