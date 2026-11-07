import path from "node:path";
import { createKnexMigrationConfigFromApp } from "./knexMigrationConfig.js";
import { loadKnexFactory } from "./knexFactory.js";
import { retryDeadlocks } from "../shared/repositoryOptions.js";

function normalizeMigrationResult(result) {
  const [batchValue, migrationValues] = Array.isArray(result) ? result : [];
  const batch = Number.isSafeInteger(batchValue) ? batchValue : 0;
  const migrations = Array.isArray(migrationValues)
    ? migrationValues.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return Object.freeze({
    batch,
    migrations: Object.freeze(migrations)
  });
}

/**
 * Migrates the database an application's Knex instance reaches, then runs its seed, if any, in one transaction.
 * @param {object} options
 * @param {import("./types.js").RuntimeKnex} options.knex
 * @param {(context: { knex: import("./types.js").RuntimeKnexTransaction, appRoot: string, environment: import("@jskit-ai/kernel/server/types").RuntimeEnv }) => unknown} [options.seed]
 * @param {string} [options.appRoot]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The application's environment, such as `process.env`.
 */
async function runDatabaseSetup({ knex, seed, appRoot = process.cwd(), environment }) {
  // readable-check: allow method-probe - input validation: the application passes its own Knex instance
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("runDatabaseSetup requires the application's Knex instance.");
  }
  if (!environment) {
    throw new TypeError("runDatabaseSetup requires the application's environment, such as process.env.");
  }
  // readable-check: allow method-probe - input validation: the application may pass its own seed
  if (seed != null && typeof seed !== "function") {
    throw new TypeError("runDatabaseSetup seed must be a function when supplied.");
  }

  const migrationResult = normalizeMigrationResult(await knex.migrate.latest());
  if (seed == null) {
    return Object.freeze({
      ...migrationResult,
      seeded: false
    });
  }

  await retryDeadlocks(() => knex.transaction(async (transaction) => {
    await seed(Object.freeze({
      knex: transaction,
      appRoot: path.resolve(appRoot),
      environment
    }));
  }));

  return Object.freeze({
    ...migrationResult,
    seeded: true
  });
}

/**
 * Migrates the database the application's environment names, with the application's and its
 * installed packages' migrations, then runs its seed, if any.
 * @param {object} options
 * @param {string} options.client The dialect id: "mysql2" or "pg".
 * @param {string} [options.appRoot]
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.environment The application's environment, such as `process.env`.
 * @param {string} [options.migrationsDirectory]
 * @param {Parameters<typeof runDatabaseSetup>[0]["seed"]} [options.seed]
 */
async function prepareDatabaseFromApp({
  client,
  appRoot = process.cwd(),
  environment,
  migrationsDirectory = "migrations",
  seed
}) {
  const normalizedAppRoot = path.resolve(appRoot);
  const config = await createKnexMigrationConfigFromApp({
    client,
    appRoot: normalizedAppRoot,
    environment,
    migrationsDirectory
  });
  const knex = loadKnexFactory()(config);

  try {
    return await runDatabaseSetup({
      knex,
      seed,
      appRoot: normalizedAppRoot,
      environment
    });
  } finally {
    await knex.destroy();
  }
}

export { prepareDatabaseFromApp, runDatabaseSetup };
