import diagnosticsChannel from "node:diagnostics_channel";
import { normalizeDatabaseClient, toKnexClientId } from "../shared/databaseClient.js";
import { resolveKnexConnectionFromEnvironment } from "../shared/databaseConnection.js";
import { createTransactionManager } from "../shared/transactionManager.js";
import { loadKnexFactory } from "./knexFactory.js";

// The diagnostics channel that carries each statement the shared Knex sends (Knex's `query` event: its `sql`,
// `bindings` and method), for observers in the process that booted the runtime, such as countRuntimeQueries().
const RUNTIME_QUERY_CHANNEL = "jskit:database:query";

/** @param {import("./types.js").RuntimeDatabaseDriver} driver */
function resolveDriverDialectId(driver) {
  const dialectId = normalizeDatabaseClient(driver.DIALECT_ID, { allowEmpty: true });
  if (!dialectId) {
    throw new Error("The installed database driver did not expose a valid dialect id.");
  }
  return dialectId;
}

/**
 * The database connection every feature shares: the installed driver, its Knex client and a transaction manager.
 * @param {object} dependencies
 * @param {import("./types.js").RuntimeDatabaseDriver} dependencies.driver
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
function createDatabase({ driver, env }) {
  const dialectId = resolveDriverDialectId(driver);
  const configuredClient = normalizeDatabaseClient(env.DB_CLIENT, { allowEmpty: true });
  if (configuredClient && configuredClient !== dialectId) {
    throw new Error(`DB_CLIENT="${configuredClient}" does not match installed database driver "${dialectId}".`);
  }

  /** @type {import("./types.js").RuntimeKnex} */
  const knex = loadKnexFactory()({
    client: toKnexClientId(dialectId),
    connection: resolveKnexConnectionFromEnvironment(env, {
      client: dialectId,
      defaultPort: dialectId === "pg" ? 5432 : 3306,
      context: "database runtime"
    })
  });
  const statements = diagnosticsChannel.channel(RUNTIME_QUERY_CHANNEL);
  knex.on("query", (query) => statements.publish(query));
  const transactionManager = createTransactionManager({ knex });

  return Object.freeze({
    driver,
    knex,
    transactionManager
  });
}

export { RUNTIME_QUERY_CHANNEL, createDatabase };
