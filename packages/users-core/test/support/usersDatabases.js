import knexLib from "knex";
import { after } from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import usersInitial from "../../migrations/users_core_generic_initial.cjs";
import usersUsername from "../../migrations/users_core_profile_username.cjs";
import usersUpdatedAt from "../../migrations/users_core_profile_updated_at.cjs";
import { createUsersExtensions } from "../../src/server/usersExtensions.js";
import { createUsersIdentity } from "../../src/server/usersIdentity.js";
import { userProfileTableResource } from "../../src/shared/resources/userProfileResource.js";
import { userSettingsTableResource } from "../../src/shared/resources/userSettingsResource.js";

// The migrated users tables in a database of the test file's own, made on first use and dropped when the file ends:
// on MariaDB/MySQL a database named after TEST_DB_NAME with the file's suffix, on PostgreSQL a schema of that name in
// TEST_DB_NAME. Each test keeps to its own users.
const MIGRATIONS = [usersInitial, usersUsername, usersUpdatedAt];

// A PostgreSQL test on a run for another database, such as CI's MariaDB run, is left to the PostgreSQL run.
const POSTGRES_ELSEWHERE = process.env.DB_CLIENT && process.env.DB_CLIENT !== "pg"
  ? `a PostgreSQL test, on a ${process.env.DB_CLIENT} run`
  : false;

/**
 * users.profiles, users.settings and the projector on `knex`'s users tables, owned as UsersIdentityProvider owns
 * them; `rowPolicy` narrows the users table as an owner's row policy would.
 * @param {import("knex").Knex} knex
 * @param {{ rowPolicy?: Function }} [options]
 */
async function ownUsers(knex, { rowPolicy } = {}) {
  const runtime = await createTestResourceRuntime({ knex, logger: silentLogger });
  const profilesEntry = rowPolicy ? { resource: userProfileTableResource, rowPolicy } : userProfileTableResource;
  const resources = await runtime.own("users.identity", [profilesEntry, userSettingsTableResource]);
  const identity = createUsersIdentity({ resources, extensions: createUsersExtensions() });
  // Background work's context, as a feature declaring a systemScope receives it.
  const systemContext = runtime.declareSystemScope("users.identity", "import users")("users test import");
  return Object.freeze({ knex, resources, systemContext, ...identity });
}

async function migratedUsers(knex) {
  for (const migration of MIGRATIONS) await migration.up(knex);
  const owned = await ownUsers(knex);
  return Object.freeze({ ...owned, ownedWith: (options) => ownUsers(knex, options) });
}

async function openMysqlDatabase(suffix, cleanups) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  if (name.length > 64) throw new Error(`Test database name ${name} is longer than MySQL's 64 characters.`);
  const server = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // The mysql2 options database-runtime's connection gives an application, so records read as apps see them.
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: ["DATE"],
    timezone: "Z"
  };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name }, pool: { min: 0, max: 6 } });
  cleanups.push(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    } finally {
      await admin.destroy();
    }
  });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  return migratedUsers(knex);
}

async function openPostgresSchema(suffix, cleanups) {
  const database = requireTestDatabase(process.env);
  const schema = `${database}_${suffix}_${process.pid}`;
  if (schema.length > 63) throw new Error(`Test schema name ${schema} is longer than PostgreSQL's 63 characters.`);
  const connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database
  };
  const admin = knexLib({ client: "pg", connection, pool: { min: 0, max: 1 } });
  const knex = knexLib({ client: "pg", connection, searchPath: [schema], pool: { min: 0, max: 6 } });
  cleanups.push(async () => {
    try {
      await knex.destroy();
      await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
    } finally {
      await admin.destroy();
    }
  });
  await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
  await admin.raw("CREATE SCHEMA ??", [schema]);
  return migratedUsers(knex);
}

function fileDatabase(openDatabase, suffix) {
  const cleanups = [];
  let opening = null;
  after(async () => {
    if (opening) await opening.catch(() => {});
    for (const cleanup of cleanups) await cleanup();
  });
  return Object.freeze({
    open() {
      opening ??= openDatabase(suffix, cleanups);
      return opening;
    }
  });
}

/**
 * The file's MariaDB/MySQL database: call it at the file's top level, then `await open()` in each test after
 * requireTestDatabase(). The database is made by the first test that opens it and dropped after the file's tests.
 * Its `ownedWith({ rowPolicy })` owns the same tables again, narrowed.
 * @param {string} suffix A short name unique to the test file, such as "users_repos".
 */
function usersDatabase(suffix) {
  return fileDatabase(openMysqlDatabase, suffix);
}

/**
 * The file's PostgreSQL schema in TEST_DB_NAME, used as usersDatabase() is. Its tests skip with
 * POSTGRES_ELSEWHERE on a run for another database.
 * @param {string} suffix A short name unique to the test file.
 */
function postgresUsersDatabase(suffix) {
  return fileDatabase(openPostgresSchema, suffix);
}

export { POSTGRES_ELSEWHERE, postgresUsersDatabase, usersDatabase };
