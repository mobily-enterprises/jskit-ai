import assert from "node:assert/strict";
import test from "node:test";
import * as authProviderSupabase from "../src/server/lib/index.js";

test("auth.provider.supabase exports required symbols", () => {
  assert.equal(typeof authProviderSupabase.createService, "function");
});

function createServiceFixture(overrides = {}) {
  return authProviderSupabase.createService({
    authProvider: {
      id: "supabase",
      supabaseUrl: "",
      supabasePublishableKey: ""
    },
    appPublicUrl: "http://localhost:5173",
    nodeEnv: "development",
    userProfileSyncService: {
      async findByIdentity() {
        return null;
      },
      async syncIdentityProfile(profile) {
        return {
          id: "1",
          email: String(profile?.email || "ada@example.com"),
          displayName: String(profile?.displayName || "Ada Example"),
          authProvider: String(profile?.authProvider || "supabase"),
          authProviderUserSid: String(profile?.authProviderUserSid || "supabase-user-1")
        };
      }
    },
    ...overrides
  });
}

test("clearSessionCookies clears root and API path session cookie variants", () => {
  const authService = createServiceFixture();
  const clearCalls = [];
  const reply = {
    clearCookie(name, options) {
      clearCalls.push({
        name,
        options
      });
    }
  };

  authService.clearSessionCookies(reply);

  assert.deepEqual(
    clearCalls.map((call) => ({ name: call.name, path: call.options.path, maxAge: call.options.maxAge })),
    [
      { name: "sb_access_token", path: "/", maxAge: 0 },
      { name: "sb_refresh_token", path: "/", maxAge: 0 },
      { name: "sb_access_token", path: "/api", maxAge: 0 },
      { name: "sb_refresh_token", path: "/api", maxAge: 0 }
    ]
  );
});

test("clearSessionCookies preserves secure cookie clearing in production", () => {
  const authService = createServiceFixture({
    nodeEnv: "production"
  });
  const clearCalls = [];
  const reply = {
    clearCookie(name, options) {
      clearCalls.push({
        name,
        options
      });
    }
  };

  authService.clearSessionCookies(reply);

  assert.equal(clearCalls.length, 4);
  assert.equal(clearCalls.every((call) => call.options.secure === true), true);
});

test("logout is local-only when no session cookies are present", async () => {
  const authService = createServiceFixture();

  const result = await authService.logout({
    cookies: {}
  });

  assert.deepEqual(result, {
    ok: true,
    clearSession: true
  });
});

test("logout is local-only for dev auth cookies", async () => {
  const authService = createServiceFixture();

  const result = await authService.logout({
    cookies: {
      sb_access_token: "jskit-dev.invalid"
    }
  });

  assert.deepEqual(result, {
    ok: true,
    clearSession: true
  });
});

test("auth logout action delegates to provider logout and notifies session changes", async () => {
  const action = authProviderSupabase
    .buildAuthActions()
    .find((definition) => definition.id === "auth.logout");
  const request = {
    id: "request-1"
  };
  const calls = [];

  const result = await action.execute(
    {},
    {
      requestMeta: {
        request
      }
    },
    {
      authService: {
        async logout(receivedRequest) {
          calls.push({
            type: "logout",
            request: receivedRequest
          });
          return {
            ok: true,
            clearSession: true
          };
        }
      },
      authSessionEventsService: {
        async notifySessionChanged(payload) {
          calls.push({
            type: "notify",
            context: payload.context
          });
        }
      }
    }
  );

  assert.deepEqual(result, {
    ok: true,
    clearSession: true
  });
  assert.deepEqual(calls, [
    {
      type: "logout",
      request
    },
    {
      type: "notify",
      context: {
        requestMeta: {
          request
        }
      }
    }
  ]);
});
