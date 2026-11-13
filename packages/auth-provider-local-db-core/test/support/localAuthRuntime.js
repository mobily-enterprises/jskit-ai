import createKnex from "knex";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import initialMigration from "../../migrations/auth_local_db_initial.cjs";
import oauthMigration from "../../migrations/auth_local_db_oauth.cjs";
import protectionMigration from "../../migrations/auth_local_db_protection.cjs";
import emailVerifiedMigration from "../../migrations/auth_local_db_users_email_verified.cjs";
import secondFactorsMigration from "../../migrations/auth_local_db_users_second_factors.cjs";
import { AuthLocalDatabaseBackendProvider } from "../../src/server/providers/AuthLocalDatabaseBackendProvider.js";

// Every local auth migration, in order.
const LOCAL_AUTH_MIGRATIONS = Object.freeze([
  initialMigration,
  oauthMigration,
  protectionMigration,
  emailVerifiedMigration,
  secondFactorsMigration
]);

/**
 * The capabilities an application gives local auth's database backend, on the test's Knex: the database, an action
 * catalogue and a resource runtime, which a test runtime takes as inputs beside its own providers.
 * @param {import("knex").Knex} knex
 */
async function localAuthRuntimeInputs(knex) {
  return {
    inputs: {
      "runtime.database": { knex },
      "runtime.actions": createActionCatalogue(),
      "runtime.resources": await createTestResourceRuntime({ knex })
    }
  };
}

/**
 * Local auth's database backend started on the test's migrated Knex, as an application starts it. The test reaches
 * its records through what the backend provides: `auth.local.backend` and the owner APIs.
 * @param {import("knex").Knex} knex
 */
async function startLocalAuthRecords(knex) {
  const { inputs } = await localAuthRuntimeInputs(knex);
  // An application table of the test's own, whose handle opens the caller's transactions.
  await knex.schema.createTable("test_app_records", (table) => {
    table.increments("id");
    table.string("note", 40);
  });
  const { appRecords } = await inputs["runtime.resources"].own("test.app", [defineTableResource({
    name: "appRecords",
    tableName: "test_app_records",
    ownership: "public",
    schema: { note: { type: "string", nullable: true } }
  })]);
  let capabilities = null;
  const probe = defineProvider({
    id: "test.auth.local-db.records",
    requires: {
      backend: "auth.local.backend",
      accounts: "auth.local.accounts",
      sessions: "auth.local.sessions",
      recovery: "auth.local.recovery"
    },
    setup(received) {
      capabilities = received;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ inputs, providers: [AuthLocalDatabaseBackendProvider, probe] });
  await runtime.start();

  return Object.freeze({
    ...capabilities,
    // The resource runtime local sign-in and the test's own table own their tables through.
    resourceRuntime: inputs["runtime.resources"],
    /**
     * Runs work in a caller's transaction, the one application code opens with its own handle's withTransaction,
     * handing it the options its owner API calls pass on. Failed work rejects with the work's own error.
     * @template T
     * @param {(options: Record<string, unknown>) => Promise<T>} work
     * @returns {Promise<T>}
     */
    inCallerTransaction(work) {
      return appRecords.withTransaction({}, work);
    }
  });
}

/**
 * A migrated in-memory SQLite database of the test's own, which enforces its foreign keys and is closed after the
 * test.
 * @param {import("node:test").TestContext} context
 * @param {{ acquireConnectionTimeout?: number }} [options] how long a query waits for the pool's one connection
 */
async function openMigratedSqlite(context, { acquireConnectionTimeout = 60_000 } = {}) {
  const knex = createKnex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    acquireConnectionTimeout
  });
  context.after(() => knex.destroy());
  await knex.raw("PRAGMA foreign_keys = ON");
  for (const migration of LOCAL_AUTH_MIGRATIONS) {
    await migration.up(knex);
  }
  return knex;
}

/**
 * Local auth's records in a migrated in-memory SQLite database of the test's own.
 * @param {import("node:test").TestContext} context
 * @param {Parameters<typeof openMigratedSqlite>[1]} [options]
 */
async function openSqliteLocalAuth(context, options) {
  const knex = await openMigratedSqlite(context, options);
  return Object.freeze({ knex, ...(await startLocalAuthRecords(knex)) });
}

export { LOCAL_AUTH_MIGRATIONS, localAuthRuntimeInputs, openMigratedSqlite, openSqliteLocalAuth, startLocalAuthRecords };
