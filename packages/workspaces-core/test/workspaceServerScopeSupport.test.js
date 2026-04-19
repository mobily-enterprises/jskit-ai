import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceServerScopeSupport } from "../src/server/support/workspaceServerScopeSupport.js";
import { registerWorkspaceCore } from "../src/server/registerWorkspaceCore.js";

test("workspace server scope support exposes the canonical workspace helper surface", () => {
  const support = createWorkspaceServerScopeSupport();

  assert.equal(support.available, true);
  assert.equal(typeof support.paramsValidator?.normalize, "function");
  assert.deepEqual(support.buildInputFromRouteParams({ workspaceSlug: "  ACME  " }), {
    workspaceSlug: "acme"
  });
  assert.deepEqual(
    support.resolveWorkspace(
      {
        requestMeta: {
          resolvedWorkspaceContext: {
            workspace: {
              id: 7,
              slug: "acme"
            }
          }
        }
      },
      {}
    ),
    {
      id: 7,
      slug: "acme"
    }
  );
});

test("registerWorkspaceCore registers the workspace server scope support token", () => {
  const singletons = new Map();
  const app = {
    singleton(token, factory) {
      singletons.set(token, factory);
      return this;
    },
    tag() {
      return this;
    },
    has() {
      return false;
    }
  };

  registerWorkspaceCore(app);

  assert.equal(singletons.has("workspaces.server.scope-support"), true);
  const support = singletons.get("workspaces.server.scope-support")();
  assert.equal(support.available, true);
  assert.equal(typeof support.buildInputFromRouteParams, "function");
  assert.equal(typeof support.resolveWorkspace, "function");
});
