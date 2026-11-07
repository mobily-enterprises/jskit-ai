import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import initialMigration from "../../migrations/auth_local_db_initial.cjs";
import oauthMigration from "../../migrations/auth_local_db_oauth.cjs";
import protectionMigration from "../../migrations/auth_local_db_protection.cjs";
import emailVerifiedMigration from "../../migrations/auth_local_db_users_email_verified.cjs";
import { AuthLocalDatabaseBackendProvider } from "../../src/server/providers/AuthLocalDatabaseBackendProvider.js";

// Local sign-in's tables in a MariaDB/MySQL database of the test's own, named after TEST_DB_NAME with the test's
// suffix and dropped after the test, with the provider started as an application starts it. The test reaches its
// records through what the provider gives: the auth.local.backend and the owner APIs.

// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });
const MIGRATIONS = Object.freeze([initialMigration, oauthMigration, protectionMigration, emailVerifiedMigration]);

/**
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 */
async function openLocalAuthDatabase(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  if (name.length > 64) throw new Error(`Test database name ${name} is longer than MySQL's 64 characters.`);
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name, ...RUNTIME_MYSQL }, pool: { min: 0, max: 6 } });
  context.after(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    } finally {
      await admin.destroy();
    }
  });
  for (const migration of MIGRATIONS) await migration.up(knex);

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
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.database": { knex, transactionManager: { inTransaction: (work) => knex.transaction(work) } }
    },
    providers: [AuthLocalDatabaseBackendProvider, probe]
  });
  await runtime.start();

  return Object.freeze({
    knex,
    ...capabilities,
    /**
     * Runs work in a caller's transaction, as application code holds one, handing it the options its owner API
     * calls pass on.
     * @template T
     * @param {(options: Record<string, unknown>) => Promise<T>} work
     * @returns {Promise<T>}
     */
    inCallerTransaction(work) {
      return knex.transaction((trx) => work({ trx }));
    }
  });
}

export { openLocalAuthDatabase };
