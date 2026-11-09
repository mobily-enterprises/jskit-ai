import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import * as jose from "jose";
import * as authProviderSupabase from "../src/server/lib/index.js";
import { createSupabaseAccountFlows } from "../src/server/lib/accountFlows.js";
import { resolveSupabaseConfig } from "../src/server/lib/config.js";
import { createSupabasePasswordFlows } from "../src/server/lib/passwordFlows.js";
import { createSupabaseSessions } from "../src/server/lib/sessions.js";
import { PROVIDER_MODE_PROFILES } from "../src/server/lib/profileModes.js";

test("auth.provider.supabase exports required symbols", () => {
  assert.equal(typeof authProviderSupabase.createSupabaseAuthService, "function");
});

function supabaseConfig(env = {}) {
  return resolveSupabaseConfig({
    config: {},
    env: { APP_PUBLIC_URL: "http://localhost:5173", NODE_ENV: "development", ...env }
  });
}

const fixtureProjector = {
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
};

function createServiceFixture({ env = {}, projector = fixtureProjector } = {}) {
  return authProviderSupabase.createSupabaseAuthService({
    config: supabaseConfig(env),
    profiles: { ...PROVIDER_MODE_PROFILES, projector }
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
    env: { NODE_ENV: "production" }
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

  assert.equal(clearCalls.every((call) => call.options.secure === true), true);
  // Production names are host-only __Host- cookies, which only exist at Path=/.
  assert.deepEqual(
    clearCalls.map((call) => `${call.name} ${call.options.path}`),
    [
      "__Host-sb_access_token /",
      "__Host-sb_refresh_token /",
      "__Host-sb_recovery_access_token /",
      "__Host-sb_recovery_refresh_token /"
    ]
  );
});

test("supabase account flow updateDisplayName accepts the core command payload shape", async () => {
  let updatePayload = null;
  const flows = createSupabaseAccountFlows({
    config: supabaseConfig(),
    clients: {
      ensureConfigured() {},
      createSupabaseClient() {
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
      }
    },
    sessions: {
      async setSessionFromRequestCookies() {
        return {
          data: {
            session: {
              access_token: "access"
            }
          }
        };
      }
    },
    profileMirror: {
      async syncProfileFromSupabaseUser(user) {
        return {
          id: "profile-1",
          email: user.email,
          displayName: user.user_metadata.display_name,
          authProvider: "supabase",
          authProviderUserSid: user.id
        };
      }
    },
    securityStatus: {}
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

test("authentication without profile sync reads the existing profile", async (t) => {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "test-key", alg: "ES256" };
  const jwks = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  jwks.listen(0, "127.0.0.1");
  await once(jwks, "listening");
  t.after(() => new Promise((resolve) => jwks.close(resolve)));
  const supabaseUrl = `http://127.0.0.1:${jwks.address().port}`;
  const accessToken = await new jose.SignJWT({ email: "ada@example.com" })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience("authenticated")
    .setSubject("supabase-user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const profile = { id: "7", email: "ada@example.com", displayName: "Ada", authProvider: "supabase", authProviderUserSid: "supabase-user-1" };
  let existingProfile = profile;
  let syncCalls = 0;
  const authService = createServiceFixture({
    env: { AUTH_SUPABASE_URL: supabaseUrl, AUTH_SUPABASE_PUBLISHABLE_KEY: "publishable-key" },
    projector: {
      async findByIdentity() {
        return existingProfile;
      },
      async syncIdentityProfile() {
        syncCalls += 1;
        return profile;
      }
    }
  });
  const request = { cookies: { sb_access_token: accessToken } };

  const checked = await authService.authenticateRequest(request, { syncProfile: false });
  assert.equal(checked.authenticated, true);
  assert.equal(checked.actor.providerUserId, "supabase-user-1");
  assert.equal(syncCalls, 0);

  existingProfile = null;
  const unprojected = await authService.authenticateRequest(request, { syncProfile: false });
  assert.equal(unprojected.authenticated, false, "A login without an app profile is not signed in without sync");
  assert.equal((await authService.authenticateRequest(request)).authenticated, true);
  assert.equal(syncCalls, 1);
});

test("a caller that cannot store a refreshed session is told to refresh instead of spending the token", async (t) => {
  const tokenRequests = [];
  const supabase = createServer((request, response) => {
    tokenRequests.push(request.url);
    response.statusCode = 400;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" }));
  });
  supabase.listen(0, "127.0.0.1");
  await once(supabase, "listening");
  t.after(() => new Promise((resolve) => supabase.close(resolve)));
  const authService = createServiceFixture({
    env: { AUTH_SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`, AUTH_SUPABASE_PUBLISHABLE_KEY: "publishable-key" }
  });
  // The access cookie is gone once its token expires; the refresh cookie remains.
  const request = { cookies: { sb_refresh_token: "R1" } };

  assert.deepEqual(await authService.authenticateRequest(request, { refreshSession: false }), {
    authenticated: false,
    refreshRequired: true,
    clearSession: false,
    session: null,
    transientFailure: false
  });
  assert.deepEqual(tokenRequests, []);

  await authService.authenticateRequest(request);
  assert.deepEqual(tokenRequests, ["/auth/v1/token?grant_type=refresh_token"]);
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
  const flows = createSupabasePasswordFlows({
    config: supabaseConfig(),
    clients: {
      ensureConfigured() {},
      createSupabaseClient() {
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
      }
    },
    sessions: {
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
      }
    },
    profileMirror: {
      async syncProfileFromSupabaseUser(user) {
        return {
          id: "1",
          email: user.email,
          displayName: "Reset Example",
          authProvider: "supabase",
          authProviderUserSid: user.id
        };
      }
    },
    securityStatus: {
      async passwordSignInPolicyForUser(userId) {
        assert.equal(userId, "1");
        return {
          passwordSignInEnabled: true
        };
      }
    },
    profiles: {
      userSettingsRepository: {
        async updatePasswordSetupRequired(userId, required) {
          assert.equal(userId, "1");
          assert.equal(required, false);
        }
      }
    }
  });

  await flows.resetPassword(
    {
      password: "new password value"
    },
    {
      cookies: {
        sb_access_token: "normal-access",
        sb_refresh_token: "normal-refresh",
        sb_recovery_access_token: "recovery-access",
        sb_recovery_refresh_token: "recovery-refresh"
      }
    }
  );

  assert.equal(recoverySessionReads, 1);
  assert.equal(normalSessionReads, 0);
  assert.equal(signOutCalls, 1);
});

test("supabase sessions read a valid access token's user once", async () => {
  const reads = [];
  const user = { id: "supabase-user-1", email: "ada@example.com" };
  const sessions = createSupabaseSessions({
    config: supabaseConfig(),
    clients: {
      ensureConfigured() {},
      createSupabaseClient() {
        return {
          auth: {
            async getUser(token) {
              reads.push(token);
              return { data: { user }, error: null };
            }
          }
        };
      }
    },
    profileMirror: {},
    profiles: {}
  });

  const current = await sessions.resolveCurrentSupabaseUser({ cookies: { sb_access_token: "access-1", sb_refresh_token: "refresh-1" } });
  assert.deepEqual(current, { session: null, user });
  assert.deepEqual(reads, ["access-1"]);
});

test("supabase sessions read the user of a token that setSession issued", async () => {
  const reads = [];
  const refreshedUser = { id: "supabase-user-1", email: "ada@example.com" };
  const sessions = createSupabaseSessions({
    config: supabaseConfig(),
    clients: {
      ensureConfigured() {},
      createSupabaseClient() {
        return {
          auth: {
            async getUser(token) {
              reads.push(token);
              return token === "access-2"
                ? { data: { user: { ...refreshedUser, read: true } }, error: null }
                : { data: { user: null }, error: { status: 401, message: "expired" } };
            },
            async setSession() {
              return { data: { session: { access_token: "access-2", refresh_token: "refresh-2" }, user: refreshedUser }, error: null };
            }
          }
        };
      }
    },
    profileMirror: {},
    profiles: {}
  });

  const current = await sessions.resolveCurrentSupabaseUser({ cookies: { sb_access_token: "access-1", sb_refresh_token: "refresh-1" } });
  assert.deepEqual(reads, ["access-1", "access-2"]);
  assert.equal(current.user.read, true);
  assert.equal(current.session.access_token, "access-2");
});
