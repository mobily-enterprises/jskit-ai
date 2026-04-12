import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceBootstrapContributor } from "../src/server/workspaceBootstrapContributor.js";

function createAuthenticatedProfile(overrides = {}) {
  return {
    id: "7",
    authProvider: "local",
    authProviderUserSid: "user-7",
    username: "tester",
    displayName: "Test User",
    email: "test@example.com",
    ...overrides
  };
}

test("workspace bootstrap contributor passes actor context to pending invites service", async () => {
  const profile = createAuthenticatedProfile();
  const pendingServiceCalls = [];
  const contributor = createWorkspaceBootstrapContributor({
    workspaceService: {
      async listWorkspacesForUser() {
        return [];
      },
      async resolveWorkspaceContextForUserBySlug() {
        return null;
      }
    },
    workspacePendingInvitationsService: {
      async listPendingInvitesForUser(user, options = {}) {
        pendingServiceCalls.push({
          user,
          options
        });
        return [];
      }
    },
    usersRepository: {
      async findById() {
        return profile;
      }
    },
    workspaceInvitationsEnabled: true,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  await contributor.contribute({
    payload: {
      session: {
        authenticated: true,
        userId: profile.id
      }
    }
  });

  assert.equal(pendingServiceCalls.length, 1);
  assert.equal(pendingServiceCalls[0].user.id, profile.id);
  assert.equal(pendingServiceCalls[0].options?.context?.actor?.id, profile.id);
});

test("workspace bootstrap contributor resolves workspace slug from bootstrap query", async () => {
  const profile = createAuthenticatedProfile();
  const calls = [];
  const contributor = createWorkspaceBootstrapContributor({
    workspaceService: {
      async listWorkspacesForUser() {
        return [];
      },
      async resolveWorkspaceContextForUserBySlug(_user, workspaceSlug) {
        calls.push(workspaceSlug);
        return null;
      }
    },
    workspacePendingInvitationsService: {
      async listPendingInvitesForUser() {
        return [];
      }
    },
    usersRepository: {
      async findById() {
        return profile;
      }
    },
    workspaceInvitationsEnabled: true,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  const payload = await contributor.contribute({
    query: {
      workspaceSlug: "  AcMe  "
    },
    payload: {
      session: {
        authenticated: true,
        userId: profile.id
      }
    }
  });

  assert.deepEqual(calls, ["acme"]);
  assert.deepEqual(payload.requestedWorkspace, {
    slug: "acme",
    status: "resolved"
  });
});

test("workspace bootstrap contributor reports unauthenticated requested workspace without generic bootstrap work", async () => {
  const contributor = createWorkspaceBootstrapContributor({
    workspaceService: {
      async listWorkspacesForUser() {
        assert.fail("listWorkspacesForUser should not run for unauthenticated payloads");
      },
      async resolveWorkspaceContextForUserBySlug() {
        assert.fail("resolveWorkspaceContextForUserBySlug should not run for unauthenticated payloads");
      }
    },
    workspacePendingInvitationsService: {
      async listPendingInvitesForUser() {
        assert.fail("listPendingInvitesForUser should not run for unauthenticated payloads");
      }
    },
    usersRepository: {
      async findById() {
        assert.fail("findById should not run for unauthenticated payloads");
      }
    },
    workspaceInvitationsEnabled: true,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  const payload = await contributor.contribute({
    query: {
      workspaceSlug: "AcMe"
    },
    payload: {
      session: {
        authenticated: false
      }
    }
  });

  assert.deepEqual(payload, {
    requestedWorkspace: {
      slug: "acme",
      status: "unauthenticated"
    }
  });
});
