import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_CRUD_SCOPE, workspaceIdFromContext } from "../src/server/support/workspaceCrud.js";
import { WORKSPACE_ROUTE_BASE_PATH, resolveWorkspaceRoutePath } from "../src/server/common/support/workspaceRoutePaths.js";
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

test("workspaceIdFromContext reads the context's workspace, then the resolved one, the scope owner and the scope value", () => {
  const all = {
    workspace: { id: "1" },
    requestMeta: { resolvedWorkspaceContext: { workspace: { id: "2" } } },
    visibilityContext: { scopeOwnerId: "3" },
    scopeValues: { workspaceId: "4" }
  };
  assert.equal(workspaceIdFromContext(all), "1");
  assert.equal(workspaceIdFromContext({ ...all, workspace: null }), "2");
  assert.equal(workspaceIdFromContext({ visibilityContext: all.visibilityContext, scopeValues: all.scopeValues }), "3");
  assert.equal(workspaceIdFromContext({ scopeValues: { workspaceId: 4 } }), "4");
  assert.equal(workspaceIdFromContext({ visibilityContext: { visibility: "workspace_user", scopeKind: "workspace_user", scopeOwnerId: "5" } }), "5");
  assert.equal(workspaceIdFromContext({ visibilityContext: { visibility: "workspace", scopeOwnerId: "6" } }), "6");
  assert.equal(workspaceIdFromContext({}), null);
  assert.equal(workspaceIdFromContext(), null);
});

test("workspaceIdFromContext ignores the owner of a visibility scope that is not a workspace's", () => {
  const scopeValues = { workspaceId: "4" };
  assert.equal(workspaceIdFromContext({ visibilityContext: { visibility: "user", scopeOwnerId: "9" }, scopeValues }), "4");
  assert.equal(workspaceIdFromContext({ visibilityContext: { visibility: "public", scopeOwnerId: "9" } }), null);
  assert.equal(workspaceIdFromContext({ visibilityContext: { visibility: "workspace", scopeKind: "team", scopeOwnerId: "9" } }), null);
  assert.equal(workspaceIdFromContext({ visibilityContext: null, scopeValues }), "4");
});

test("workspace route paths live under /api/w/:workspaceSlug", () => {
  assert.equal(WORKSPACE_ROUTE_BASE_PATH, "/api/w/:workspaceSlug");
  assert.equal(resolveWorkspaceRoutePath("rewarded"), "/api/w/:workspaceSlug/rewarded");
  assert.equal(resolveWorkspaceRoutePath("/members/"), "/api/w/:workspaceSlug/members");
  assert.equal(resolveWorkspaceRoutePath(), "/api/w/:workspaceSlug");
});
