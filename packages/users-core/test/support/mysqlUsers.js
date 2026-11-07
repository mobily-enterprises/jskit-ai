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

// The migrated users tables in a MariaDB/MySQL database of the test file's own, named after TEST_DB_NAME with the
// file's suffix, made on first use and dropped when the file ends. Each test keeps to its own users.
const MIGRATIONS = [usersInitial, usersUsername, usersUpdatedAt];

async function openDatabase(suffix, cleanups) {
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
  for (const migration of MIGRATIONS) await migration.up(knex);
  // The users tables, owned as UsersIdentityProvider owns them.
  const runtime = await createTestResourceRuntime({ knex, logger: silentLogger });
  const resources = await runtime.own("users.identity", [userProfileTableResource, userSettingsTableResource]);
  const identity = createUsersIdentity({ resources, extensions: createUsersExtensions() });
  // Background work's context, as a feature declaring a systemScope receives it.
  const systemContext = runtime.declareSystemScope("users.identity", "import users")("users test import");
  return Object.freeze({ knex, resources, systemContext, ...identity });
}

/**
 * The file's database: call it at the file's top level, then `await open()` in each test after
 * requireTestDatabase(). The database is made by the first test that opens it and dropped after the file's tests.
 * @param {string} suffix A short name unique to the test file, such as "users_repos".
 */
function usersDatabase(suffix) {
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

export { usersDatabase };
