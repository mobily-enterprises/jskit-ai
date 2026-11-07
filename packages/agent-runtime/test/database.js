import path from "node:path";
import { fileURLToPath } from "node:url";
import knexLib from "knex";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { agentResources } from "../src/server/index.js";

// A disposable PostgreSQL schema with only this package's tables, in the test database: run with
// DB_NAME set to TEST_DB_NAME (and the usual DB_HOST, DB_PORT, DB_USER and DB_PASSWORD).
const name = process.env.TEST_DB_NAME?.trim();
// A run whose DB_CLIENT names another database, such as CI's MariaDB run, leaves the PostgreSQL tests to the
// PostgreSQL run; any other run without the test database fails the data tests.
export const OTHER_DATABASE = process.env.DB_CLIENT && process.env.DB_CLIENT !== "pg"
  ? `a PostgreSQL test, on a ${process.env.DB_CLIENT} run`
  : false;
export const DATABASE = OTHER_DATABASE || (name && process.env.DB_NAME === name ? false : "not on the test database (DB_NAME=$TEST_DB_NAME)");

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

// What the stores take from the feature that owns the agent's tables, on the test's schema: its
// handles and its system context factory. `columns` adds the app's own columns, as agentResources
// takes them; add them to the table before.
export async function agentOwner(knex, { columns } = {}) {
  const runtime = await createTestResourceRuntime({ knex });
  const resources = await runtime.own("agent.test", Object.values(agentResources({ columns })));
  const systemContext = runtime.declareSystemScope("agent.test", "the agent's stores, under test");
  return { resources, systemContext };
}

// The app's own column the tests add to a table.
export const BOT_COLUMN = Object.freeze({ bot_id: Object.freeze({ type: "id", nullable: true }) });
