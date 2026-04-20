import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/lib/index.js";

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

function createUsersRepository(profile = createProfile()) {
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

function createServiceFixture(overrides = {}) {
  return createService({
    authProvider: {
      id: "supabase",
      supabaseUrl: "",
      supabasePublishableKey: "",
      jwtAudience: "authenticated"
    },
    appPublicUrl: "http://localhost:5173",
    nodeEnv: "development",
    devAuthBypassEnabled: true,
    devAuthBypassSecret: "dev-bootstrap-secret",
    usersRepository: createUsersRepository(),
    userProfileSyncService: createUserProfileSyncService(),
    ...overrides
  });
}

test("dev auth bootstrap can issue and authenticate a local session without Supabase", async () => {
  const authService = createServiceFixture();
  const loginRequest = createLocalRequest();

  const loginResult = await authService.devLoginAs(loginRequest, {
    userId: "7"
  });

  assert.equal(loginResult.profile.id, "7");
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
  assert.equal(authResult.profile.id, "7");
  assert.equal(authResult.profile.email, "ada@example.com");
  assert.equal(authResult.session, null);
});

test("dev auth bootstrap supports email lookup", async () => {
  const authService = createServiceFixture();

  const result = await authService.devLoginAs(createLocalRequest(), {
    email: "ADA@EXAMPLE.COM"
  });

  assert.equal(result.profile.id, "7");
  assert.equal(result.profile.email, "ada@example.com");
});

test("dev auth bootstrap rejects non-local requests and clears leaked dev sessions", async () => {
  const authService = createServiceFixture();
  const issued = await authService.devLoginAs(createLocalRequest(), {
    userId: "7"
  });

  await assert.rejects(
    () =>
      authService.devLoginAs(
        createLocalRequest({
          ip: "203.0.113.10",
          hostname: "example.com",
          headers: { host: "example.com" }
        }),
        { userId: "7" }
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
        createLocalRequest({
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
        }),
        { userId: "7" }
      ),
    /localhost/
  );
});
