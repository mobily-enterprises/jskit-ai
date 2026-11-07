import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceScopeValue } from "../src/server/resourceHost.js";

test("resolveWorkspaceScopeValue reads one workspace id from any of its sources", () => {
  const all = {
    workspace: { id: "1" },
    requestMeta: {
      resolvedWorkspaceContext: { workspace: { id: "1" } },
      request: { workspace: { id: 1 } }
    },
    visibilityContext: { scopeOwnerId: "1" },
    scopeValues: { workspaceId: 1 }
  };
  assert.equal(resolveWorkspaceScopeValue(all), "1");
  assert.equal(resolveWorkspaceScopeValue({ workspace: { id: "2" } }), "2");
  assert.equal(resolveWorkspaceScopeValue({ requestMeta: { resolvedWorkspaceContext: { workspace: { id: "3" } } } }), "3");
  assert.equal(resolveWorkspaceScopeValue({ requestMeta: { request: { workspace: { id: "4" } } } }), "4");
  assert.equal(resolveWorkspaceScopeValue({ scopeValues: { workspaceId: 5 } }), "5");
  assert.equal(resolveWorkspaceScopeValue({ visibilityContext: { visibility: "workspace_user", scopeKind: "workspace_user", scopeOwnerId: "6" } }), "6");
  assert.equal(resolveWorkspaceScopeValue({ visibilityContext: { visibility: "workspace", scopeOwnerId: "7" } }), "7");
  assert.equal(resolveWorkspaceScopeValue({}), null);
  assert.equal(resolveWorkspaceScopeValue(), null);
});

test("resolveWorkspaceScopeValue ignores the owner of a visibility scope that is not a workspace's", () => {
  const scopeValues = { workspaceId: "4" };
  assert.equal(resolveWorkspaceScopeValue({ visibilityContext: { visibility: "user", scopeOwnerId: "9" }, scopeValues }), "4");
  assert.equal(resolveWorkspaceScopeValue({ visibilityContext: { visibility: "public", scopeOwnerId: "9" } }), null);
  assert.equal(resolveWorkspaceScopeValue({ visibilityContext: { visibility: "workspace", scopeKind: "team", scopeOwnerId: "9" } }), null);
  assert.equal(resolveWorkspaceScopeValue({ visibilityContext: null, scopeValues }), "4");
});

test("resolveWorkspaceScopeValue refuses a context that names two workspaces", () => {
  assert.throws(
    () => resolveWorkspaceScopeValue({
      workspace: { id: "1" },
      requestMeta: { resolvedWorkspaceContext: { workspace: { id: "2" } } }
    }),
    { message: "safety invariant: a context names two workspaces (1, 2); one execution acts on one workspace." }
  );
  assert.throws(
    () => resolveWorkspaceScopeValue({
      visibilityContext: { visibility: "workspace", scopeOwnerId: "3" },
      scopeValues: { workspaceId: "4" }
    }),
    { message: "safety invariant: a context names two workspaces (3, 4); one execution acts on one workspace." }
  );
});
