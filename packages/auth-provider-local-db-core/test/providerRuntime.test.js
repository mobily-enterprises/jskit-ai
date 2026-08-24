import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { createLocalAuthService, hashPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { AuthLocalProvider } from "@jskit-ai/auth-provider-local-core/server/providers/AuthLocalProvider";
import { createLocalDbBackend, LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";
import { AuthLocalDatabaseBackendProvider } from "../src/server/providers/AuthLocalDatabaseBackendProvider.js";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

const DEV_AUTH_SECRET_HEADER = "x-jskit-dev-auth-secret";
const DEV_AUTH_SECRET = "local-db-preview-exchange-secret";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDuplicateError() {
  const error = new Error("duplicate key value violates unique constraint");
  error.code = "23505";
  return error;
}

function createMemoryKnex() {
  const tables = new Map(Object.values(LOCAL_AUTH_DB_TABLES).map((tableName) => [tableName, []]));

  function rowsFor(tableName) {
    if (!tables.has(tableName)) {
      tables.set(tableName, []);
    }
    return tables.get(tableName);
  }

  function assertUnique(tableName, row) {
    const rows = rowsFor(tableName);
    const duplicate = rows.some((existing) => {
      if (existing.id === row.id) {
        return true;
      }
      if (tableName === LOCAL_AUTH_DB_TABLES.users) {
        return existing.email === row.email;
      }
      return existing.token_hash === row.token_hash;
    });
    if (duplicate) {
      throw createDuplicateError();
    }
  }

  class Query {
    constructor(tableName) {
      this.tableName = tableName;
      this.filters = [];
    }

    where(criteria, value) {
      if (criteria && typeof criteria === "object") {
        for (const [key, expected] of Object.entries(criteria)) {
          this.filters.push((row) => row[key] === expected);
        }
        return this;
      }
      const key = String(criteria || "");
      this.filters.push((row) => row[key] === value);
      return this;
    }

    whereNot(key, value) {
      this.filters.push((row) => row[String(key || "")] !== value);
      return this;
    }

    whereNull(key) {
      this.filters.push((row) => row[String(key || "")] == null);
      return this;
    }

    matches(row) {
      return this.filters.every((filter) => filter(row));
    }

    async first() {
      return clone(rowsFor(this.tableName).find((row) => this.matches(row)) || null);
    }

    async insert(row) {
      assertUnique(this.tableName, row);
      rowsFor(this.tableName).push(clone(row));
      return [row.id];
    }

    async update(patch) {
      let count = 0;
      for (const row of rowsFor(this.tableName)) {
        if (this.matches(row)) {
          Object.assign(row, clone(patch));
          count += 1;
        }
      }
      return count;
    }
  }

  function knex(tableName) {
    return new Query(tableName);
  }

  knex.__tables = tables;
  knex.transaction = async (callback) => callback(knex);

  return knex;
}

function createReplyFixture() {
  const cookies = {};
  return {
    cookies,
    setCookie(name, value) {
      cookies[name] = value;
    },
    clearCookie(name) {
      delete cookies[name];
    }
  };
}

function createDbBackendFixture() {
  const knex = createMemoryKnex();
  const transactionManager = {
    transactions: 0,
    async inTransaction(work) {
      this.transactions += 1;
      return knex.transaction(work);
    }
  };
  return {
    knex,
    transactionManager,
    backend: createLocalDbBackend({
      knex,
      transactionManager
    })
  };
}

function createService(backend, options = {}) {
  const {
    config = {},
    ...serviceOptions
  } = options;
  return createLocalAuthService({
    backend,
    config: {
      nodeEnv: "test",
      sessionSecret: "test-secret",
      appPublicUrl: "http://localhost:5173",
      smtpConfigured: false,
      recoveryDevOutput: "response",
      ...config
    },
    ...serviceOptions
  });
}

function createLocalRequest({ cookies = {}, exchange = false } = {}) {
  return {
    cookies,
    headers: {
      host: "localhost:4100",
      ...(exchange ? { [DEV_AUTH_SECRET_HEADER]: DEV_AUTH_SECRET } : {})
    },
    socket: {
      remoteAddress: "127.0.0.1"
    }
  };
}

test("DB local auth backend implements the storage repository contract", async () => {
  const { backend, transactionManager } = createDbBackendFixture();
  const password = await hashPassword("stored password value");

  await backend.withTransaction(async (tx) => {
    const user = await tx.users.create({
      id: "usr_db_contract",
      email: "contract@example.com",
      displayName: "Contract User",
      password
    });
    assert.equal(user.email, "contract@example.com");
    assert.deepEqual(user.password, password);

    assert.equal((await tx.users.findByEmail("contract@example.com")).id, "usr_db_contract");
    assert.equal((await tx.users.findById("usr_db_contract")).displayName, "Contract User");

    const updated = await tx.users.updateProfile("usr_db_contract", {
      displayName: "Renamed User"
    });
    assert.equal(updated.displayName, "Renamed User");

    const nextPassword = await hashPassword("next password value");
    assert.deepEqual((await tx.users.updatePassword("usr_db_contract", nextPassword)).password, nextPassword);

    const session = await tx.sessions.create({
      id: "ses_db_contract",
      userId: "usr_db_contract",
      tokenHash: "session-token-hash",
      purpose: "normal",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    assert.equal(session.revokedAt, "");
    assert.equal((await tx.sessions.findByTokenHash("session-token-hash")).id, "ses_db_contract");
    assert.notEqual((await tx.sessions.revoke("ses_db_contract")).revokedAt, "");
    assert.equal(await tx.sessions.revokeForUser("usr_db_contract"), 0);

    const recovery = await tx.recovery.create({
      id: "rec_db_contract",
      userId: "usr_db_contract",
      tokenHash: "recovery-token-hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    assert.equal(recovery.usedAt, "");
    assert.equal((await tx.recovery.findByTokenHash("recovery-token-hash")).id, "rec_db_contract");
    assert.notEqual((await tx.recovery.consume("rec_db_contract")).usedAt, "");
    assert.equal(await tx.recovery.consumeForUser("usr_db_contract"), 0);
  });

  assert.equal(transactionManager.transactions, 1);
});

test("DB local auth backend rejects duplicate users by canonical email", async () => {
  const { backend } = createDbBackendFixture();
  const password = await hashPassword("stored password value");

  await backend.withTransaction(async (tx) => {
    await tx.users.create({
      id: "usr_duplicate_1",
      email: "duplicate@example.com",
      displayName: "Duplicate One",
      password
    });
    await assert.rejects(
      () =>
        tx.users.create({
          id: "usr_duplicate_2",
          email: "duplicate@example.com",
          displayName: "Duplicate Two",
          password
        }),
      /Local auth user already exists/
    );
  });
});

test("local auth service works end to end with DB backend", async () => {
  const { backend } = createDbBackendFixture();
  const authService = createService(backend);

  const registered = await authService.register({
    email: "DBUser@example.com",
    password: "correct horse battery staple",
    displayName: "DB User"
  });
  assert.equal(registered.actor.email, "dbuser@example.com");

  const login = await authService.login({
    email: "dbuser@example.com",
    password: "correct horse battery staple"
  });
  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, login.session);
  assert.equal((await authService.authenticateRequest({ cookies: reply.cookies })).authenticated, true);

  const recoveryRequest = await authService.requestPasswordReset({
    email: "dbuser@example.com"
  });
  const recoveryToken = new URL(recoveryRequest.recoveryUrl).searchParams.get("token");
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
      password: "updated password value"
    }
  );

  await assert.rejects(
    () =>
      authService.login({
        email: "dbuser@example.com",
        password: "correct horse battery staple"
      }),
    /Invalid email or password/
  );
  assert.equal(
    (await authService.login({
      email: "dbuser@example.com",
      password: "updated password value"
    })).actor.email,
    "dbuser@example.com"
  );

  const firstNormalLogin = await authService.login({
    email: "dbuser@example.com",
    password: "updated password value"
  });
  const firstReply = createReplyFixture();
  authService.writeSessionCookies(firstReply, firstNormalLogin.session);
  const secondNormalLogin = await authService.login({
    email: "dbuser@example.com",
    password: "updated password value"
  });
  const secondReply = createReplyFixture();
  authService.writeSessionCookies(secondReply, secondNormalLogin.session);

  const signOutResult = await authService.signOutOtherSessions({ cookies: secondReply.cookies });
  assert.equal(signOutResult.revokedSessions >= 1, true);
  assert.equal((await authService.authenticateRequest({ cookies: firstReply.cookies })).authenticated, false);

  await authService.changePassword(
    {
      cookies: secondReply.cookies
    },
    {
      currentPassword: "updated password value",
      newPassword: "changed password value"
    }
  );
  await assert.rejects(
    () =>
      authService.login({
        email: "dbuser@example.com",
        password: "updated password value"
      }),
    /Invalid email or password/
  );
  assert.equal(
    (await authService.login({
      email: "dbuser@example.com",
      password: "changed password value"
    })).actor.email,
    "dbuser@example.com"
  );
});

test("local database auth uses the shared native login-as session contract", async () => {
  const { backend } = createDbBackendFixture();
  const password = await hashPassword("stored password value");
  await backend.withTransaction((tx) => tx.users.create({
    displayName: "Database Preview User",
    email: "preview-db@example.com",
    id: "usr_preview_db",
    password
  }));
  const authService = createService(backend, {
    config: {
      devAuth: {
        enabled: true,
        isProduction: false,
        secret: DEV_AUTH_SECRET
      }
    }
  });

  const impersonated = await authService.devLoginAs(createLocalRequest({
    exchange: true
  }), {
    email: "PREVIEW-DB@EXAMPLE.COM"
  });
  assert.equal(impersonated.actor.id, "usr_preview_db");
  assert.equal(impersonated.session.purpose, "dev-auth");

  const reply = createReplyFixture();
  authService.writeSessionCookies(reply, impersonated.session);
  const authenticated = await authService.authenticateRequest(createLocalRequest({
    cookies: reply.cookies
  }));
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.actor.email, "preview-db@example.com");
  assert.equal(authenticated.sessionPurpose, "dev-auth");
});

test("local auth DB backend works with custom password strategy", async () => {
  const { backend } = createDbBackendFixture();
  const authService = createService(backend, {
    passwordStrategy: {
      async hashPassword(password) {
        return {
          algorithm: "test-strategy",
          version: "v1",
          salt: "",
          hash: `stored-${password}`
        };
      },
      async verifyPassword(password, record) {
        return record?.algorithm === "test-strategy" && record.hash === `stored-${password}`;
      }
    }
  });

  await authService.register({
    email: "strategy-db@example.com",
    password: "strategy password value",
    displayName: "Strategy DB"
  });
  const login = await authService.login({
    email: "strategy-db@example.com",
    password: "strategy password value"
  });
  assert.equal(login.actor.email, "strategy-db@example.com");
});

test("local auth service rejects disabled DB-backed users", async () => {
  const { backend } = createDbBackendFixture();
  const password = await hashPassword("disabled password value");
  await backend.withTransaction((tx) =>
    tx.users.create({
      id: "usr_disabled",
      email: "disabled@example.com",
      displayName: "Disabled",
      password,
      disabled: true
    })
  );
  const authService = createService(backend);

  await assert.rejects(
    () =>
      authService.login({
        email: "disabled@example.com",
        password: "disabled password value"
      }),
    /Invalid email or password/
  );
});

test("local auth DB backend still supports lazy profile projection", async () => {
  const { backend } = createDbBackendFixture();
  let projectionCalls = 0;
  const authService = createService(backend, {
    profileProjector: {
      async syncIdentityProfile(profile) {
        projectionCalls += 1;
        return {
          ...profile,
          id: "projected-db-user",
          profileSource: "users"
        };
      }
    }
  });

  const registered = await authService.register({
    email: "projected-db@example.com",
    password: "projected password value",
    displayName: "Projected DB"
  });

  assert.equal(projectionCalls, 1);
  assert.equal(registered.actor.appUserId, "projected-db-user");
  assert.equal(registered.actor.profileSource, "users");
});

test("package metadata declares portable local auth DB migrations without install mutations", () => {
  assert.deepEqual(packageMetadata.migrations, { directories: ["migrations"] });
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
  assert.equal(Object.hasOwn(packageMetadata, "ci"), false);
  assert.deepEqual(
    packageMetadata.metadata.jskit.tableOwnership.tables.map((table) => table.tableName),
    [
      LOCAL_AUTH_DB_TABLES.users,
      LOCAL_AUTH_DB_TABLES.sessions,
      LOCAL_AUTH_DB_TABLES.recovery
    ]
  );
});

test("installing the DB backend capability makes local auth database-backed", async () => {
  const knex = createMemoryKnex();
  let authService = null;
  const probe = defineProvider({
    id: "test.auth.local-db.probe",
    requires: { authService: "auth.service" },
    setup({ authService: service }) {
      authService = service;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.app-root": process.cwd(),
      "runtime.env": {
        AUTH_LOCAL_SESSION_SECRET: "test-secret",
        AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "response",
        APP_PUBLIC_URL: "http://localhost:5173",
        NODE_ENV: "test"
      },
      "runtime.logger": console,
      "runtime.database": {
        knex,
        transactionManager: {
          inTransaction(work) {
            return knex.transaction(work);
          }
        }
      }
    },
    providers: [
      AuthExtensionsProvider,
      AuthLocalDatabaseBackendProvider,
      AuthLocalProvider,
      probe
    ]
  });
  await runtime.start();
  assert.deepEqual(runtime.diagnostics().providerOrder, [
    "auth.extensions",
    "auth.local.database-backend",
    "auth.local",
    "test.auth.local-db.probe"
  ]);
  const registered = await authService.register({
    email: "provider-db@example.com",
    password: "provider password value",
    displayName: "Provider DB"
  });
  assert.equal(registered.actor.email, "provider-db@example.com");
});

test("local auth DB backend rejects competing capability ownership", () => {
  assert.throws(() => createCapabilityRuntime({
    inputs: {
      "auth.local.backend": { async withTransaction() {} },
      "runtime.database": {
        knex: createMemoryKnex(),
        transactionManager: { async inTransaction(work) { return work(); } }
      }
    },
    providers: [AuthLocalDatabaseBackendProvider]
  }), /auth\.local\.backend.*supplied both/);
});
