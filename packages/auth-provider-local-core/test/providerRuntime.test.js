import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { AuthActionsServiceProvider } from "@jskit-ai/auth-core/server/providers/AuthActionsServiceProvider";
import { AuthLocalServiceProvider } from "../src/server/providers/AuthLocalServiceProvider.js";
import { AuthProviderServiceProvider } from "../src/server/providers/AuthProviderServiceProvider.js";
import { createLocalFileBackend } from "../src/server/lib/fileBackend.js";
import { createLocalAuthService } from "../src/server/lib/service.js";
import { hashPassword } from "../src/server/lib/passwords.js";

function createAppConfigFixture() {
  return {
    surfaceModeAll: "all",
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false },
      console: {
        id: "console",
        pagesRoot: "console",
        enabled: true,
        requiresAuth: true,
        requiresWorkspace: false
      }
    }
  };
}

function createReplyFixture() {
  const cookies = {};
  const cookieOptions = {};
  return {
    cookies,
    cookieOptions,
    setCookie(name, value, options) {
      cookies[name] = value;
      cookieOptions[name] = options;
    },
    clearCookie(name) {
      delete cookies[name];
      delete cookieOptions[name];
    }
  };
}

async function createStartedApp({ profileProjector = null } = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-"));
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_PROVIDER: "local",
    AUTH_LOCAL_STORE_DIR: storeDir,
    AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "response",
    APP_PUBLIC_URL: "http://localhost:5173",
    NODE_ENV: "test"
  });
  app.instance("jskit.logger", {
    info() {},
    warn() {},
    error() {},
    debug() {}
  });
  app.instance("domainEvents", {
    async publish() {}
  });
  if (profileProjector) {
    app.instance("auth.profile.projector", profileProjector);
  }
  await app.start({
    providers: [
      ActionRuntimeServiceProvider,
      AuthLocalServiceProvider,
      AuthProviderServiceProvider,
      AuthActionsServiceProvider
    ]
  });
  return {
    app,
    storeDir
  };
}

test("local auth provider registers, logs in, reads session, and logs out with file backend", async () => {
  const { app, storeDir } = await createStartedApp();
  const authService = app.make("authService");
  const capabilities = authService.getCapabilities();
  assert.equal(capabilities.provider.id, "local");
  assert.equal(capabilities.features.password.login, true);
  assert.equal(capabilities.features.oauthLogin.enabled, false);

  const registered = await authService.register({
    email: "Ada@example.com",
    password: "correct horse battery staple",
    displayName: "Ada"
  });
  assert.equal(registered.profile.email, "ada@example.com");
  assert.equal(registered.actor.provider, "local");
  assert.equal(registered.requiresEmailConfirmation, false);

  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, registered.session);
  assert.equal(Boolean(reply.cookies.jskit_local_access_token), true);
  assert.equal(Boolean(reply.cookies.jskit_local_refresh_token), true);

  const session = await authService.authenticateRequest({ cookies: reply.cookies });
  assert.equal(session.authenticated, true);
  assert.equal(session.actor.email, "ada@example.com");

  const actionExecutor = app.make("actionExecutor");
  const definitions = actionExecutor.listDefinitions();
  assert.equal(definitions.some((definition) => definition.id === "auth.login.password"), true);
  const actionSession = await actionExecutor.execute({
    actionId: "auth.session.read",
    input: {},
    context: {
      channel: "internal",
      surface: "home",
      requestMeta: {
        request: { cookies: reply.cookies }
      }
    }
  });
  assert.equal(actionSession.authenticated, true);

  await authService.logout({ cookies: reply.cookies });
  const loggedOut = await authService.authenticateRequest({ cookies: reply.cookies });
  assert.equal(loggedOut.authenticated, false);
  assert.equal(loggedOut.clearSession, true);

  const usersFile = await fs.readFile(path.join(storeDir, "users.passwd"), "utf8");
  assert.match(usersFile, /^user:v1:/);
});

test("local auth login verifies password and creates session in one backend transaction", async () => {
  const password = await hashPassword("current password value");
  let transactions = 0;
  let sessionCreated = false;
  const backend = {
    async withTransaction(callback) {
      transactions += 1;
      const tx = {
        users: {
          async findByEmail(email) {
            assert.equal(email, "race@example.com");
            return {
              id: "usr_race",
              email,
              displayName: "Race User",
              password,
              disabled: false
            };
          }
        },
        sessions: {
          async create(input) {
            sessionCreated = true;
            return {
              ...input,
              createdAt: new Date().toISOString(),
              revokedAt: ""
            };
          }
        }
      };
      return callback(tx);
    }
  };
  const authService = createLocalAuthService({
    backend,
    config: {
      nodeEnv: "test",
      sessionSecret: "test-secret",
      appPublicUrl: "http://localhost:5173",
      smtpConfigured: false,
      recoveryDevOutput: "disabled"
    }
  });

  const result = await authService.login({
    email: "race@example.com",
    password: "current password value"
  });

  assert.equal(result.actor.email, "race@example.com");
  assert.equal(Boolean(result.session?.access_token), true);
  assert.equal(sessionCreated, true);
  assert.equal(transactions, 1);
});

test("local auth provider completes recovery through a recovery-scoped session", async () => {
  const { app } = await createStartedApp();
  const authService = app.make("authService");
  const registered = await authService.register({
    email: "grace@example.com",
    password: "old password value",
    displayName: "Grace"
  });
  const normalReply = createReplyFixture();
  authService.writeSessionCookies(normalReply, registered.session);

  await assert.rejects(
    () =>
      authService.resetPassword(
        {
          cookies: normalReply.cookies
        },
        {
          password: "bypassed password value"
        }
      ),
    /Authentication required/
  );

  const resetRequest = await authService.requestPasswordReset({
    email: "grace@example.com"
  });
  assert.equal(resetRequest.ok, true);
  assert.match(resetRequest.recoveryUrl, /\/auth\/reset-password\?token=/);
  const recoveryToken = new URL(resetRequest.recoveryUrl).searchParams.get("token");

  const recovery = await authService.completePasswordRecovery({
    code: recoveryToken,
    type: "recovery"
  });
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, recovery.session);
  assert.equal(Boolean(reply.cookies.jskit_local_recovery_token), true);
  assert.equal(reply.cookieOptions.jskit_local_recovery_token.maxAge, 15 * 60);
  assert.equal(reply.cookieOptions.jskit_local_refresh_token.maxAge, 15 * 60);

  const generalSession = await authService.authenticateRequest({ cookies: reply.cookies });
  assert.equal(generalSession.authenticated, false);
  assert.equal(generalSession.clearSession, false);

  await authService.resetPassword(
    {
      cookies: reply.cookies
    },
    {
      password: "new password value"
    }
  );

  await assert.rejects(
    () =>
      authService.login({
        email: "grace@example.com",
        password: "old password value"
      }),
    /Invalid email or password/
  );
  const login = await authService.login({
    email: "grace@example.com",
    password: "new password value"
  });
  assert.equal(login.actor.email, "grace@example.com");
});

test("local auth reset invalidates other outstanding recovery tokens for the user", async () => {
  const { app } = await createStartedApp();
  const authService = app.make("authService");
  await authService.register({
    email: "multi-reset@example.com",
    password: "old password value",
    displayName: "Multi Reset"
  });

  const firstResetRequest = await authService.requestPasswordReset({
    email: "multi-reset@example.com"
  });
  const secondResetRequest = await authService.requestPasswordReset({
    email: "multi-reset@example.com"
  });
  const firstToken = new URL(firstResetRequest.recoveryUrl).searchParams.get("token");
  const secondToken = new URL(secondResetRequest.recoveryUrl).searchParams.get("token");

  const recovery = await authService.completePasswordRecovery({
    code: firstToken,
    type: "recovery"
  });
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, recovery.session);

  await authService.resetPassword(
    {
      cookies: reply.cookies
    },
    {
      password: "new password value"
    }
  );

  await assert.rejects(
    () =>
      authService.completePasswordRecovery({
        code: secondToken,
        type: "recovery"
      }),
    /Recovery token is invalid or expired/
  );
});

test("local auth provider changes password through the account-security contract", async () => {
  const { app } = await createStartedApp();
  const authService = app.make("authService");
  const registered = await authService.register({
    email: "lin@example.com",
    password: "old password value",
    displayName: "Lin"
  });
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, registered.session);

  await assert.rejects(
    () =>
      authService.changePassword(
        { cookies: reply.cookies },
        {
          currentPassword: "wrong password",
          newPassword: "new password value"
        }
      ),
    /Current password is invalid/
  );

  await authService.changePassword(
    { cookies: reply.cookies },
    {
      currentPassword: "old password value",
      newPassword: "new password value"
    }
  );

  await assert.rejects(
    () =>
      authService.login({
        email: "lin@example.com",
        password: "old password value"
      }),
    /Invalid email or password/
  );
  const login = await authService.login({
    email: "lin@example.com",
    password: "new password value"
  });
  assert.equal(login.actor.email, "lin@example.com");
});

test("local auth provider projects app profile when auth.profile.projector is installed", async () => {
  const projectedProfiles = [];
  const { app } = await createStartedApp({
    profileProjector: {
      async syncIdentityProfile(profile) {
        projectedProfiles.push(profile);
        return {
          ...profile,
          id: "app-user-1",
          profileSource: "users"
        };
      }
    }
  });
  const authService = app.make("authService");
  assert.equal(authService.getCapabilities().features.appProfileProjection, true);

  const registered = await authService.register({
    email: "projected@example.com",
    password: "projected password",
    displayName: "Projected"
  });

  assert.equal(registered.profile.id, "app-user-1");
  assert.equal(registered.actor.providerUserId, projectedProfiles[0].authProviderUserSid);
  assert.equal(registered.actor.appUserId, "app-user-1");
  assert.equal(registered.actor.profileSource, "users");
});

test("local auth provider rejects AUTH_PROVIDER mismatches", async () => {
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_PROVIDER: "supabase",
    NODE_ENV: "test"
  });

  await assert.rejects(
    () =>
      app.start({
        providers: [ActionRuntimeServiceProvider, AuthLocalServiceProvider]
      }),
    (error) => /AUTH_PROVIDER is "supabase"/.test(String(error.details?.cause?.message || error.message || ""))
  );
});

test("local auth provider requires an explicit public URL for SMTP recovery", async () => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-"));
  const app = createApplication();
  app.instance("appConfig", createAppConfigFixture());
  app.instance("jskit.env", {
    AUTH_PROVIDER: "local",
    AUTH_LOCAL_STORE_DIR: storeDir,
    AUTH_LOCAL_SMTP_HOST: "smtp.example.com",
    AUTH_LOCAL_SMTP_FROM: "support@example.com",
    NODE_ENV: "test"
  });

  await assert.rejects(
    () =>
      app.start({
        providers: [ActionRuntimeServiceProvider, AuthLocalServiceProvider]
      }),
    (error) =>
      /APP_PUBLIC_URL is required when local auth SMTP recovery is configured/.test(
        String(error.details?.cause?.message || error.message || "")
      )
  );
});

test("local file backend recovers stale transaction locks", async () => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-"));
  await fs.mkdir(storeDir, { recursive: true });
  const lockPath = path.join(storeDir, "store.lock");
  await fs.writeFile(lockPath, "0:stale\n", "utf8");
  const staleTime = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, staleTime, staleTime);

  const backend = createLocalFileBackend({ storeDir });
  await backend.withTransaction(async (tx) => {
    await tx.users.create({
      id: "usr_stale_lock",
      email: "stale-lock@example.com",
      displayName: "Stale Lock",
      password: {
        algorithm: "test",
        version: "1",
        salt: "salt",
        hash: "hash"
      }
    });
  });

  const user = await backend.withTransaction((tx) => tx.users.findByEmail("stale-lock@example.com"));
  assert.equal(user.id, "usr_stale_lock");
});

test("local file backend replays a pending multi-file transaction journal before reads", async () => {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-source-"));
  const sourceBackend = createLocalFileBackend({ storeDir: sourceDir });
  await sourceBackend.withTransaction(async (tx) => {
    await tx.users.create({
      id: "usr_journal",
      email: "journal@example.com",
      displayName: "Journal User",
      password: {
        algorithm: "test",
        version: "1",
        salt: "salt",
        hash: "hash"
      }
    });
    await tx.sessions.create({
      id: "ses_journal",
      userId: "usr_journal",
      tokenHash: "session_hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    await tx.recovery.create({
      id: "rec_journal",
      userId: "usr_journal",
      tokenHash: "recovery_hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
  });

  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-journal-"));
  const files = await Promise.all(
    ["users.passwd", "sessions.passwd", "recovery.passwd"].map(async (name) => ({
      name,
      content: Buffer.from(await fs.readFile(path.join(sourceDir, name), "utf8"), "utf8").toString("base64url")
    }))
  );
  await fs.writeFile(
    path.join(storeDir, "transaction.journal"),
    `${JSON.stringify({
      version: 1,
      files
    })}\n`,
    "utf8"
  );

  const backend = createLocalFileBackend({ storeDir });
  const recovered = await backend.withTransaction(async (tx) => ({
    user: await tx.users.findByEmail("journal@example.com"),
    session: await tx.sessions.findByTokenHash("session_hash"),
    recovery: await tx.recovery.findByTokenHash("recovery_hash")
  }));

  assert.equal(recovered.user.id, "usr_journal");
  assert.equal(recovered.session.id, "ses_journal");
  assert.equal(recovered.recovery.id, "rec_journal");
  await assert.rejects(() => fs.stat(path.join(storeDir, "transaction.journal")), { code: "ENOENT" });
});
