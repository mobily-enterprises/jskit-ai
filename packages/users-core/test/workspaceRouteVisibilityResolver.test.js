import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceRouteVisibilityResolver } from "../src/server/common/contributors/workspaceRouteVisibilityResolver.js";

test("workspace route visibility resolver contributes workspace_user scope and actor ownership", async () => {
  const resolver = createWorkspaceRouteVisibilityResolver({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        throw new Error("should not be called");
      }
    }
  });

  const contribution = await resolver.resolve({
    visibility: "workspace_user",
    context: {
      actor: {
        id: "user_42"
      },
      workspace: {
        id: 11
      }
    }
  });

  assert.deepEqual(contribution, {
    scopeKind: "workspace_user",
    requiresActorScope: true,
    scopeOwnerId: 11,
    userId: "user_42"
  });
});

test("workspace route visibility resolver keeps workspace-only visibility actor-agnostic", async () => {
  const resolver = createWorkspaceRouteVisibilityResolver({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        throw new Error("should not be called");
      }
    }
  });

  const contribution = await resolver.resolve({
    visibility: "workspace",
    context: {
      workspace: {
        id: 11
      }
    }
  });

  assert.deepEqual(contribution, {
    scopeKind: "workspace",
    requiresActorScope: false,
    scopeOwnerId: 11
  });
});

test("workspace route visibility resolver still marks workspace_user as actor-scoped when workspace is unresolved", async () => {
  const resolver = createWorkspaceRouteVisibilityResolver({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        return {};
      }
    }
  });

  const contribution = await resolver.resolve({
    visibility: "workspace_user",
    context: {
      actor: {
        id: "user_99"
      }
    },
    input: {}
  });

  assert.deepEqual(contribution, {
    scopeKind: "workspace_user",
    requiresActorScope: true,
    userId: "user_99"
  });
});
