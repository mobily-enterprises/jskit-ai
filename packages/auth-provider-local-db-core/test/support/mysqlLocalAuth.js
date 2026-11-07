import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { LOCAL_AUTH_MIGRATIONS, startLocalAuthRecords } from "./localAuthRuntime.js";

// Local sign-in's tables in a MariaDB/MySQL database of the test's own, named after TEST_DB_NAME with the test's
// suffix and dropped after the test, with the provider started as an application starts it. The test reaches its
// records through what the provider gives: the auth.local.backend and the owner APIs.

// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

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
  for (const migration of LOCAL_AUTH_MIGRATIONS) await migration.up(knex);

  return Object.freeze({ knex, ...(await startLocalAuthRecords(knex)) });
}

export { openLocalAuthDatabase };
