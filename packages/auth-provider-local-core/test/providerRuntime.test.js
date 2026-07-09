import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel/_testable";
import { ActionRuntimeServiceProvider } from "@jskit-ai/kernel/server/actions";
import { registerAuthServiceDecorator } from "@jskit-ai/auth-core/server/authServiceDecoratorRegistry";
import { AuthActionsServiceProvider } from "@jskit-ai/auth-core/server/providers/AuthActionsServiceProvider";
import { AuthLocalServiceProvider } from "../src/server/providers/AuthLocalServiceProvider.js";
import { AuthProviderServiceProvider } from "../src/server/providers/AuthProviderServiceProvider.js";
import {
  createLocalAuthRegisterHookDecorator,
  createLocalAuthService,
  createLocalFileBackend,
  hashPassword,
  normalizePasswordStrategy,
  verifyPassword
} from "../src/server/lib/index.js";

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

async function createStartedApp({
  profileProjector = null,
  profileProjectorFactory = null,
  passwordStrategy = null,
  invitationContextResolver = null,
  logger = null,
  configureApp = null
} = {}) {
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
  app.instance(
    "jskit.logger",
    logger || {
      info() {},
      warn() {},
      error() {},
      debug() {}
    }
  );
  app.instance("domainEvents", {
    async publish() {}
  });
  if (profileProjector) {
    app.instance("auth.profile.projector", profileProjector);
  }
  if (profileProjectorFactory) {
    app.singleton("auth.profile.projector", profileProjectorFactory);
  }
  if (passwordStrategy) {
    app.instance("auth.local.passwordStrategy", passwordStrategy);
  }
  if (invitationContextResolver) {
    app.instance("auth.invitationContextResolver", invitationContextResolver);
  }
  if (typeof configureApp === "function") {
    configureApp(app);
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

test("local auth provider applies auth service decorators for blocking and non-blocking hooks", async () => {
  const calls = [];
  const errors = [];
  const { app } = await createStartedApp({
    logger: {
      info() {},
      warn(payload, message) {
        errors.push({ payload, message });
      },
      error() {},
      debug() {}
    },
    configureApp(app) {
      registerAuthServiceDecorator(app, "test.auth.local.nonBlockingHook", (scope) => ({
        ...createLocalAuthRegisterHookDecorator({
          decoratorId: "test.auth.local.nonBlockingHook",
          order: 20,
          logger: scope.make("jskit.logger"),
          hook: {
            hookId: "audit",
            blocking: false,
            async handle({ actor }) {
              calls.push({ hook: "audit", email: actor.email });
              throw new Error("audit unavailable");
            }
          }
        })
      }));
      registerAuthServiceDecorator(app, "test.auth.local.blockingHook", () =>
        createLocalAuthRegisterHookDecorator({
          decoratorId: "test.auth.local.blockingHook",
          order: 10,
          hook: {
            hookId: "permissions",
            blocking: true,
            async handle({ actor, profile }) {
              calls.push({ hook: "permissions", email: actor.email });
              if (profile?.displayName === "Block Permissions") {
                throw new Error("permission provisioning failed");
              }
            }
          }
        })
      );
    }
  });
  const authService = app.make("authService");

  const registered = await authService.register({
    email: "hooks@example.com",
    password: "correct horse battery staple",
    displayName: "Hooks"
  });
  assert.equal(registered.actor.email, "hooks@example.com");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    { hook: "permissions", email: "hooks@example.com" },
    { hook: "audit", email: "hooks@example.com" }
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "Non-blocking local auth register hook failed.");

  await assert.rejects(
    () =>
      authService.register({
        email: "blocked-hooks@example.com",
        password: "correct horse battery staple",
        displayName: "Block Permissions"
      }),
    /permission provisioning failed/
  );
});

test("local auth register hook decorators require explicit blocking mode", () => {
  assert.throws(
    () =>
      createLocalAuthRegisterHookDecorator({
        hook: {
          hookId: "invalid",
          async handle() {}
        }
      }),
    /blocking to true or false/
  );
  assert.throws(
    () =>
      createLocalAuthRegisterHookDecorator({
        hook: {
          hookId: "invalid",
          blocking: false
        }
      }),
    /handle must be a function/
  );
});

test("local auth provider resolves a custom password strategy from the container", async () => {
  const passwordStrategy = {
    prefix: "strategy",
    async hashPassword(password) {
      return {
        algorithm: "test-password",
        version: "v1",
        salt: "",
        hash: `${this.prefix}-${password}`
      };
    },
    async verifyPassword(password, record) {
      return record?.algorithm === "test-password" && record?.hash === `${this.prefix}-${password}`;
    }
  };
  const { app } = await createStartedApp({ passwordStrategy });
  const authService = app.make("authService");

  await authService.register({
    email: "strategy@example.com",
    password: "strategy password value",
    displayName: "Strategy User"
  });

  const loggedIn = await authService.login({
    email: "strategy@example.com",
    password: "strategy password value"
  });

  assert.equal(loggedIn.actor.email, "strategy@example.com");
});

test("local auth password strategy supports partial overrides and rejects invalid methods", async () => {
  const strategy = normalizePasswordStrategy({
    verifyPassword(password, record) {
      return record === `legacy:${this.realm}:${password}`;
    },
    realm: "users"
  });

  const defaultHashed = await strategy.hashPassword("new password value");
  assert.equal(await verifyPassword("new password value", defaultHashed), true);
  assert.equal(await strategy.verifyPassword("old password value", "legacy:users:old password value"), true);

  const hashOnlyStrategy = normalizePasswordStrategy({
    async hashPassword(password) {
      return hashPassword(password);
    }
  });
  const hashOnlyRecord = await hashOnlyStrategy.hashPassword("hash only password");
  assert.equal(await hashOnlyStrategy.verifyPassword("hash only password", hashOnlyRecord), true);

  assert.throws(
    () => normalizePasswordStrategy("invalid"),
    /Local auth password strategy must be an object/
  );
  assert.throws(
    () => normalizePasswordStrategy(false),
    /Local auth password strategy must be an object/
  );
  assert.throws(
    () => normalizePasswordStrategy(0),
    /Local auth password strategy must be an object/
  );
  assert.throws(
    () => normalizePasswordStrategy([]),
    /Local auth password strategy must be an object/
  );
  assert.throws(
    () => normalizePasswordStrategy({ hashPassword: "invalid" }),
    /Local auth password strategy hashPassword must be a function/
  );
  assert.throws(
    () => normalizePasswordStrategy({ hashPassword: null }),
    /Local auth password strategy hashPassword must be a function/
  );
  assert.throws(
    () => normalizePasswordStrategy({ verifyPassword: "invalid" }),
    /Local auth password strategy verifyPassword must be a function/
  );
});

test("local auth login verifies password and creates session in one backend transaction", async () => {
  const password = await hashPassword("current password value");
  let transactions = 0;
  let sessionCreated = false;
  const backend = createLocalFileBackend({
    storeDir: await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-login-tx-"))
  });
  await backend.withTransaction((tx) =>
    tx.users.create({
      id: "usr_login_tx",
      email: "tx@example.com",
      displayName: "Transaction User",
      password
    })
  );
  const wrappedBackend = {
    async withTransaction(callback) {
      transactions += 1;
      return backend.withTransaction(async (tx) => {
        const result = await callback({
          ...tx,
          sessions: {
            ...tx.sessions,
            async create(input) {
              sessionCreated = true;
              return tx.sessions.create(input);
            }
          }
        });
        return result;
      });
    }
  };
  const authService = createLocalAuthService({
    backend: wrappedBackend,
    config: {
      sessionSecret: "test-secret",
      nodeEnv: "test",
      smtpConfigured: false,
      recoveryDevOutput: "response",
      appPublicUrl: "http://localhost:5173"
    }
  });

  const result = await authService.login({
    email: "tx@example.com",
    password: "current password value"
  });

  assert.equal(result.actor.email, "tx@example.com");
  assert.equal(transactions, 1);
  assert.equal(sessionCreated, true);
});

test("local auth service accepts a custom strategy for legacy stored password records", async () => {
  const passwordRecords = [];
  const sessions = [];
  const authService = createLocalAuthService({
    backend: {
      async withTransaction(callback) {
        return callback({
          users: {
            async findByEmail(email) {
              if (email !== "legacy@example.com") {
                return null;
              }
              return {
                id: "usr_legacy",
                email,
                displayName: "Legacy User",
                password: "legacy:legacy@example.com:old-password",
                disabled: false
              };
            },
            async findById(userId) {
              if (userId !== "usr_legacy") {
                return null;
              }
              return {
                id: "usr_legacy",
                email: "legacy@example.com",
                displayName: "Legacy User",
                password: passwordRecords.at(-1) || "legacy:legacy@example.com:old-password",
                disabled: false
              };
            },
            async create(input) {
              passwordRecords.push(input.password);
              return input;
            },
            async updatePassword(_userId, password) {
              passwordRecords.push(password);
              return {
                id: "usr_legacy",
                email: "legacy@example.com",
                displayName: "Legacy User",
                password,
                disabled: false
              };
            },
            async updateProfile() {
              throw new Error("not needed");
            }
          },
          sessions: {
            async create(input) {
              sessions.push(input);
              return {
                ...input,
                createdAt: new Date().toISOString(),
                revokedAt: ""
              };
            },
            async findById() {
              return null;
            },
            async findByTokenHash() {
              return null;
            },
            async revoke() {
              return null;
            },
            async revokeForUser() {
              return 0;
            }
          },
          recovery: {
            async create() {},
            async findByTokenHash() {
              return null;
            },
            async consume() {
              return null;
            },
            async consumeForUser() {
              return 0;
            }
          }
        });
      }
    },
    config: {
      sessionSecret: "test-secret",
      nodeEnv: "test",
      smtpConfigured: false,
      recoveryDevOutput: "response",
      appPublicUrl: "http://localhost:5173"
    },
    passwordStrategy: {
      async verifyPassword(password, record) {
        return record === `legacy:legacy@example.com:${password}`;
      }
    }
  });

  const legacyLogin = await authService.login({
    email: "legacy@example.com",
    password: "old-password"
  });
  assert.equal(legacyLogin.actor.providerUserId, "usr_legacy");
  assert.equal(sessions.length, 1);

  await authService.register({
    email: "new@example.com",
    password: "new-password",
    displayName: "New User"
  });
  assert.equal(passwordRecords.length, 1);
  assert.equal(passwordRecords[0].algorithm, "scrypt");
  assert.equal(sessions.length, 2);
});

test("local auth password strategy handles register, reset, login, and change password paths", async () => {
  const hashCalls = [];
  const verifyCalls = [];
  const encodePassword = (password) => Buffer.from(String(password), "utf8").toString("base64url");
  const passwordStrategy = {
    async hashPassword(password) {
      hashCalls.push(password);
      return {
        algorithm: "strategy-password",
        version: "v1",
        salt: "",
        hash: encodePassword(password)
      };
    },
    async verifyPassword(password, record) {
      verifyCalls.push({
        password,
        hash: record?.hash || ""
      });
      return (
        record?.algorithm === "strategy-password" &&
        record.hash === encodePassword(password)
      );
    }
  };
  const { app } = await createStartedApp({ passwordStrategy });
  const authService = app.make("authService");

  await authService.register({
    email: "strategy-paths@example.com",
    password: "original password value",
    displayName: "Strategy Paths"
  });
  await authService.login({
    email: "strategy-paths@example.com",
    password: "original password value"
  });

  const resetRequest = await authService.requestPasswordReset({
    email: "strategy-paths@example.com"
  });
  const recoveryToken = new URL(resetRequest.recoveryUrl).searchParams.get("token");
  const recovery = await authService.completePasswordRecovery({
    code: recoveryToken,
    type: "recovery"
  });
  const recoveryReply = createReplyFixture();
  authService.writeSessionCookies(recoveryReply, recovery.session);
  await authService.resetPassword(
    {
      cookies: recoveryReply.cookies
    },
    {
      password: "reset password value"
    }
  );

  const resetLogin = await authService.login({
    email: "strategy-paths@example.com",
    password: "reset password value"
  });
  const normalReply = createReplyFixture();
  authService.writeSessionCookies(normalReply, resetLogin.session);
  await authService.changePassword(
    {
      cookies: normalReply.cookies
    },
    {
      currentPassword: "reset password value",
      newPassword: "changed password value"
    }
  );
  await authService.login({
    email: "strategy-paths@example.com",
    password: "changed password value"
  });

  assert.deepEqual(hashCalls, [
    "original password value",
    "reset password value",
    "changed password value"
  ]);
  assert.deepEqual(verifyCalls.map((call) => call.password), [
    "original password value",
    "reset password value",
    "reset password value",
    "changed password value"
  ]);
});

test("local auth provider completes recovery through a recovery-scoped session", async () => {
  const { app } = await createStartedApp();
  const authService = app.make("authService");
  await authService.register({
    email: "Recovery@example.com",
    password: "correct horse battery staple",
    displayName: "Recovery User"
  });

  const normalReply = createReplyFixture();
  const normalLogin = await authService.login({
    email: "recovery@example.com",
    password: "correct horse battery staple"
  });
  authService.writeSessionCookies(normalReply, normalLogin.session);
  normalReply.cookies.jskit_local_recovery_token = normalReply.cookies.jskit_local_access_token;
  await assert.rejects(
    () =>
      authService.resetPassword(
        {
          cookies: normalReply.cookies
        },
        {
          password: "not allowed value"
        }
      ),
    /Recovery session required/
  );

  const resetRequest = await authService.requestPasswordReset({
    email: "recovery@example.com"
  });
  assert.match(resetRequest.recoveryUrl, /^http:\/\/localhost:5173\/auth\/reset-password\?/);
  const token = new URL(resetRequest.recoveryUrl).searchParams.get("token");
  const recovery = await authService.completePasswordRecovery({
    code: token,
    type: "recovery"
  });
  assert.equal(recovery.actor.email, "recovery@example.com");

  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, recovery.session);
  assert.equal(Boolean(reply.cookies.jskit_local_recovery_token), true);
  assert.equal(Boolean(reply.cookies.jskit_local_refresh_token), true);

  const generalSession = await authService.authenticateRequest({ cookies: reply.cookies });
  assert.equal(generalSession.authenticated, false);
  assert.equal(generalSession.clearSession, false);

  await authService.resetPassword(
    {
      cookies: reply.cookies
    },
    {
      password: "updated password value"
    }
  );

  await assert.rejects(
    () =>
      authService.login({
        email: "recovery@example.com",
        password: "correct horse battery staple"
      }),
    /Invalid email or password/
  );
  const login = await authService.login({
    email: "recovery@example.com",
    password: "updated password value"
  });
  assert.equal(login.actor.email, "recovery@example.com");
});

test("local auth reset invalidates other outstanding recovery tokens for the user", async () => {
  const { app } = await createStartedApp();
  const authService = app.make("authService");
  await authService.register({
    email: "recovery-tokens@example.com",
    password: "correct horse battery staple",
    displayName: "Recovery Tokens"
  });

  const firstResetRequest = await authService.requestPasswordReset({
    email: "recovery-tokens@example.com"
  });
  const secondResetRequest = await authService.requestPasswordReset({
    email: "recovery-tokens@example.com"
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
      password: "updated password value"
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
    email: "Security@example.com",
    password: "correct horse battery staple",
    displayName: "Security User"
  });
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, registered.session);

  await assert.rejects(
    () =>
      authService.changePassword(
        {
          cookies: reply.cookies
        },
        {
          currentPassword: "wrong password value",
          newPassword: "updated password value"
        }
      ),
    /Current password is invalid/
  );

  await authService.changePassword(
    {
      cookies: reply.cookies
    },
    {
      currentPassword: "correct horse battery staple",
      newPassword: "updated password value"
    }
  );

  await assert.rejects(
    () =>
      authService.login({
        email: "security@example.com",
        password: "correct horse battery staple"
      }),
    /Invalid email or password/
  );
  const login = await authService.login({
    email: "security@example.com",
    password: "updated password value"
  });
  assert.equal(login.actor.email, "security@example.com");
});

test("local auth provider defers profile projector resolution until projection is needed", async () => {
  let projectorFactoryCalls = 0;
  const { app } = await createStartedApp({
    profileProjectorFactory() {
      projectorFactoryCalls += 1;
      return {
        async syncIdentityProfile(profile) {
          return {
            ...profile,
            id: "projected-user",
            profileSource: "users"
          };
        }
      };
    }
  });
  assert.equal(projectorFactoryCalls, 0);
  const authService = app.make("authService");
  assert.equal(projectorFactoryCalls, 0);
  const registered = await authService.register({
    email: "projected@example.com",
    password: "correct horse battery staple",
    displayName: "Projected User"
  });
  assert.equal(projectorFactoryCalls, 1);
  assert.equal(registered.actor.appUserId, "projected-user");
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

test("local auth provider passes resolved invitation context into profile projection during registration", async () => {
  const resolverCalls = [];
  const projectionCalls = [];
  const { app } = await createStartedApp({
    invitationContextResolver: {
      async resolveInvitationContext(invitation) {
        resolverCalls.push(invitation);
        return {
          token: invitation.token,
          workspaceId: "workspace-7",
          workspaceSlug: "acme",
          workspaceName: "Acme",
          email: invitation.email,
          roleSid: "member",
          expiresAt: "2030-01-01T00:00:00.000Z"
        };
      }
    },
    profileProjector: {
      async syncIdentityProfile(profile, options) {
        projectionCalls.push({ profile, options });
        return {
          ...profile,
          id: "invited-app-user",
          profileSource: "users"
        };
      }
    }
  });
  const authService = app.make("authService");

  const registered = await authService.register({
    email: "Invitee@Example.com",
    password: "invited password",
    displayName: "Invited",
    invitation: {
      token: "invite-token",
      source: "workspace-invite"
    }
  });

  assert.deepEqual(resolverCalls, [
    {
      token: "invite-token",
      source: "workspace-invite",
      email: "invitee@example.com"
    }
  ]);
  assert.equal(projectionCalls.length, 1);
  assert.equal(projectionCalls[0].profile.email, "invitee@example.com");
  assert.deepEqual(projectionCalls[0].options, {
    source: "workspace-invite",
    invitation: {
      token: "invite-token",
      workspaceId: "workspace-7",
      workspaceSlug: "acme",
      workspaceName: "Acme",
      email: "invitee@example.com",
      roleSid: "member",
      expiresAt: "2030-01-01T00:00:00.000Z"
    }
  });
  assert.equal(registered.actor.appUserId, "invited-app-user");
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
