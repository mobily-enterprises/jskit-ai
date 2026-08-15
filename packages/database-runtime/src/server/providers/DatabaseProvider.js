import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as databaseUtilities from "../../shared/index.js";
import { normalizeDatabaseClient, toKnexClientId } from "../../shared/databaseClient.js";
import { resolveKnexConnectionFromEnvironment } from "../../shared/databaseConnection.js";
import { createTransactionManager } from "../../shared/transactionManager.js";
import { loadKnexFactory } from "../knexFactory.js";

function resolveDriverDialectId(driver) {
  const dialectId = normalizeDatabaseClient(
    driver?.DIALECT_ID || driver?.dialectId || driver?.dialect || driver?.getDialectId?.(),
    { allowEmpty: true }
  );
  if (!dialectId) {
    throw new Error("The installed database driver did not expose a valid dialect id.");
  }
  return dialectId;
}

function createDatabase({ driver, env }) {
  const dialectId = resolveDriverDialectId(driver);
  const configuredClient = normalizeDatabaseClient(env.DB_CLIENT, { allowEmpty: true });
  if (configuredClient && configuredClient !== dialectId) {
    throw new Error(`DB_CLIENT="${configuredClient}" does not match installed database driver "${dialectId}".`);
  }

  const knex = loadKnexFactory()({
    client: toKnexClientId(dialectId),
    connection: resolveKnexConnectionFromEnvironment(env, {
      client: dialectId,
      defaultPort: dialectId === "pg" ? 5432 : 3306,
      context: "database runtime"
    })
  });
  const transactionManager = createTransactionManager({ knex });

  return Object.freeze({
    ...databaseUtilities,
    driver,
    knex,
    transactionManager
  });
}

const DatabaseProvider = defineProvider({
  id: "runtime.database",
  requires: {
    env: "runtime.env",
    driver: "runtime.database.driver"
  },
  provides: {
    database: "runtime.database"
  },
  setup({ driver, env }) {
    return { database: createDatabase({ driver, env }) };
  },
  async shutdown(_dependencies, { outputs }) {
    const knex = outputs.database?.knex;
    if (knex && typeof knex.destroy === "function") {
      await knex.destroy();
    }
  }
});

export { DatabaseProvider };
