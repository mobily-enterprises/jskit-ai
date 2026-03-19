import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceAuthPolicyContextResolver } from "../src/server/common/contributors/workspaceAuthPolicyContextResolver.js";

test("workspace auth policy context resolver returns empty context when policy does not require workspace context", async () => {
  const resolver = createWorkspaceAuthPolicyContextResolver({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        throw new Error("must not be called");
      }
    }
  });

  const resolved = await resolver({
    request: {
      params: {
        workspaceSlug: "acme"
      }
    },
    actor: {
      id: 7
    },
    meta: {
      contextPolicy: "none",
      permission: ""
    }
  });

  assert.deepEqual(resolved, {});
});

test("workspace auth policy context resolver resolves workspace context from users workspace service", async () => {
  const calls = [];
  const resolver = createWorkspaceAuthPolicyContextResolver({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(actor, workspaceSlug, options) {
        calls.push({
          actor,
          workspaceSlug,
          options
        });
        return {
          workspace: {
            id: 11,
            slug: workspaceSlug
          },
          membership: {
            roleId: "owner"
          },
          permissions: ["projects.read"]
        };
      }
    }
  });

  const request = {
    params: {
      workspaceSlug: "ACME"
    }
  };
  const actor = {
    id: 7
  };

  const resolved = await resolver({
    request,
    actor,
    meta: {
      contextPolicy: "required"
    }
  });

  assert.deepEqual(calls, [
    {
      actor,
      workspaceSlug: "acme",
      options: {
        request
      }
    }
  ]);
  assert.deepEqual(resolved, {
    workspace: {
      id: 11,
      slug: "acme"
    },
    membership: {
      roleId: "owner"
    },
    permissions: ["projects.read"]
  });
});

test("workspace auth policy context resolver skips workspace lookup when workspace slug is absent", async () => {
  let called = false;
  const resolver = createWorkspaceAuthPolicyContextResolver({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        called = true;
        return {};
      }
    }
  });

  const resolved = await resolver({
    request: {
      params: {}
    },
    actor: {
      id: 7
    },
    meta: {
      contextPolicy: "required"
    }
  });

  assert.equal(called, false);
  assert.deepEqual(resolved, {});
});
