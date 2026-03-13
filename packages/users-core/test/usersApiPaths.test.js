import test from "node:test";
import assert from "node:assert/strict";
import {
  isWorkspaceVisibility,
  resolveUsersApiBasePath
} from "../src/shared/support/usersApiPaths.js";

test("isWorkspaceVisibility returns true only for workspace-scoped visibilities", () => {
  assert.equal(isWorkspaceVisibility("workspace"), true);
  assert.equal(isWorkspaceVisibility("workspace_user"), true);
  assert.equal(isWorkspaceVisibility("public"), false);
  assert.equal(isWorkspaceVisibility("user"), false);
});

test("resolveUsersApiBasePath resolves workspace and non-workspace API base paths", () => {
  assert.equal(
    resolveUsersApiBasePath({
      visibility: "workspace",
      relativePath: "/customers"
    }),
    "/api/w/:workspaceSlug/workspace/customers"
  );

  assert.equal(
    resolveUsersApiBasePath({
      visibility: "public",
      relativePath: "/customers"
    }),
    "/api/customers"
  );
});
