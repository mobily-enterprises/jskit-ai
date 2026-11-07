import { AssertionError } from "node:assert";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { requireTestDatabase, tableNames, TestDatabaseMissingError } from "@jskit-ai/database-runtime/server/testDatabases";
import { createResourceHost } from "../server/resourceHost.js";
import { createResourceRuntime } from "../server/resourceRuntime.js";
import { expectFlatQueries } from "./expectFlatQueries.js";
import { expectScoped } from "./expectScoped.js";

// Tables every migrated database has that no feature owns: the migration ledger.
const MIGRATION_TABLES = Object.freeze(["knex_migrations", "knex_migrations_lock"]);

/**
 * A resource runtime on the test's own Knex, for a package test that owns
 * tables without booting a server: `runtime.own(featureId, owns)` answers handles.
 * @param {object} options
 * @param {import("knex").Knex} options.knex
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [options.logger]
 * @param {number} [options.requestRowLimit]
 * @param {number} [options.serverPageSize]
 */
async function createTestResourceRuntime({ knex, logger = silentLogger, requestRowLimit, serverPageSize }) {
  const api = await createResourceHost({ knex, logger });
  return createResourceRuntime({ api, requestRowLimit, serverPageSize });
}

/**
 * Fails when the migrated test database holds a table no feature owns and no
 * package declares as infrastructure (the migration ledger always is).
 * @param {object} options
 * @param {import("knex").Knex} options.knex The test database.
 * @param {{ ownedTables(): ReadonlyArray<{ tableName: string }> }} options.runtime The resource runtime every feature owned its tables through.
 * @param {ReadonlyArray<string>} [options.infrastructureTables] Tables a package keeps outside resources, such as sessions of a sign-in library.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The test's environment, such as `process.env`.
 */
async function expectEveryTableOwned({ knex, runtime, infrastructureTables = [], environment }) {
  requireTestDatabase(environment);
  const accounted = new Set([...MIGRATION_TABLES, ...infrastructureTables, ...runtime.ownedTables().map(({ tableName }) => tableName)]);
  const unowned = (await tableNames(knex)).filter((table) => !accounted.has(table));
  if (unowned.length > 0) {
    throw new AssertionError({
      message: `Tables no feature owns: ${unowned.join(", ")}. Each table is a table resource one feature owns, or a declared infrastructure table.`
    });
  }
}

export {
  TestDatabaseMissingError,
  createTestResourceRuntime,
  expectEveryTableOwned,
  expectFlatQueries,
  expectScoped,
  requireTestDatabase
};
