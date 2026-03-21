import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSurfaceWorkspaceRequirement,
  resolveUsersApiBasePath
} from "../src/shared/support/usersApiPaths.js";

test("normalizeSurfaceWorkspaceRequirement only accepts explicit true", () => {
  assert.equal(normalizeSurfaceWorkspaceRequirement(true), true);
  assert.equal(normalizeSurfaceWorkspaceRequirement(false), false);
  assert.equal(normalizeSurfaceWorkspaceRequirement("true"), false);
  assert.equal(normalizeSurfaceWorkspaceRequirement(1), false);
});

test("resolveUsersApiBasePath resolves workspace and non-workspace API base paths", () => {
  assert.equal(
    resolveUsersApiBasePath({
      surfaceRequiresWorkspace: true,
      relativePath: "/customers"
    }),
    "/api/w/:workspaceSlug/workspace/customers"
  );

  assert.equal(
    resolveUsersApiBasePath({
      surfaceRequiresWorkspace: false,
      relativePath: "/customers"
    }),
    "/api/customers"
  );
});
