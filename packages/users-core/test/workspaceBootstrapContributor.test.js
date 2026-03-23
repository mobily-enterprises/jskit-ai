import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceBootstrapContributor } from "../src/server/workspaceBootstrapContributor.js";
import {
  TENANCY_MODE_PERSONAL,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME
} from "../src/shared/tenancyProfile.js";

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
    workspaceInvitationsEnabled: true,
    appConfig: {
      tenancyMode: "workspaces"
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
    workspaceInvitationsEnabled: false,
    consoleService: {
      async ensureInitialConsoleMember(userId) {
        consoleOwnerSeeds.push(Number(userId));
        return Number(userId);
      }
    }
  });

  const payload = await contributor.contribute({
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
  assert.equal(payload.surfaceAccess?.consoleowner, true);
});

test("workspace bootstrap contributor emits canonical tenancy profile from users-core", async () => {
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
        return null;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return {};
      }
    },
    workspaceInvitationsEnabled: false,
    tenancyProfile: {
      mode: TENANCY_MODE_PERSONAL,
      workspace: {
        enabled: true,
        autoProvision: true,
        allowSelfCreate: false,
        slugPolicy: WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME
      }
    },
    appConfig: {
      tenancyMode: "none"
    }
  });

  const payload = await contributor.contribute({
    request: {
      async executeAction() {
        return {
          authenticated: false
        };
      }
    },
    reply: {}
  });

  assert.deepEqual(payload.tenancy, {
    mode: TENANCY_MODE_PERSONAL,
    workspace: {
      enabled: true,
      autoProvision: true,
      allowSelfCreate: false,
      slugPolicy: WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME
    }
  });
  assert.equal(payload.app.tenancyMode, undefined);
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
    workspaceInvitationsEnabled: true,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  await contributor.contribute({
    query: {
      workspaceSlug: "  AcMe  "
    },
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

  assert.deepEqual(calls, ["acme"]);
});

test("workspace bootstrap contributor returns global payload with requestedWorkspace=forbidden when slug access is denied", async () => {
  const profile = createAuthenticatedProfile();
  const contributor = createWorkspaceBootstrapContributor({
    workspaceService: {
      async listWorkspacesForUser() {
        return [{ id: 3, slug: "chiara", name: "Chiara Workspace" }];
      },
      async resolveWorkspaceContextForUserBySlug() {
        const error = new Error("Forbidden.");
        error.status = 403;
        throw error;
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
    workspaceInvitationsEnabled: true,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  const payload = await contributor.contribute({
    query: {
      workspaceSlug: "tonymobily"
    },
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

  assert.equal(payload.session.authenticated, true);
  assert.deepEqual(payload.workspaces, [{ id: 3, slug: "chiara", name: "Chiara Workspace" }]);
  assert.deepEqual(payload.requestedWorkspace, {
    slug: "tonymobily",
    status: "forbidden"
  });
  assert.equal(payload.activeWorkspace, null);
  assert.equal(payload.membership, null);
  assert.deepEqual(payload.permissions, []);
  assert.equal(payload.workspaceSettings, null);
});

test("workspace bootstrap contributor returns requestedWorkspace=not_found when slug does not exist", async () => {
  const profile = createAuthenticatedProfile();
  const contributor = createWorkspaceBootstrapContributor({
    workspaceService: {
      async listWorkspacesForUser() {
        return [{ id: 1, slug: "acme", name: "Acme Workspace" }];
      },
      async resolveWorkspaceContextForUserBySlug() {
        const error = new Error("Workspace not found.");
        error.status = 404;
        throw error;
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
    workspaceInvitationsEnabled: false,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  const payload = await contributor.contribute({
    query: {
      workspaceSlug: "missing-workspace"
    },
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

  assert.deepEqual(payload.requestedWorkspace, {
    slug: "missing-workspace",
    status: "not_found"
  });
  assert.deepEqual(payload.workspaces, [{ id: 1, slug: "acme", name: "Acme Workspace" }]);
});

test("workspace bootstrap contributor returns requestedWorkspace=unauthenticated for anonymous workspace slug query", async () => {
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
        return null;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return {};
      }
    },
    workspaceInvitationsEnabled: false,
    appConfig: {
      tenancyMode: "workspaces"
    }
  });

  const payload = await contributor.contribute({
    query: {
      workspaceSlug: "tonymobily"
    },
    request: {
      async executeAction() {
        return {
          authenticated: false
        };
      }
    },
    reply: {}
  });

  assert.equal(payload.session.authenticated, false);
  assert.deepEqual(payload.requestedWorkspace, {
    slug: "tonymobily",
    status: "unauthenticated"
  });
  assert.deepEqual(payload.workspaces, []);
});
