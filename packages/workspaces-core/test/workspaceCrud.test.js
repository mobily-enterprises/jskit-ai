import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_CRUD_SCOPE } from "../src/server/support/workspaceCrud.js";
import { WORKSPACE_ROUTE_BASE_PATH, resolveWorkspaceRoutePath } from "../src/server/support/workspaceRoutePaths.js";
import { routeParamsValidator, workspaceSlugParamsValidator } from "../src/server/common/validators/routeParamsValidator.js";

test("the workspace CRUD scope routes under the workspace slug and reads it from the route", () => {
  assert.ok(Object.isFrozen(WORKSPACE_CRUD_SCOPE));
  assert.ok(Object.isFrozen(WORKSPACE_CRUD_SCOPE.inputKeys));
  assert.equal(WORKSPACE_CRUD_SCOPE.routeBase, "/w/:workspaceSlug");
  assert.equal(WORKSPACE_CRUD_SCOPE.actionInputValidator, workspaceSlugParamsValidator);
  assert.equal(WORKSPACE_CRUD_SCOPE.routeParamsValidator, routeParamsValidator);
  assert.deepEqual(WORKSPACE_CRUD_SCOPE.inputKeys, ["workspaceSlug"]);
  assert.deepEqual(WORKSPACE_CRUD_SCOPE.input({ input: { params: { workspaceSlug: " Acme " } } }), { workspaceSlug: "acme" });
  assert.deepEqual(WORKSPACE_CRUD_SCOPE.input({ input: { params: {} } }), {});
});

test("workspace route paths live under /api/w/:workspaceSlug", () => {
  assert.equal(WORKSPACE_ROUTE_BASE_PATH, "/api/w/:workspaceSlug");
  assert.equal(resolveWorkspaceRoutePath("rewarded"), "/api/w/:workspaceSlug/rewarded");
  assert.equal(resolveWorkspaceRoutePath("/members/"), "/api/w/:workspaceSlug/members");
  assert.equal(resolveWorkspaceRoutePath(), "/api/w/:workspaceSlug");
});
