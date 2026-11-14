import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupabaseConfig } from "../src/server/lib/config.js";
import { createSupabaseAuthService } from "../src/server/lib/index.js";
import { PROVIDER_MODE_PROFILES } from "../src/server/lib/profileModes.js";

const DEV_AUTH_SECRET = "dev-bootstrap-secret";

function createProfile(overrides = {}) {
  return {
    id: "7",
    email: "ada@example.com",
    username: "ada",
    displayName: "Ada Example",
    authProvider: "supabase",
    authProviderUserSid: "supabase-user-7",
    avatarStorageKey: null,
    avatarVersion: null,
    ...overrides
  };
}

function createUserProfilesRepository(profile = createProfile()) {
  return {
    async findById(userId) {
      return String(userId || "") === String(profile.id) ? profile : null;
    },
    async findByEmail(email) {
      return String(email || "").trim().toLowerCase() === String(profile.email || "").toLowerCase() ? profile : null;
    }
  };
}

function createUserProfileSyncService() {
  return {
    async findByIdentity() {
      return null;
    },
    async syncIdentityProfile(profile) {
      return createProfile({
        authProvider: String(profile?.authProvider || "supabase"),
        authProviderUserSid: String(profile?.authProviderUserSid || "supabase-user-7"),
        email: String(profile?.email || "ada@example.com").toLowerCase(),
        displayName: String(profile?.displayName || "Ada Example")
      });
    }
  };
}

function createLocalRequest(overrides = {}) {
  const remoteAddress = String(overrides?.socket?.remoteAddress || overrides?.raw?.socket?.remoteAddress || "127.0.0.1");
  return {
    ip: "127.0.0.1",
    hostname: "localhost",
    headers: {
      host: "localhost:3000"
    },
    cookies: {},
    socket: {
      remoteAddress
    },
    raw: {
      socket: {
        remoteAddress
      }
    },
    ...overrides
  };
}

function createDevAuthExchangeRequest(overrides = {}) {
  const request = createLocalRequest(overrides);
  return {
    ...request,
    headers: {
      ...request.headers,
      "x-jskit-dev-auth-secret": DEV_AUTH_SECRET
    }
  };
}

function createServiceFixture({ userProfilesRepository = createUserProfilesRepository() } = {}) {
  return createSupabaseAuthService({
    config: resolveSupabaseConfig({
      config: { auth: { profileMode: "users" } },
      env: {
        APP_PUBLIC_URL: "http://localhost:5173",
        APP_ENV: "development",
        AUTH_JWT_AUDIENCE: "authenticated",
        AUTH_DEV_BYPASS_ENABLED: true,
        AUTH_DEV_BYPASS_SECRET: DEV_AUTH_SECRET
      }
    }),
    profiles: {
      projector: createUserProfileSyncService(),
      userProfilesRepository,
      userSettingsRepository: PROVIDER_MODE_PROFILES.userSettingsRepository
    }
  });
}

test("dev auth bootstrap can issue and authenticate a local session without Supabase", async () => {
  const authService = createServiceFixture();
  const loginRequest = createDevAuthExchangeRequest();

  const loginResult = await authService.devLoginAs({
    userId: "7"
  }, loginRequest);

  assert.equal(loginResult.actor.id, "7");
  assert.match(loginResult.session.access_token, /^jskit-dev\./);
  assert.match(loginResult.session.refresh_token, /^jskit-dev\./);

  const authResult = await authService.authenticateRequest(
    createLocalRequest({
      cookies: {
        sb_access_token: loginResult.session.access_token,
        sb_refresh_token: loginResult.session.refresh_token
      }
    })
  );

  assert.equal(authResult.authenticated, true);
  assert.equal(authResult.actor.id, "7");
  assert.equal(authResult.actor.email, "ada@example.com");
  assert.equal(authResult.session, null);
});

test("dev auth bootstrap resolves security status without Supabase", async () => {
  const authService = createServiceFixture();
  const loginResult = await authService.devLoginAs({
    userId: "7"
  }, createDevAuthExchangeRequest());

  const securityStatus = await authService.getSecurityStatus(
    createLocalRequest({
      cookies: {
        sb_access_token: loginResult.session.access_token,
        sb_refresh_token: loginResult.session.refresh_token
      }
    })
  );

  const passwordMethod = securityStatus.authMethods.find((method) => method.id === "password");
  assert.equal(securityStatus.policy.minimumEnabledMethods, 1);
  assert.equal(passwordMethod?.configured, true);
  assert.equal(passwordMethod?.enabled, true);
});

test("dev auth security status rejects invalid dev sessions without recovery-link errors", async () => {
  const authService = createServiceFixture();

  await assert.rejects(
    () =>
      authService.getSecurityStatus(
        createLocalRequest({
          cookies: {
            sb_access_token: "jskit-dev.invalid"
          }
        })
      ),
    (error) => {
      assert.equal(error.statusCode || error.status, 401);
      assert.equal(error.message, "Authentication required.");
      return true;
    }
  );
});

test("dev auth bootstrap supports email lookup", async () => {
  const authService = createServiceFixture();

  const result = await authService.devLoginAs({
    email: "ADA@EXAMPLE.COM"
  }, createDevAuthExchangeRequest());

  assert.equal(result.actor.id, "7");
  assert.equal(result.actor.email, "ada@example.com");
});

test("dev auth bootstrap rejects a missing or incorrect exchange secret", async () => {
  const authService = createServiceFixture();

  await assert.rejects(
    () => authService.devLoginAs({ userId: "7" }, createLocalRequest()),
    /not authorized/
  );
  await assert.rejects(
    () => authService.devLoginAs({ userId: "7" }, createLocalRequest({
      headers: {
        host: "localhost:3000",
        "x-jskit-dev-auth-secret": "wrong-secret"
      }
    })),
    /not authorized/
  );
});

test("dev auth bootstrap returns the canonical actor", async () => {
  const rawProfile = createProfile({
    email: " ADA@EXAMPLE.COM ",
    username: " Ada ",
    displayName: " Ada Example ",
    authProvider: " SUPABASE ",
    authProviderUserSid: " supabase-user-7 ",
    avatarStorageKey: " avatars/7.png ",
    avatarVersion: 7,
    avatarUpdatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const authService = createServiceFixture({
    userProfilesRepository: createUserProfilesRepository(rawProfile)
  });

  const loginResult = await authService.devLoginAs({
    userId: "7"
  }, createDevAuthExchangeRequest());

  assert.deepEqual(loginResult.actor, {
    id: "7",
    authIdentityId: "supabase:supabase-user-7",
    provider: "supabase",
    providerUserId: "supabase-user-7",
    email: "ada@example.com",
    displayName: "Ada Example",
    appUserId: "7",
    profileSource: "users"
  });
  assert.equal(Object.hasOwn(loginResult, "profile"), false);
});

test("dev auth bootstrap rejects non-local requests and clears leaked dev sessions", async () => {
  const authService = createServiceFixture();
  const issued = await authService.devLoginAs({
    userId: "7"
  }, createDevAuthExchangeRequest());

  await assert.rejects(
    () =>
      authService.devLoginAs(
        { userId: "7" },
        createDevAuthExchangeRequest({
          ip: "203.0.113.10",
          hostname: "example.com",
          headers: { host: "example.com" }
        })
      ),
    /localhost/
  );

  const authResult = await authService.authenticateRequest({
    ip: "203.0.113.10",
    hostname: "example.com",
    headers: { host: "example.com" },
    cookies: {
      sb_access_token: issued.session.access_token,
      sb_refresh_token: issued.session.refresh_token
    }
  });

  assert.equal(authResult.authenticated, false);
  assert.equal(authResult.clearSession, true);
});

test("dev auth bootstrap does not trust forwarded localhost headers", async () => {
  const authService = createServiceFixture();

  await assert.rejects(
    () =>
      authService.devLoginAs(
        { userId: "7" },
        createDevAuthExchangeRequest({
          ip: "203.0.113.10",
          socket: {
            remoteAddress: "203.0.113.10"
          },
          raw: {
            socket: {
              remoteAddress: "203.0.113.10"
            }
          },
          headers: {
            host: "localhost:3000",
            "x-forwarded-for": "127.0.0.1",
            "x-forwarded-host": "localhost"
          }
        })
      ),
    /localhost/
  );
});
