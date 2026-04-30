import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_POLICY_CONTEXT_RESOLVER_TAG } from "@jskit-ai/auth-core/server/authPolicyContextResolverRegistry";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { createWorkspaceServerScopeSupport } from "../src/server/support/workspaceServerScopeSupport.js";
import { registerWorkspaceCore } from "../src/server/registerWorkspaceCore.js";

test("workspace server scope support exposes the canonical workspace helper surface", async () => {
  const support = createWorkspaceServerScopeSupport();

  assert.equal(support.available, true);
  assert.equal(typeof support.params?.schema, "object");
  assert.equal(support.params?.mode, "patch");
  assert.deepEqual(
    await validateSchemaPayload(support.params, { workspaceSlug: "  ACME  " }, {
      phase: "input",
      context: "workspaceServerScopeSupport.params"
    }),
    {
      workspaceSlug: "acme"
    }
  );
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
  const tags = new Map();
  const app = {
    singleton(token, factory) {
      singletons.set(token, factory);
      return this;
    },
    tag(token, tagName) {
      const key = String(tagName || "");
      const list = tags.get(key) || [];
      list.push(String(token || ""));
      tags.set(key, list);
      return this;
    },
    has() {
      return false;
    }
  };

  registerWorkspaceCore(app);

  assert.equal(singletons.has("workspaces.server.scope-support"), true);
  assert.deepEqual(tags.get(AUTH_POLICY_CONTEXT_RESOLVER_TAG), ["workspaces.core.authPolicyContextResolver"]);
  const support = singletons.get("workspaces.server.scope-support")();
  assert.equal(support.available, true);
  assert.equal(typeof support.buildInputFromRouteParams, "function");
  assert.equal(typeof support.resolveWorkspace, "function");
});
