import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceActionContextContributor } from "../src/server/actions/workspaceActionContextContributor.js";

test("workspace action context contributor resolves workspace context for workspace actions", async () => {
  const calls = [];
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options) {
        calls.push({
          user,
          workspaceSlug,
          options
        });

        return {
          workspace: {
            id: 10,
            slug: "acme"
          },
          membership: {
            roleId: "owner"
          },
          permissions: ["workspace.settings.update"]
        };
      }
    }
  });

  const request = {
    user: {
      id: 42,
      email: "user@example.com"
    }
  };

  const contribution = await contributor.contribute({
    actionId: "workspace.settings.update",
    input: {
      workspaceSlug: "Acme"
    },
    context: {
      requestMeta: {
        request
      }
    },
    request
  });

  assert.deepEqual(calls, [
    {
      user: request.user,
      workspaceSlug: "Acme",
      options: {
        request
      }
    }
  ]);
  assert.deepEqual(contribution, {
    workspace: {
      id: 10,
      slug: "acme"
    },
    membership: {
      roleId: "owner"
    },
    permissions: ["workspace.settings.update"]
  });
});

test("workspace action context contributor ignores actions that do not require workspace context", async () => {
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        throw new Error("should not be called");
      }
    }
  });

  const contribution = await contributor.contribute({
    actionId: "workspace.bootstrap.read",
    input: {
      workspaceSlug: "acme"
    },
    context: {}
  });

  assert.deepEqual(contribution, {});
});

test("workspace action context contributor does not re-resolve when workspace is already present", async () => {
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        throw new Error("should not be called");
      }
    }
  });

  const contribution = await contributor.contribute({
    actionId: "workspace.members.list",
    input: {
      workspaceSlug: "acme"
    },
    context: {
      workspace: {
        id: 1
      }
    }
  });

  assert.deepEqual(contribution, {});
});
