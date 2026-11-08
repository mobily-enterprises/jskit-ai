import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { DEV_AUTH_SECRET_HEADER } from "@jskit-ai/auth-core/server/devAuth";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { AuthLocalProvider } from "../src/server/providers/AuthLocalProvider.js";
import { localServiceOptions } from "../test-support/localService.js";
import {
  createLocalAuthRegisterHookDecorator,
  createLocalAuthService,
  createLocalFileBackend,
  hashPassword,
  normalizePasswordStrategy,
  verifyPassword
} from "../src/server/lib/index.js";

const DEV_AUTH_SECRET = "local-preview-exchange-secret";
const temporaryStoreDirs = [];

async function temporaryStoreDir(prefix) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryStoreDirs.push(storeDir);
  return storeDir;
}

test.after(() => Promise.all(temporaryStoreDirs.map((storeDir) => fs.rm(storeDir, { recursive: true, force: true }))));

// The setup code a production server without accounts asks its first registration for.
async function firstAccountSetupCode(storeDir) {
  return (await fs.readFile(path.join(storeDir, "first-account-setup-code"), "utf8")).trim();
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

function createLocalAuthRequest({
  cookies = {},
  headers = {},
  host = "localhost:4100",
  remoteAddress = "127.0.0.1"
} = {}) {
  return {
    cookies,
    headers: {
      host,
      ...headers
    },
    socket: {
      remoteAddress
    }
  };
}

function createDevAuthExchangeRequest(options = {}) {
  const request = createLocalAuthRequest(options);
  return {
    ...request,
    headers: {
      ...request.headers,
      [DEV_AUTH_SECRET_HEADER]: DEV_AUTH_SECRET
    }
  };
}

function devAuthEnv() {
  return {
    AUTH_DEV_BYPASS_ENABLED: "true",
    AUTH_DEV_BYPASS_SECRET: DEV_AUTH_SECRET
  };
}

async function createStartedApp({
  env = {},
  profileProjector = null,
  passwordStrategy = null,
  recoverySender = null,
  confirmationSender = null,
  invitationContextResolver = null,
  logger = null,
  configureExtensions = null
} = {}) {
  const storeDir = await temporaryStoreDir("jskit-auth-local-");
  const backend = createLocalFileBackend({ storeDir });
  const extensions = createAuthExtensions();
  const runtimeLogger = logger || {
    info() {},
    warn() {},
    error() {},
    debug() {}
  };
  if (typeof configureExtensions === "function") configureExtensions(extensions, runtimeLogger);
  if (invitationContextResolver) {
    extensions.registerInvitationContextResolver({
      resolverId: "test.invitation",
      ...invitationContextResolver
    });
  }
  let authService = null;
  let actionExecutor = null;
  const probe = defineProvider({
    id: "test.auth.probe",
    requires: {
      actions: "runtime.actions",
      service: "auth.service"
    },
    setup({ actions, service }) {
      actionExecutor = actions;
      authService = service;
      return {};
    }
  });
  const inputs = {
    "runtime.app-root": storeDir,
    "runtime.env": {
    AUTH_LOCAL_STORE_DIR: storeDir,
    AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "response",
    APP_PUBLIC_URL: "http://localhost:5173",
    // Registration signs in at once here; the email confirmation tests turn confirmation on.
    AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
    NODE_ENV: "test",
    ...env
    },
    "runtime.logger": runtimeLogger,
    "auth.extensions": extensions,
    "auth.local.backend": backend,
    ...(profileProjector ? { "auth.profile.projector": profileProjector } : {}),
    ...(passwordStrategy ? { "auth.local.password-strategy": passwordStrategy } : {}),
    ...(recoverySender !== null ? { "auth.local.recovery-sender": recoverySender } : {}),
    ...(confirmationSender !== null ? { "auth.local.confirmation-sender": confirmationSender } : {}),
  };
  const runtime = createCapabilityRuntime({
    inputs,
    providers: [
      EventProvider, ActionProvider,
      AuthLocalProvider,
      AuthFeature,
      probe
    ]
  });
  await runtime.start();
  return {
    actionExecutor,
    authService,
    backend,
    runtime,
    storeDir
  };
}

test("local auth provider registers, logs in, reads session, and logs out with file backend", async () => {
  const { actionExecutor, authService, storeDir } = await createStartedApp();
  const capabilities = authService.getCapabilities();
  assert.equal(capabilities.provider.id, "local");
  assert.equal(capabilities.features.password.login, true);
  assert.equal(capabilities.features.oauthLogin.enabled, false);

  const registered = await authService.register({
    email: "Ada@example.com",
    password: "correct horse battery staple",
    displayName: "Ada"
  });
  assert.equal(registered.actor.email, "ada@example.com");
  assert.equal(registered.actor.provider, "local");
  assert.equal(registered.requiresEmailConfirmation, false);

  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, registered.session);
  assert.equal(Boolean(reply.cookies.jskit_local_access_token), true);
  assert.equal(Boolean(reply.cookies.jskit_local_refresh_token), true);

  const session = await authService.authenticateRequest({ cookies: reply.cookies });
  assert.equal(session.authenticated, true);
  assert.equal(session.actor.email, "ada@example.com");

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

test("local file auth login-as issues native cookies for an existing user", async () => {
  const { authService } = await createStartedApp({
    env: devAuthEnv()
  });
  await authService.register({
    displayName: "Ada",
    email: "ada@example.com",
    password: "correct horse battery staple"
  });

  const impersonated = await authService.devLoginAs({
    email: "ADA@EXAMPLE.COM"
  }, createDevAuthExchangeRequest());
  assert.equal(impersonated.actor.email, "ada@example.com");
  assert.equal(impersonated.session.purpose, "dev-auth");
  assert.equal(authService.getCapabilities().features.devLoginAs, true);

  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, impersonated.session);
  assert.equal(Boolean(reply.cookies.jskit_local_access_token), true);
  assert.equal(Boolean(reply.cookies.jskit_local_refresh_token), true);

  const authenticated = await authService.authenticateRequest(createLocalAuthRequest({
    cookies: reply.cookies
  }));
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.actor.email, "ada@example.com");
  assert.equal(authenticated.sessionPurpose, "dev-auth");
});

test("local login-as never invokes the mutating profile projector", async () => {
  const projectedProfile = {
    id: "app-user-ada",
    authProvider: "local",
    authProviderUserSid: "provider-user-ada",
    displayName: "Ada",
    email: "ada@example.com"
  };
  let findCalls = 0;
  let syncCalls = 0;
  const { authService } = await createStartedApp({
    env: devAuthEnv(),
    profileProjector: {
      async findByIdentity() {
        findCalls += 1;
        return projectedProfile;
      },
      async syncIdentityProfile(profile) {
        syncCalls += 1;
        return {
          ...projectedProfile,
          authProviderUserSid: profile.authProviderUserSid
        };
      }
    }
  });
  const registered = await authService.register({
    displayName: "Ada",
    email: "ada@example.com",
    password: "correct horse battery staple"
  });
  projectedProfile.authProviderUserSid = registered.actor.providerUserId;
  findCalls = 0;
  syncCalls = 0;

  const impersonated = await authService.devLoginAs({
    email: "ada@example.com"
  }, createDevAuthExchangeRequest());
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, impersonated.session);
  const authenticated = await authService.authenticateRequest(createLocalAuthRequest({
    cookies: reply.cookies
  }));

  assert.equal(impersonated.actor.id, "app-user-ada");
  assert.equal(authenticated.actor.id, "app-user-ada");
  assert.equal(findCalls, 2);
  assert.equal(syncCalls, 0);
});

test("local authentication without profile sync reads the existing profile", async () => {
  const projectedProfile = {
    id: "app-user-ada",
    authProvider: "local",
    authProviderUserSid: "",
    displayName: "Ada",
    email: "ada@example.com"
  };
  let existingProfile = projectedProfile;
  let syncCalls = 0;
  const { authService } = await createStartedApp({
    profileProjector: {
      async findByIdentity() {
        return existingProfile;
      },
      async syncIdentityProfile(profile) {
        syncCalls += 1;
        return { ...projectedProfile, authProviderUserSid: profile.authProviderUserSid };
      }
    }
  });
  const registered = await authService.register({
    displayName: "Ada",
    email: "ada@example.com",
    password: "correct horse battery staple"
  });
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, registered.session);
  const signedIn = createLocalAuthRequest({ cookies: reply.cookies });
  const refreshOnly = createLocalAuthRequest({
    cookies: { jskit_local_refresh_token: reply.cookies.jskit_local_refresh_token }
  });
  syncCalls = 0;

  for (const request of [signedIn, refreshOnly]) {
    const checked = await authService.authenticateRequest(request, { syncProfile: false });
    assert.equal(checked.authenticated, true);
    assert.equal(checked.actor.id, "app-user-ada");
  }
  assert.equal(syncCalls, 0);

  existingProfile = null;
  const unprojected = await authService.authenticateRequest(signedIn, { syncProfile: false });
  assert.equal(unprojected.authenticated, false, "A login without an app profile is not signed in without sync");
  assert.equal((await authService.authenticateRequest(signedIn)).actor.id, "app-user-ada");
  assert.equal(syncCalls, 1);
});

test("local login-as rejects missing, disabled, and unprojected users", async () => {
  const { authService, backend } = await createStartedApp({
    env: devAuthEnv(),
    profileProjector: {
      async findByIdentity() {
        return null;
      },
      async syncIdentityProfile() {
        throw new Error("preview login must not synchronize profiles");
      }
    }
  });
  const password = await hashPassword("stored password value");
  await backend.withTransaction(async (tx) => {
    await tx.users.create({
      disabled: false,
      displayName: "Unprojected",
      email: "unprojected@example.com",
      id: "usr_unprojected",
      password
    });
    await tx.users.create({
      disabled: true,
      displayName: "Disabled",
      email: "disabled@example.com",
      id: "usr_disabled",
      password
    });
  });

  for (const email of [
    "missing@example.com",
    "disabled@example.com",
    "unprojected@example.com"
  ]) {
    await assert.rejects(
      () => authService.devLoginAs({ email }, createDevAuthExchangeRequest()),
      /User not found/
    );
  }
});

test("local login-as rejects missing, incorrect, and non-loopback exchange authorization", async () => {
  const { authService } = await createStartedApp({
    env: devAuthEnv()
  });
  await authService.register({
    displayName: "Ada",
    email: "ada@example.com",
    password: "correct horse battery staple"
  });

  await assert.rejects(
    () => authService.devLoginAs({ email: "ada@example.com" }, createLocalAuthRequest()),
    /not authorized/
  );
  await assert.rejects(
    () => authService.devLoginAs({ email: "ada@example.com" }, createLocalAuthRequest({
      headers: {
        [DEV_AUTH_SECRET_HEADER]: "wrong-secret"
      }
    })),
    /not authorized/
  );
  await assert.rejects(
    () => authService.devLoginAs({ email: "ada@example.com" }, createDevAuthExchangeRequest({
      remoteAddress: "203.0.113.5"
    })),
    /localhost/
  );
});

test("local auth provider rejects dev login-as enablement in production", async () => {
  await assert.rejects(
    () => createStartedApp({
      env: {
        ...devAuthEnv(),
        AUTH_LOCAL_FILE_PRODUCTION_ACK: "true",
        AUTH_LOCAL_SESSION_SECRET: "production-session-secret",
        AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "",
        NODE_ENV: "production"
      }
    }),
    (error) => /must not be enabled in production/.test(
      String(error.details?.cause?.message || error.message || "")
    )
  );
});

test("a production server with AUTH_LOCAL_RECOVERY_DEV_OUTPUT set refuses to start, saying what to remove", async () => {
  await assert.rejects(
    () => createStartedApp({
      env: {
        AUTH_LOCAL_FILE_PRODUCTION_ACK: "true",
        AUTH_LOCAL_SESSION_SECRET: "production-session-secret",
        AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "log",
        NODE_ENV: "production"
      }
    }),
    (error) => String(error.details?.cause?.message || error.message || "") ===
      "AUTH_LOCAL_RECOVERY_DEV_OUTPUT is for development only and NODE_ENV is production. " +
        "Remove it from the production environment."
  );
});

test("local auth provider applies auth service decorators for blocking and non-blocking hooks", async () => {
  const calls = [];
  const errors = [];
  const { authService } = await createStartedApp({
    logger: {
      info() {},
      warn(payload, message) {
        errors.push({ payload, message });
      },
      error() {},
      debug() {}
    },
    configureExtensions(extensions, runtimeLogger) {
      extensions.registerServiceDecorator(createLocalAuthRegisterHookDecorator({
          decoratorId: "test.auth.local.nonBlockingHook",
          order: 20,
          logger: runtimeLogger,
          hook: {
            hookId: "audit",
            blocking: false,
            async handle({ actor }) {
              calls.push({ hook: "audit", email: actor.email });
              throw new Error("audit unavailable");
            }
          }
        }));
      extensions.registerServiceDecorator(createLocalAuthRegisterHookDecorator({
          decoratorId: "test.auth.local.blockingHook",
          order: 10,
          logger: runtimeLogger,
          hook: {
            hookId: "permissions",
            blocking: true,
            async handle({ actor }) {
              calls.push({ hook: "permissions", email: actor.email });
              if (actor.displayName === "Block Permissions") {
                throw new Error("permission provisioning failed");
              }
            }
          }
        }));
    }
  });

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
        logger: silentLogger,
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
        logger: silentLogger,
        hook: {
          hookId: "invalid",
          blocking: false
        }
      }),
    /handle must be a function/
  );
});

test("local auth register hook decorators require a logger for failed non-blocking hooks", () => {
  assert.throws(
    () =>
      createLocalAuthRegisterHookDecorator({
        hook: {
          hookId: "audit",
          blocking: false,
          async handle() {}
        }
      }),
    /createLocalAuthRegisterHookDecorator requires a logger/
  );
});

test("local auth provider accepts a custom password strategy capability", async () => {
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
  const { authService } = await createStartedApp({ passwordStrategy });

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
      return record === `custom:${this.realm}:${password}`;
    },
    realm: "users"
  });

  const defaultHashed = await strategy.hashPassword("new password value");
  assert.equal(await verifyPassword("new password value", defaultHashed), true);
  assert.equal(await strategy.verifyPassword("stored password value", "custom:users:stored password value"), true);

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

test("the file backend refuses a second account with an id or email with a coded conflict", async () => {
  const backend = createLocalFileBackend({ storeDir: await temporaryStoreDir("jskit-auth-duplicate-") });
  const account = (id, email) => backend.withTransaction((tx) => tx.users.create({ id, email, displayName: "Ada", password: "hash" }));
  await account("usr_first", "ada@example.com");
  const conflict = { status: 409, code: "auth.local.accounts.exists", message: "An account with this id or email already exists." };
  await assert.rejects(account("usr_second", "ada@example.com"), conflict);
  await assert.rejects(account("usr_first", "other@example.com"), conflict);
});

test("local auth login verifies password and creates session in one backend transaction", async () => {
  const password = await hashPassword("current password value");
  let transactions = 0;
  let sessionCreated = false;
  const backend = createLocalFileBackend({
    storeDir: await temporaryStoreDir("jskit-auth-login-tx-")
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
    ...localServiceOptions(),
    backend: wrappedBackend
  });

  const result = await authService.login({
    email: "tx@example.com",
    password: "current password value"
  });

  assert.equal(result.actor.email, "tx@example.com");
  assert.equal(transactions, 1);
  assert.equal(sessionCreated, true);
});

test("local auth service accepts a custom stored-password format", async () => {
  const passwordRecords = [];
  const sessions = [];
  const authService = createLocalAuthService({
    ...localServiceOptions(),
    backend: {
      async withTransaction(callback) {
        return callback({
          users: {
            // The first-account check reads this at the first registration, in development too.
            async hasAny() {
              return true;
            },
            async findByEmail(email) {
              if (email !== "existing@example.com") {
                return null;
              }
              return {
                id: "usr_existing",
                email,
                displayName: "Existing User",
                password: "custom:existing@example.com:stored-password",
                disabled: false
              };
            },
            async findById(userId) {
              if (userId !== "usr_existing") {
                return null;
              }
              return {
                id: "usr_existing",
                email: "existing@example.com",
                displayName: "Existing User",
                password: passwordRecords.at(-1) || "custom:existing@example.com:stored-password",
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
                id: "usr_existing",
                email: "existing@example.com",
                displayName: "Existing User",
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
          },
          signInFailures: {
            async find() {
              return null;
            },
            async save(record) {
              return record;
            },
            async clear() {
              return 0;
            },
            async deleteBefore() {
              return 0;
            }
          }
        });
      }
    },
    passwordStrategy: {
      async verifyPassword(password, record) {
        return record === `custom:existing@example.com:${password}`;
      }
    }
  });

  const existingLogin = await authService.login({
    email: "existing@example.com",
    password: "stored-password"
  });
  assert.equal(existingLogin.actor.providerUserId, "usr_existing");
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
  const { authService } = await createStartedApp({ passwordStrategy });

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
      password: "reset password value"
    },
    {
      cookies: recoveryReply.cookies
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
  const { authService } = await createStartedApp();
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
          password: "not allowed value"
        },
        {
          cookies: normalReply.cookies
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
      password: "updated password value"
    },
    {
      cookies: reply.cookies
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
  const { authService } = await createStartedApp();
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
      password: "updated password value"
    },
    {
      cookies: reply.cookies
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
  const { authService } = await createStartedApp();
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

test("local auth provider projects app profile when auth.profile.projector is installed", async () => {
  const projectedProfiles = [];
  const { authService } = await createStartedApp({
    profileProjector: {
      async findByIdentity() {
        return null;
      },
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
  assert.equal(authService.getCapabilities().features.appProfileProjection, true);

  const registered = await authService.register({
    email: "projected@example.com",
    password: "projected password",
    displayName: "Projected"
  });

  assert.equal(registered.actor.id, "app-user-1");
  assert.equal(registered.actor.providerUserId, projectedProfiles[0].authProviderUserSid);
  assert.equal(registered.actor.appUserId, "app-user-1");
  assert.equal(registered.actor.profileSource, "users");
});

test("local auth provider passes resolved invitation context into profile projection during registration", async () => {
  const resolverCalls = [];
  const projectionCalls = [];
  const { authService } = await createStartedApp({
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
      async findByIdentity() {
        return null;
      },
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

test("local auth provider requires an explicit public URL for email recovery", async () => {
  await assert.rejects(
    () => createStartedApp({
      env: { APP_PUBLIC_URL: "" },
      recoverySender: async () => {}
    }),
    /APP_PUBLIC_URL is required when local auth email recovery is configured/
  );
});

// The file backend waits 25 ms between attempts at a held lock.
function lockWaits(t) {
  const setTimeoutSpy = t.mock.method(globalThis, "setTimeout");
  return () => setTimeoutSpy.mock.calls.filter((call) => call.arguments[1] === 25).length;
}

test("local file backend recovers stale transaction locks", async (t) => {
  const waits = lockWaits(t);
  const storeDir = await temporaryStoreDir("jskit-auth-local-");
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
  assert.equal(waits(), 0, "A crashed holder's lock is taken over without waiting");
});

// The bound only turns a regression (the second transaction neither waiting nor running) into a failure, not a hang.
test("local file backend never takes over a lock whose process is alive, however old", { timeout: 10_000 }, async (t) => {
  const waits = lockWaits(t);
  const storeDir = await temporaryStoreDir("jskit-auth-local-live-");
  const lockPath = path.join(storeDir, "store.lock");
  const backend = createLocalFileBackend({ storeDir });
  const order = [];
  let second;
  await backend.withTransaction(async () => {
    // This process holds the lock; make it look as old as a crashed one.
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, old, old);
    second = backend.withTransaction(async () => {
      order.push("second");
    });
    while (waits() === 0 && order.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    order.push("first");
  });
  await second;
  assert.deepEqual(order, ["first", "second"]);
});

test("local file backend replays a pending multi-file transaction journal before reads", async () => {
  const sourceDir = await temporaryStoreDir("jskit-auth-local-source-");
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

  const storeDir = await temporaryStoreDir("jskit-auth-local-journal-");
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

test("a production server without accounts refuses a first registration without its setup code", async () => {
  const app = await createStartedApp({
    env: { NODE_ENV: "production", AUTH_LOCAL_SESSION_SECRET: "fixture-session-secret", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" }
  });
  assert.equal(app.authService.getCapabilities().features.firstAccountSetupCode, true);
  await assert.rejects(
    () => app.authService.register({ email: "first@example.com", password: "correct horse battery staple" }),
    { status: 403, code: "auth.local.setup.codeRequired" }
  );
  const owner = await app.authService.register({
    email: "first@example.com",
    password: "correct horse battery staple",
    setupCode: await firstAccountSetupCode(app.storeDir)
  });
  assert.equal(owner.actor.email, "first@example.com");
  assert.equal(app.authService.getCapabilities().features.firstAccountSetupCode, false);
});

test("production sessions use host-only __Host- cookies and ignore the old names", async (t) => {
  const app = await createStartedApp({
    env: { NODE_ENV: "production", AUTH_LOCAL_SESSION_SECRET: "fixture-session-secret", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" }
  });
  t.after(() => fs.rm(app.storeDir, { recursive: true, force: true }));
  const registered = await app.authService.register({
    email: "host@example.com",
    password: "correct horse battery staple",
    setupCode: await firstAccountSetupCode(app.storeDir)
  });
  const reply = createReplyFixture();
  app.authService.writeSessionCookies(reply, registered.session);
  assert.deepEqual(Object.keys(reply.cookies).sort(), ["__Host-jskit_local_access_token", "__Host-jskit_local_refresh_token"]);
  for (const options of Object.values(reply.cookieOptions)) {
    assert.equal(options.secure, true);
    assert.equal(options.path, "/");
    assert.equal(options.domain, undefined);
  }
  assert.equal((await app.authService.authenticateRequest({ cookies: reply.cookies })).authenticated, true);
  const oldNames = {
    jskit_local_access_token: reply.cookies["__Host-jskit_local_access_token"],
    jskit_local_refresh_token: reply.cookies["__Host-jskit_local_refresh_token"]
  };
  assert.equal((await app.authService.authenticateRequest({ cookies: oldNames })).authenticated, false);
});

test("local recovery uses the application sender without returning or logging its token", async (t) => {
  const messages = [];
  const logs = [];
  const app = await createStartedApp({
    env: { NODE_ENV: "production", AUTH_LOCAL_SESSION_SECRET: "fixture-session-secret", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" },
    recoverySender: async (message) => { messages.push(message); },
    logger: { info: (...args) => logs.push(args), warn() {}, error() {}, debug() {} }
  });
  t.after(() => fs.rm(app.storeDir, { recursive: true, force: true }));
  await app.authService.register({
    email: "sender@example.com",
    password: "correct horse battery staple",
    setupCode: await firstAccountSetupCode(app.storeDir)
  });
  assert.equal(app.authService.getCapabilities().features.passwordRecovery.delivery, "email");
  const result = await app.authService.requestPasswordReset({ email: "sender@example.com" });
  assert.equal(result.recoveryUrl, undefined);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].email, "sender@example.com");
  assert.match(messages[0].recoveryUrl, /^http:\/\/localhost:5173\/auth\/reset-password\?/);
  assert.equal(JSON.stringify(logs).includes(messages[0].recoveryUrl), false);
  const unknown = await app.authService.requestPasswordReset({ email: "absent@example.com" });
  assert.deepEqual(unknown, result);
  assert.equal(messages.length, 1);
  const token = new URL(messages[0].recoveryUrl).searchParams.get("token");
  const recovery = await app.authService.completePasswordRecovery({ code: token, type: "recovery" });
  assert.equal(recovery.actor.email, "sender@example.com");
});

test("a failing recovery sender does not fall back to development output", async (t) => {
  const logs = [];
  const failure = new Error("delivery unavailable");
  const app = await createStartedApp({
    env: { AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "log" },
    recoverySender: async () => { throw failure; },
    logger: { info: (...args) => logs.push(args), warn() {}, error() {}, debug() {} }
  });
  t.after(() => fs.rm(app.storeDir, { recursive: true, force: true }));
  await app.authService.register({ email: "failure@example.com", password: "correct horse battery staple" });
  await assert.rejects(app.authService.requestPasswordReset({ email: "failure@example.com" }), failure);
  assert.equal(logs.some((args) => JSON.stringify(args).includes("recoveryUrl")), false);
});

test("in production, email confirmation needs an auth.local.confirmation-sender, or startup stops saying what to do", async () => {
  const production = {
    NODE_ENV: "production",
    AUTH_LOCAL_SESSION_SECRET: "fixture-session-secret",
    AUTH_LOCAL_FILE_PRODUCTION_ACK: "true",
    AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "",
    AUTH_LOCAL_EMAIL_CONFIRMATION: ""
  };
  await assert.rejects(
    () => createStartedApp({ env: production }),
    (error) => String(error.details?.cause?.message || error.message || "") ===
      "Local auth confirms each new account's email address in production, and no auth.local.confirmation-sender " +
        "is installed to email the confirmation links. Install one, set AUTH_LOCAL_EMAIL_CONFIRMATION=false " +
        "to let accounts register without confirming their email, or set AUTH_LOCAL_SELF_REGISTRATION=false " +
        "when accounts are only invited."
  );
  const optedOut = await createStartedApp({ env: { ...production, AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } });
  assert.equal(optedOut.authService.getCapabilities().features.emailConfirmation, false);
});

// Confirmation guards self-registration, so an app whose accounts are only invited (or made by the first account)
// starts in production without a confirmation sender: anyone else's registration is refused.
test("with AUTH_LOCAL_SELF_REGISTRATION=false, production starts without a confirmation sender and only invitations register", async (t) => {
  const app = await createStartedApp({
    env: {
      NODE_ENV: "production",
      AUTH_LOCAL_SESSION_SECRET: "fixture-session-secret",
      AUTH_LOCAL_FILE_PRODUCTION_ACK: "true",
      AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "",
      AUTH_LOCAL_EMAIL_CONFIRMATION: "",
      AUTH_LOCAL_SELF_REGISTRATION: "false"
    },
    invitationContextResolver: {
      async resolveInvitationContext({ token, email }) {
        return token === "invite-for-bea" && email === "bea@example.com" ? { token, source: "test-invite" } : null;
      }
    }
  });
  t.after(() => fs.rm(app.storeDir, { recursive: true, force: true }));
  assert.equal(app.authService.getCapabilities().features.emailConfirmation, false);
  // Until the first account exists, its registration is offered; then only an invited person's.
  const password = () => app.authService.getCapabilities().features.password;
  assert.deepEqual([password().register, password().selfRegister], [true, true]);
  // The first account registers with its setup code.
  const owner = await app.authService.register({
    email: "owner@example.com",
    password: "correct horse battery staple",
    setupCode: await firstAccountSetupCode(app.storeDir)
  });
  assert.equal(owner.actor.email, "owner@example.com");
  assert.deepEqual([password().register, password().selfRegister], [true, false]);
  const closed = { status: 403, code: "auth.local.register.closed" };
  await assert.rejects(() => app.authService.register({ email: "eve@example.com", password: "correct horse battery staple" }), closed);
  await assert.rejects(() => app.authService.register({
    email: "eve@example.com",
    password: "correct horse battery staple",
    invitation: { token: "invite-for-bea" }
  }), closed);
  const invited = await app.authService.register({
    email: "bea@example.com",
    password: "correct horse battery staple",
    invitation: { token: "invite-for-bea" }
  });
  assert.equal(invited.actor.email, "bea@example.com");
  assert.equal(invited.requiresEmailConfirmation, false);
});

test("in development with AUTH_LOCAL_SELF_REGISTRATION=false, the first account's registration is offered until it exists", async (t) => {
  const app = await createStartedApp({ env: { AUTH_LOCAL_SELF_REGISTRATION: "false", AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } });
  t.after(() => fs.rm(app.storeDir, { recursive: true, force: true }));
  const password = () => app.authService.getCapabilities().features.password;
  assert.equal(password().selfRegister, true);
  assert.equal(app.authService.getCapabilities().features.firstAccountSetupCode, false, "development needs no setup code");
  await app.authService.register({ email: "owner@example.com", password: "correct horse battery staple" });
  assert.equal(password().selfRegister, false);
  await assert.rejects(
    () => app.authService.register({ email: "eve@example.com", password: "correct horse battery staple" }),
    { status: 403, code: "auth.local.register.closed" }
  );
  // With self-registration on (the default), anyone may register.
  const open = await createStartedApp({ env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } });
  t.after(() => fs.rm(open.storeDir, { recursive: true, force: true }));
  assert.equal(open.authService.getCapabilities().features.password.selfRegister, true);
});

test("the confirmation sender emails the link, which is never returned or logged, and the register hook runs on confirming", async (t) => {
  const messages = [];
  const logs = [];
  const hooked = [];
  const app = await createStartedApp({
    env: {
      NODE_ENV: "production",
      AUTH_LOCAL_SESSION_SECRET: "fixture-session-secret",
      AUTH_LOCAL_FILE_PRODUCTION_ACK: "true",
      AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "",
      AUTH_LOCAL_EMAIL_CONFIRMATION: "",
      APP_PUBLIC_URL: "https://app.example.test"
    },
    confirmationSender: async (message) => { messages.push(message); },
    logger: { info: (...args) => logs.push(args), warn() {}, error() {}, debug() {} },
    configureExtensions(extensions, runtimeLogger) {
      extensions.registerServiceDecorator(createLocalAuthRegisterHookDecorator({
        logger: runtimeLogger,
        hook: { hookId: "welcome", blocking: true, async handle({ actor }) { hooked.push(actor.email); } }
      }));
    }
  });
  t.after(() => fs.rm(app.storeDir, { recursive: true, force: true }));
  const features = app.authService.getCapabilities().features;
  assert.deepEqual([features.emailConfirmation, features.emailConfirmationCode], [true, true]);

  const registered = await app.authService.register({
    email: "mail@example.com",
    password: "correct horse battery staple",
    setupCode: await firstAccountSetupCode(app.storeDir)
  });
  assert.equal(registered.requiresEmailConfirmation, true);
  assert.equal(registered.session, null);
  assert.equal(Object.hasOwn(registered, "confirmationUrl"), false);
  assert.deepEqual(hooked, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].email, "mail@example.com");
  const link = new URL(messages[0].confirmationUrl);
  assert.equal(`${link.origin}${link.pathname}`, "https://app.example.test/auth/login");
  assert.equal(JSON.stringify(logs).includes(link.searchParams.get("confirmation_token")), false);

  // The link's code alone is refused: confirming takes the registration's password too.
  await assert.rejects(
    app.actionExecutor.execute({
      actionId: "auth.register.confirm",
      input: { token: link.searchParams.get("confirmation_token") },
      context: { channel: "internal" }
    }),
    (error) => error.code === "ACTION_VALIDATION_FAILED" && Object.keys(error.details.fieldErrors).join() === "password"
  );
  assert.deepEqual(hooked, []);
  const confirmed = await app.actionExecutor.execute({
    actionId: "auth.register.confirm",
    input: { token: link.searchParams.get("confirmation_token"), password: "correct horse battery staple" },
    context: { channel: "internal" }
  });
  assert.equal(confirmed.actor.email, "mail@example.com");
  assert.ok(confirmed.session.access_token);
  assert.deepEqual(hooked, ["mail@example.com"]);
});
