import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceBootstrapContributor } from "../src/server/workspaceBootstrapContributor.js";

function createAuthenticatedProfile(overrides = {}) {
  return {
    id: 7,
    authProvider: "local",
    authProviderUserId: "user-7",
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
    userProfilesRepository: {
      async findByIdentity() {
        return profile;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          theme: "system",
          locale: "en",
          timeZone: "UTC",
          dateFormat: "YYYY-MM-DD",
          numberFormat: "1,234.56",
          currencyCode: "USD",
          avatarSize: 64,
          productUpdates: true,
          accountActivity: true,
          securityAlerts: true
        };
      }
    },
    workspaceTenancyEnabled: true
  });

  await contributor.contribute({
    request: {
      async executeAction() {
        return {
          authenticated: true,
          profile
        };
      }
    },
    reply: {}
  });

  assert.equal(pendingServiceCalls.length, 1);
  assert.equal(pendingServiceCalls[0].user.id, profile.id);
  assert.equal(pendingServiceCalls[0].options?.context?.actor?.id, profile.id);
});

test("workspace bootstrap contributor seeds the initial console owner on authenticated bootstrap", async () => {
  const profile = createAuthenticatedProfile({ id: 12 });
  const consoleOwnerSeeds = [];

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
      async listPendingInvitesForUser() {
        return [];
      }
    },
    userProfilesRepository: {
      async findByIdentity() {
        return profile;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          theme: "system",
          locale: "en",
          timeZone: "UTC",
          dateFormat: "YYYY-MM-DD",
          numberFormat: "1,234.56",
          currencyCode: "USD",
          avatarSize: 64,
          productUpdates: true,
          accountActivity: true,
          securityAlerts: true
        };
      }
    },
    workspaceTenancyEnabled: false,
    consoleService: {
      async ensureInitialConsoleMember(userId) {
        consoleOwnerSeeds.push(Number(userId));
      }
    }
  });

  await contributor.contribute({
    request: {
      async executeAction() {
        return {
          authenticated: true,
          profile
        };
      }
    },
    reply: {}
  });

  assert.deepEqual(consoleOwnerSeeds, [12]);
});
