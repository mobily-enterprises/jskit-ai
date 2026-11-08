import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { LOCAL_AUTH_MIGRATIONS, startLocalAuthRecords } from "./localAuthRuntime.js";

// Local sign-in's tables in a PostgreSQL schema of the test's own in TEST_DB_NAME, named after it with the test's
// suffix and dropped after the test, with the provider started as an application starts it, as mysqlLocalAuth.js
// does on MariaDB/MySQL.

// A PostgreSQL test on a run for another database, such as CI's MariaDB run, is left to the PostgreSQL run.
const POSTGRES_ELSEWHERE = process.env.DB_CLIENT && process.env.DB_CLIENT !== "pg"
  ? `a PostgreSQL test, on a ${process.env.DB_CLIENT} run`
  : false;

/**
 * @param {import("node:test").TestContext} context
 * @param {string} suffix
 */
async function openPostgresLocalAuth(context, suffix) {
  const database = requireTestDatabase(process.env);
  const schema = `${database}_${suffix}_${process.pid}`;
  if (schema.length > 63) throw new Error(`Test schema name ${schema} is longer than PostgreSQL's 63 characters.`);
  const connection = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database };
  const admin = knexLib({ client: "pg", connection, pool: { min: 0, max: 1 } });
  await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
  await admin.raw("CREATE SCHEMA ??", [schema]);
  const knex = knexLib({ client: "pg", connection, searchPath: [schema], pool: { min: 0, max: 6 } });
  context.after(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
    } finally {
      await admin.destroy();
    }
  });
  for (const migration of LOCAL_AUTH_MIGRATIONS) await migration.up(knex);

  return Object.freeze({ knex, ...(await startLocalAuthRecords(knex)) });
}

export { POSTGRES_ELSEWHERE, openPostgresLocalAuth };
