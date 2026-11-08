import { AssertionError } from "node:assert";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createPackageTestKnex, requireTestDatabase, tableNames, TestDatabaseMissingError } from "@jskit-ai/database-runtime/server/testDatabases";
import { createResourceHost } from "../server/resourceHost.js";
import { createResourceRuntime } from "../server/resourceRuntime.js";
import { expectFlatQueries } from "./expectFlatQueries.js";
import { expectScoped } from "./expectScoped.js";

// Tables every migrated database has that no feature owns: the migration ledger.
const MIGRATION_TABLES = Object.freeze(["knex_migrations", "knex_migrations_lock"]);

/**
 * A resource runtime on the test's own Knex, for a package test that owns
 * tables without booting a server: `runtime.own(featureId, owns)` answers handles.
 * With `createTables`, own() also creates each owned table from its resource's
 * schema, for a SQLite test whose shipped migrations are written for another database.
 * `hostHooks` are json-rest-api hooks the test installs on the runtime's host,
 * such as an afterCommit that fails on request.
 * @param {object} options
 * @param {import("knex").Knex} options.knex
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [options.logger]
 * @param {number} [options.requestRowLimit]
 * @param {number} [options.serverPageSize]
 * @param {boolean} [options.createTables]
 * @param {Record<string, Function>} [options.hostHooks]
 */
async function createTestResourceRuntime({ knex, logger = silentLogger, requestRowLimit, serverPageSize, createTables = false, hostHooks }) {
  const api = await createResourceHost({ knex, logger });
  if (hostHooks) {
    await api.customize({ hooks: hostHooks });
  }
  const runtime = createResourceRuntime({ api, requestRowLimit, serverPageSize });
  if (!createTables) {
    return runtime;
  }
  return Object.freeze({
    ...runtime,
    async own(featureId, owns) {
      const handles = await runtime.own(featureId, owns);
      for (const name of Object.keys(handles)) {
        await api.resources[name].createKnexTable();
      }
      return handles;
    }
  });
}

/**
 * Starts features as an application's server does, on the test's own Knex and
 * without HTTP: the kernel orders them by what they require, the resource
 * runtime gives each owner its handles and system context (with `createTables`,
 * it also creates each owned table from its resource), and every boot runs, so
 * a registry that seals at boot, such as `crud.contracts`, is sealed. The
 * runtime's events and actions are started with them; `inputs` give anything
 * else the features require, by capability id, and `requires` names what the
 * test reads, as a feature's own requires do. `stop()` shuts them down.
 * @template {Record<string, string>} R
 * @param {object} options
 * @param {import("knex").Knex} options.knex
 * @param {ReadonlyArray<ReturnType<typeof defineProvider>>} options.features The features and providers under test.
 * @param {R} [options.requires] What the test reads: local name to capability id.
 * @param {Record<string, unknown>} [options.inputs] Capability values given as they are, by capability id.
 * @param {boolean} [options.createTables]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [options.logger]
 * @returns {Promise<{ capabilities: { [K in keyof R]: any }, resources: ReturnType<typeof createResourceRuntime>, stop: () => Promise<unknown> }>}
 */
async function startTestFeatures({ knex, features, requires = {}, inputs = {}, createTables = false, logger = silentLogger }) {
  const resources = await createTestResourceRuntime({ knex, logger, createTables });
  let capabilities = {};
  const reader = defineProvider({
    id: "test.features.reader",
    requires,
    /** @param {Record<string, unknown>} values The capabilities the test reads. */
    setup(values) {
      capabilities = Object.freeze({ ...values });
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": logger, ...inputs, "runtime.resources": resources },
    providers: [EventProvider, ActionProvider, ...features, reader]
  });
  await runtime.start();
  return Object.freeze({
    capabilities,
    resources,
    stop: () => runtime.shutdown()
  });
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
  createPackageTestKnex,
  createTestResourceRuntime,
  expectEveryTableOwned,
  expectFlatQueries,
  expectScoped,
  requireTestDatabase,
  startTestFeatures
};
