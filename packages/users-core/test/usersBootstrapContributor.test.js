import assert from "node:assert/strict";
import test from "node:test";
import { createUsersBootstrapContributor } from "../src/server/usersBootstrapContributor.js";

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
    userProfilesRepository: {
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
  assert.equal(payload.app.features.assistantEnabled, false);
  assert.deepEqual(payload.session.oauthProviders, [
    {
      id: "google",
      label: "Google"
    }
  ]);
  assert.equal(payload.session.oauthDefaultProvider, "google");
  assert.deepEqual(payload.userSettings, {});
  assert.equal(payload.requestMeta.hasRequest, true);
});

test("users bootstrap contributor emits anonymous bootstrap payload without workspace fields", async () => {
  const contributor = createUsersBootstrapContributor({
    userProfilesRepository: {
      async findById() {
        return null;
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return createUserSettings();
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

  assert.deepEqual(payload.session, {
    authenticated: false,
    oauthProviders: [],
    oauthDefaultProvider: null
  });
  assert.deepEqual(payload.surfaceAccess, {
    consoleowner: false
  });
  assert.equal(payload.userSettings, null);
});
