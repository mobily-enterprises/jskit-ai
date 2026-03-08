import { createRequire } from "node:module";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import * as databaseRuntime from "../../shared/index.js";
import { createTransactionManager } from "../../shared/transactionManager.js";

const require = createRequire(import.meta.url);

const DATABASE_RUNTIME_TOKEN = "runtime.database";
const DATABASE_DRIVER_TOKEN = "runtime.database.driver";
const MYSQL_DRIVER_TOKEN = "runtime.database.driver.mysql";
const POSTGRES_DRIVER_TOKEN = "runtime.database.driver.postgres";

const DATABASE_RUNTIME_SERVER_API = Object.freeze({
  ...databaseRuntime
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDatabaseClient(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "pg" || normalized === "postgresql" || normalized === "postgres") {
    return "postgres";
  }
  if (normalized === "mysql2" || normalized === "mysql" || normalized === "mariadb") {
    return "mysql";
  }
  return "";
}

function resolveDatabaseEnv(scope) {
  const envFromScope = scope?.has?.(KERNEL_TOKENS.Env) ? scope.make(KERNEL_TOKENS.Env) : {};
  const source = envFromScope && typeof envFromScope === "object" ? envFromScope : {};
  return {
    ...process.env,
    ...source
  };
}

function resolveDriverDialectId(driver) {
  const source = driver && typeof driver === "object" ? driver : {};
  const fromConstant = normalizeDatabaseClient(source.DIALECT_ID || source.dialectId || source.dialect);
  if (fromConstant) {
    return fromConstant;
  }
  if (typeof source.getDialectId === "function") {
    return normalizeDatabaseClient(source.getDialectId());
  }
  return "";
}

function resolveKnexClientId(dialectId) {
  if (dialectId === "postgres") {
    return "pg";
  }
  if (dialectId === "mysql") {
    return "mysql2";
  }
  throw new Error(`Unsupported database dialect "${dialectId}".`);
}

function resolveRequiredEnvString(env, key) {
  const value = normalizeText(env?.[key]);
  if (!value) {
    throw new Error(`${key} is required for database runtime.`);
  }
  return value;
}

function resolvePort(value, fallbackPort) {
  const parsed = Number.parseInt(normalizeText(value), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallbackPort;
}

function loadKnexFactory() {
  let moduleValue;
  try {
    moduleValue = require("knex");
  } catch {
    throw new Error(
      "Knex package is not installed. Re-run `npx jskit update package database-runtime` to apply runtime dependencies."
    );
  }

  const knexFactory =
    typeof moduleValue === "function"
      ? moduleValue
      : typeof moduleValue?.default === "function"
        ? moduleValue.default
        : null;
  if (!knexFactory) {
    throw new Error("Knex package resolved but did not expose a callable factory.");
  }

  return knexFactory;
}

function resolveRegisteredDriver(scope) {
  const drivers = resolveRegisteredDrivers(scope);
  if (drivers.length === 1) {
    return drivers[0];
  }
  if (drivers.length < 1) {
    throw new Error("No database driver is registered. Install @jskit-ai/database-runtime-mysql or @jskit-ai/database-runtime-postgres.");
  }

  const env = resolveDatabaseEnv(scope);
  const preferredClient = normalizeDatabaseClient(env.DB_CLIENT);
  if (!preferredClient) {
    throw new Error("Multiple database drivers are registered. Set DB_CLIENT to mysql or postgres, or keep exactly one database runtime driver package installed.");
  }

  const matched = drivers.find((driver) => resolveDriverDialectId(driver) === preferredClient) || null;
  if (!matched) {
    throw new Error(`Multiple database drivers are registered, but DB_CLIENT="${preferredClient}" did not match any registered driver.`);
  }

  return matched;
}

function resolveRegisteredDrivers(scope) {
  const drivers = [];

  if (scope.has(MYSQL_DRIVER_TOKEN)) {
    drivers.push(scope.make(MYSQL_DRIVER_TOKEN));
  }

  if (scope.has(POSTGRES_DRIVER_TOKEN)) {
    drivers.push(scope.make(POSTGRES_DRIVER_TOKEN));
  }

  return drivers;
}

function resolveSingleRegisteredDriver(scope) {
  return resolveRegisteredDriver(scope);
}

function createKnexConfig(scope) {
  const env = resolveDatabaseEnv(scope);
  const configuredClient = normalizeDatabaseClient(env.DB_CLIENT);
  const driver = resolveRegisteredDriver(scope);
  const dialectId = resolveDriverDialectId(driver);

  if (!dialectId) {
    throw new Error("Selected database driver did not expose a valid dialect id.");
  }

  if (configuredClient && configuredClient !== dialectId) {
    throw new Error(`DB_CLIENT="${configuredClient}" does not match installed database driver "${dialectId}".`);
  }

  const client = resolveKnexClientId(dialectId);
  const defaultPort = dialectId === "postgres" ? 5432 : 3306;

  return {
    client,
    connection: {
      host: normalizeText(env.DB_HOST) || "localhost",
      port: resolvePort(env.DB_PORT, defaultPort),
      database: resolveRequiredEnvString(env, "DB_NAME"),
      user: resolveRequiredEnvString(env, "DB_USER"),
      password: String(env.DB_PASSWORD ?? "")
    }
  };
}

function createKnexInstance(scope) {
  const knexFactory = loadKnexFactory();
  const config = createKnexConfig(scope);
  return knexFactory(config);
}

class DatabaseRuntimeServiceProvider {
  static id = DATABASE_RUNTIME_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("DatabaseRuntimeServiceProvider requires application singleton()/has().");
    }

    app.singleton(DATABASE_RUNTIME_TOKEN, () => DATABASE_RUNTIME_SERVER_API);

    if (!app.has(DATABASE_DRIVER_TOKEN)) {
      app.singleton(DATABASE_DRIVER_TOKEN, (scope) => resolveSingleRegisteredDriver(scope));
    }

    if (!app.has(KERNEL_TOKENS.Knex)) {
      app.singleton(KERNEL_TOKENS.Knex, (scope) => createKnexInstance(scope));
    }

    if (!app.has(KERNEL_TOKENS.TransactionManager)) {
      app.singleton(KERNEL_TOKENS.TransactionManager, (scope) => {
        const knex = scope.make(KERNEL_TOKENS.Knex);
        return createTransactionManager({ knex });
      });
    }
  }

  boot() {}
}

export { DatabaseRuntimeServiceProvider };
