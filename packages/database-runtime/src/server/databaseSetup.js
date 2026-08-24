import path from "node:path";
import { createKnexMigrationConfigFromApp } from "./knexMigrationConfig.js";
import { loadKnexFactory } from "./knexFactory.js";

function normalizeMigrationResult(result) {
  const [batchValue, migrationValues] = Array.isArray(result) ? result : [];
  const batch = Number.isSafeInteger(batchValue) ? batchValue : 0;
  const migrations = Array.isArray(migrationValues)
    ? migrationValues.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return Object.freeze({ batch, migrations: Object.freeze(migrations) });
}

async function runDatabaseSetup({ knex, seed, appRoot = process.cwd(), environment = process.env } = {}) {
  if (!knex || typeof knex !== "function" || typeof knex.migrate?.latest !== "function") {
    throw new TypeError("runDatabaseSetup requires a Knex instance.");
  }
  if (typeof seed !== "undefined" && seed !== null && typeof seed !== "function") {
    throw new TypeError("runDatabaseSetup seed must be a function when supplied.");
  }

  const migrationResult = normalizeMigrationResult(await knex.migrate.latest());
  if (typeof seed !== "function") {
    return Object.freeze({ ...migrationResult, seeded: false });
  }
  if (typeof knex.transaction !== "function") {
    throw new TypeError("runDatabaseSetup requires Knex transaction support for seeding.");
  }

  await knex.transaction(async (transaction) => {
    await seed(Object.freeze({
      knex: transaction,
      appRoot: path.resolve(appRoot),
      environment
    }));
  });

  return Object.freeze({ ...migrationResult, seeded: true });
}

async function prepareDatabaseFromApp({
  client,
  appRoot = process.cwd(),
  environment = process.env,
  migrationsDirectory = "migrations",
  seed
} = {}) {
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
