import path from "node:path";
import { fileURLToPath } from "node:url";
import knexLib from "knex";

// A disposable PostgreSQL schema with only this package's tables, in the test database: run with
// DB_NAME set to TEST_DB_NAME (and the usual DB_HOST, DB_PORT, DB_USER and DB_PASSWORD).
const name = process.env.TEST_DB_NAME?.trim();
export const DATABASE = name && process.env.DB_NAME === name ? false : "not on the test database (DB_NAME=$TEST_DB_NAME)";

export async function testDatabase(context) {
  const schema = `agent_test_${process.pid}_${Date.now()}`;
  const connection = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.TEST_DB_NAME };
  const admin = knexLib({ client: "pg", connection });
  await admin.raw(`create schema "${schema}"`);
  const knex = knexLib({ client: "pg", connection, searchPath: [schema] });
  await knex.migrate.latest({ directory: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"), extension: "cjs", schemaName: schema, loadExtensions: [".cjs"] });
  context.after(async () => {
    await knex.destroy();
    await admin.raw(`drop schema "${schema}" cascade`);
    await admin.destroy();
  });
  return knex;
}
