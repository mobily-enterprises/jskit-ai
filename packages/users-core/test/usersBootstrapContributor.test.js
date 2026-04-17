import assert from "node:assert/strict";
import test from "node:test";
import { createUsersBootstrapContributor } from "../src/server/usersBootstrapContributor.js";
import {
  TENANCY_MODE_PERSONAL,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME
} from "../src/shared/tenancyProfile.js";

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

function createUserSettings() {
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

test("users bootstrap contributor exposes the generic authenticated bootstrap payload", async () => {
  const profile = createAuthenticatedProfile({ id: "12" });
  const writtenSessions = [];
  const contributor = createUsersBootstrapContributor({
    usersRepository: {
      async findById() {
        return profile;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return createUserSettings();
      }
    },
    authService: {
      writeSessionCookies(reply, session) {
        writtenSessions.push({ reply, session });
      },
      getOAuthProviderCatalog() {
        return {
          providers: [
            { id: "google", label: "Google" }
          ],
          defaultProvider: "google"
        };
      }
    }
  });

  const reply = {};
  const payload = await contributor.contribute({
    request: {
      async executeAction() {
        return {
          authenticated: true,
          profile,
          session: {
            csrfToken: "csrf-1"
          }
        };
      }
    },
    payload: {
      surfaceAccess: {
        consoleowner: true
      }
    },
    reply
  });
  assert.equal(contributor.order, 100);
  assert.equal(writtenSessions.length, 1);
  assert.equal(writtenSessions[0].reply, reply);
  assert.deepEqual(writtenSessions[0].session, {
    csrfToken: "csrf-1"
  });
  assert.equal(payload.session.authenticated, true);
  assert.equal(payload.session.userId, "12");
  assert.deepEqual(payload.surfaceAccess, {
    consoleowner: true
  });
  assert.equal(payload.app.features.workspaceSwitching, false);
  assert.deepEqual(payload.session.oauthProviders, [
    {
      id: "google",
      label: "Google"
    }
  ]);
  assert.equal(payload.session.oauthDefaultProvider, "google");
  assert.deepEqual(payload.workspaces, []);
  assert.deepEqual(payload.userSettings, {});
  assert.equal(payload.requestMeta.hasRequest, true);
});

test("users bootstrap contributor emits canonical tenancy profile for anonymous bootstrap", async () => {
  const contributor = createUsersBootstrapContributor({
    usersRepository: {
      async findById() {
        return null;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return createUserSettings();
      }
    },
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
    },
    authService: {
      getOAuthProviderCatalog() {
        return {
          providers: [],
          defaultProvider: null
        };
      }
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
    payload: {
      surfaceAccess: {
        consoleowner: false
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
  assert.deepEqual(payload.session, {
    authenticated: false,
    oauthProviders: [],
    oauthDefaultProvider: null
  });
  assert.deepEqual(payload.workspaces, []);
  assert.deepEqual(payload.surfaceAccess, {
    consoleowner: false
  });
  assert.equal(payload.userSettings, null);
});
