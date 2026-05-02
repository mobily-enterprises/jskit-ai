import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceActionContextContributor } from "../src/server/common/contributors/workspaceActionContextContributor.js";

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
            roleSid: "owner"
          },
          permissions: ["workspace.settings.update"]
        };
      }
    },
    workspaceSurfaceIds: ["admin", "app"]
  });

  const request = {
    user: {
      id: 42,
      email: "user@example.com"
    }
  };

  const contribution = await contributor.contribute({
    definition: {
      id: "workspace.settings.update",
      surfaces: ["admin", "app"]
    },
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
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: {
          id: 10,
          slug: "acme"
        },
        membership: {
          roleSid: "owner"
        },
        permissions: ["workspace.settings.update"]
      }
    },
    workspace: {
      id: 10,
      slug: "acme"
    },
    membership: {
      roleSid: "owner"
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
    actionId: "workspace.workspaces.list",
    input: {
      workspaceSlug: "acme"
    },
    context: {}
  });

  assert.deepEqual(contribution, {});
});

test("workspace action context contributor always resolves and stores resolved context", async () => {
  const calls = [];
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options) {
        calls.push({ user, workspaceSlug, options });
        return {
          workspace: {
            id: 10,
            slug: "acme",
            ownerUserId: 77
          },
          membership: {
            roleSid: "owner"
          },
          permissions: ["workspace.settings.update"]
        };
      }
    },
    workspaceSurfaceIds: ["admin", "app"]
  });

  const request = {
    user: {
      id: 42
    }
  };

  const contribution = await contributor.contribute({
    definition: {
      id: "workspace.members.list",
      surfaces: ["admin", "app"]
    },
    input: {
      workspaceSlug: "acme"
    },
    context: {
      workspace: {
        id: 1
      },
      requestMeta: {
        request
      }
    },
    request
  });

  assert.deepEqual(calls, [
    {
      user: request.user,
      workspaceSlug: "acme",
      options: {
        request
      }
    }
  ]);
  assert.deepEqual(contribution, {
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: {
          id: 10,
          slug: "acme",
          ownerUserId: 77
        },
        membership: {
          roleSid: "owner"
        },
        permissions: ["workspace.settings.update"]
      }
    },
    membership: {
      roleSid: "owner"
    },
    permissions: ["workspace.settings.update"]
  });
});

test("workspace action context contributor resolves context for workspace-visible routes without an explicit action list", async () => {
  const calls = [];
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options) {
        calls.push({ user, workspaceSlug, options });
        return {
          workspace: {
            id: 33,
            slug: "acme"
          },
          membership: {
            roleSid: "admin"
          },
          permissions: ["assistant.chat.use"]
        };
      }
    }
  });

  const request = {
    user: {
      id: 42
    },
    routeOptions: {
      config: {
        visibility: "workspace"
      }
    }
  };

  const contribution = await contributor.contribute({
    definition: {
      id: "assistant.conversations.list",
      surfaces: ["admin"]
    },
    input: {
      workspaceSlug: "acme"
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
      workspaceSlug: "acme",
      options: {
        request
      }
    }
  ]);
  assert.deepEqual(contribution, {
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: {
          id: 33,
          slug: "acme"
        },
        membership: {
          roleSid: "admin"
        },
        permissions: ["assistant.chat.use"]
      }
    },
    workspace: {
      id: 33,
      slug: "acme"
    },
    membership: {
      roleSid: "admin"
    },
    permissions: ["assistant.chat.use"]
  });
});

test("workspace action context contributor resolves context for workspace surfaces even when route visibility is public", async () => {
  const calls = [];
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options) {
        calls.push({ user, workspaceSlug, options });
        return {
          workspace: {
            id: 77,
            slug: "acme"
          },
          membership: {
            roleSid: "member"
          },
          permissions: ["crud.breeds.list"]
        };
      }
    },
    workspaceSurfaceIds: ["admin", "app"]
  });

  const request = {
    user: {
      id: 42
    },
    routeOptions: {
      config: {
        surface: "admin",
        visibility: "public"
      }
    }
  };

  const contribution = await contributor.contribute({
    definition: {
      id: "crud.breeds.list",
      surfaces: ["admin"]
    },
    input: {
      workspaceSlug: "acme"
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
      workspaceSlug: "acme",
      options: {
        request
      }
    }
  ]);
  assert.deepEqual(contribution, {
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: {
          id: 77,
          slug: "acme"
        },
        membership: {
          roleSid: "member"
        },
        permissions: ["crud.breeds.list"]
      }
    },
    workspace: {
      id: 77,
      slug: "acme"
    },
    membership: {
      roleSid: "member"
    },
    permissions: ["crud.breeds.list"]
  });
});
