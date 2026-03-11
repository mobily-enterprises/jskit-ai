import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission, resolveWorkspace } from "./actionContributorHelpers.js";

test("hasPermission allows wildcard and direct matches", () => {
  assert.equal(hasPermission(["*"], "workspace.billing.manage"), true);
  assert.equal(hasPermission(["workspace.billing.manage"], "workspace.billing.manage"), true);
  assert.equal(hasPermission(["workspace.billing.read"], "workspace.billing.manage"), false);
});

test("hasPermission allows empty required permissions", () => {
  assert.equal(hasPermission([], ""), true);
  assert.equal(hasPermission([], null), true);
});

test("resolveWorkspace prefers action context workspace over request workspace", () => {
  const resolved = resolveWorkspace(
    {
      workspace: { id: 10, ownerUserId: 77 },
      requestMeta: { request: { workspace: { id: 10 } } }
    },
    {}
  );

  assert.deepEqual(resolved, { id: 10, ownerUserId: 77 });
});

test("resolveWorkspace prefers resolved workspace context over plain context/request workspace", () => {
  const resolved = resolveWorkspace(
    {
      workspace: { id: 10 },
      requestMeta: {
        request: { workspace: { id: 10 } },
        resolvedWorkspaceContext: {
          workspace: { id: 10, ownerUserId: 77, slug: "team-alpha" }
        }
      }
    },
    {}
  );

  assert.deepEqual(resolved, { id: 10, ownerUserId: 77, slug: "team-alpha" });
});
