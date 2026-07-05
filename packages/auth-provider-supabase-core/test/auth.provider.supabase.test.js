import assert from "node:assert/strict";
import test from "node:test";
import * as authProviderSupabase from "../src/server/lib/index.js";
import { createAccountFlows } from "../src/server/lib/accountFlows.js";
import { createPasswordSecurityFlows } from "../src/server/lib/passwordSecurityFlows.js";

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
      { name: "sb_recovery_access_token", path: "/", maxAge: 0 },
      { name: "sb_recovery_refresh_token", path: "/", maxAge: 0 },
      { name: "sb_access_token", path: "/api", maxAge: 0 },
      { name: "sb_refresh_token", path: "/api", maxAge: 0 },
      { name: "sb_recovery_access_token", path: "/api", maxAge: 0 },
      { name: "sb_recovery_refresh_token", path: "/api", maxAge: 0 }
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

  assert.equal(clearCalls.length, 8);
  assert.equal(clearCalls.every((call) => call.options.secure === true), true);
});

test("supabase account flow updateDisplayName accepts the core command payload shape", async () => {
  let updatePayload = null;
  const flows = createAccountFlows({
    ensureConfigured() {},
    validationError(errors) {
      return new Error(JSON.stringify(errors));
    },
    getSupabaseClient() {
      return {
        auth: {
          async updateUser(payload) {
            updatePayload = payload;
            return {
              data: {
                user: {
                  id: "supabase-user-1",
                  email: "ada@example.com",
                  user_metadata: {
                    display_name: payload.data.display_name
                  },
                  app_metadata: {}
                }
              }
            };
          }
        }
      };
    },
    async setSessionFromRequestCookies() {
      return {
        data: {
          session: {
            access_token: "access"
          }
        }
      };
    },
    async syncProfileFromSupabaseUser(user) {
      return {
        id: "profile-1",
        email: user.email,
        displayName: user.user_metadata.display_name,
        authProvider: "supabase",
        authProviderUserSid: user.id
      };
    },
    mapProfileUpdateError(error) {
      return error || new Error("profile update failed");
    }
  });

  const result = await flows.updateDisplayName(
    {
      cookies: {}
    },
    {
      displayName: "Ada Lovelace"
    }
  );

  assert.deepEqual(updatePayload, {
    data: {
      display_name: "Ada Lovelace"
    }
  });
  assert.equal(result.profile.displayName, "Ada Lovelace");
});

test("recovery sessions use recovery cookies and do not authenticate the app", async () => {
  const authService = createServiceFixture();
  const cookies = {};
  const cookieOptions = {};
  const reply = {
    setCookie(name, value, options) {
      cookies[name] = value;
      cookieOptions[name] = options;
    }
  };

  authService.writeSessionCookies(reply, {
    access_token: "recovery-access",
    refresh_token: "recovery-refresh",
    expires_in: 300,
    purpose: "recovery"
  });

  assert.deepEqual(cookies, {
    sb_recovery_access_token: "recovery-access",
    sb_recovery_refresh_token: "recovery-refresh"
  });
  assert.equal(cookieOptions.sb_recovery_access_token.maxAge, 300);
  assert.equal(cookieOptions.sb_recovery_refresh_token.maxAge, 300);
  assert.equal(authService.hasAccessTokenCookie({ cookies }), true);
  assert.equal(authService.hasSessionCookie({ cookies }), true);

  const authResult = await authService.authenticateRequest({ cookies });
  assert.deepEqual(authResult, {
    authenticated: false,
    clearSession: false,
    session: null,
    transientFailure: false
  });
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

test("supabase password reset consumes the recovery session reader", async () => {
  let normalSessionReads = 0;
  let recoverySessionReads = 0;
  let signOutCalls = 0;
  const flows = createPasswordSecurityFlows({
    ensureConfigured() {},
    validationError(errors) {
      const error = new Error("Validation failed.");
      error.errors = errors;
      return error;
    },
    getSupabaseClient() {
      return {
        auth: {
          async updateUser(input) {
            assert.deepEqual(input, { password: "new password value" });
            return {
              data: {
                user: {
                  id: "supabase-user-1",
                  email: "reset@example.com"
                }
              },
              error: null
            };
          },
          async signOut(options) {
            signOutCalls += 1;
            assert.deepEqual(options, {
              scope: "local"
            });
            return {
              error: null
            };
          }
        }
      };
    },
    async setSessionFromRequestCookies() {
      normalSessionReads += 1;
      throw new Error("normal session reader should not be used for reset.");
    },
    async setRecoverySessionFromRequestCookies(_request, { supabaseClient }) {
      recoverySessionReads += 1;
      assert.equal(typeof supabaseClient.auth.updateUser, "function");
      return {
        data: {
          user: {
            id: "supabase-user-1",
            email: "reset@example.com"
          },
          session: {
            access_token: "recovery-access",
            refresh_token: "recovery-refresh"
          }
        }
      };
    },
    async syncProfileFromSupabaseUser(user) {
      return {
        id: "1",
        email: user.email,
        displayName: "Reset Example",
        authProvider: "supabase",
        authProviderUserSid: user.id
      };
    },
    async resolvePasswordSignInPolicyForUserId(userId) {
      assert.equal(userId, "1");
      return {
        passwordSignInEnabled: true
      };
    },
    async setPasswordSetupRequiredForUserId(userId, required) {
      assert.equal(userId, "1");
      assert.equal(required, false);
    },
    mapPasswordUpdateError(error) {
      return error instanceof Error ? error : new Error("Password update failed.");
    }
  });

  await flows.resetPassword(
    {
      cookies: {
        sb_access_token: "normal-access",
        sb_refresh_token: "normal-refresh",
        sb_recovery_access_token: "recovery-access",
        sb_recovery_refresh_token: "recovery-refresh"
      }
    },
    {
      password: "new password value"
    }
  );

  assert.equal(recoverySessionReads, 1);
  assert.equal(normalSessionReads, 0);
  assert.equal(signOutCalls, 1);
});
