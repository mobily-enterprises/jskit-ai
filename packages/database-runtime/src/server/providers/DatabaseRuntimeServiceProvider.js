import { symlinkSafeRequire } from "@jskit-ai/kernel/server/support";
import * as databaseRuntime from "../../shared/index.js";
import { createTransactionManager } from "../../shared/transactionManager.js";
import {
  normalizeDatabaseClient,
  toKnexClientId
} from "../../shared/databaseClient.js";
import { resolveDatabaseConnectionFromEnvironment } from "../../shared/databaseConnection.js";

const DATABASE_RUNTIME_SERVER_API = Object.freeze({
  ...databaseRuntime
});

function resolveDatabaseEnv(scope) {
  const envFromScope = scope?.has?.("jskit.env") ? scope.make("jskit.env") : {};
  const source = envFromScope && typeof envFromScope === "object" ? envFromScope : {};
  return {
    ...process.env,
    ...source
  };
}

function resolveDriverDialectId(driver) {
  const source = driver && typeof driver === "object" ? driver : {};
  const fromConstant = normalizeDatabaseClient(source.DIALECT_ID || source.dialectId || source.dialect, {
    allowEmpty: true
  });
  if (fromConstant) {
    return fromConstant;
  }
  if (typeof source.getDialectId === "function") {
    return normalizeDatabaseClient(source.getDialectId(), {
      allowEmpty: true
    });
  }
  return "";
}

function loadKnexFactory() {
  let moduleValue;
  try {
    moduleValue = symlinkSafeRequire("knex");
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
  const preferredClient = normalizeDatabaseClient(env.DB_CLIENT, {
    allowEmpty: true
  });
  if (!preferredClient) {
    throw new Error("Multiple database drivers are registered. Set DB_CLIENT to mysql2 or pg, or keep exactly one database runtime driver package installed.");
  }

  const matched = drivers.find((driver) => resolveDriverDialectId(driver) === preferredClient) || null;
  if (!matched) {
    throw new Error(`Multiple database drivers are registered, but DB_CLIENT="${preferredClient}" did not match any registered driver.`);
  }

  return matched;
}

function resolveRegisteredDrivers(scope) {
  const drivers = [];

  if (scope.has("runtime.database.driver.mysql")) {
    drivers.push(scope.make("runtime.database.driver.mysql"));
  }

  if (scope.has("runtime.database.driver.postgres")) {
    drivers.push(scope.make("runtime.database.driver.postgres"));
  }

  return drivers;
}

function resolveSingleRegisteredDriver(scope) {
  return resolveRegisteredDriver(scope);
}

function createKnexConfig(scope) {
  const env = resolveDatabaseEnv(scope);
  const configuredClient = normalizeDatabaseClient(env.DB_CLIENT, {
    allowEmpty: true
  });
  const driver = resolveRegisteredDriver(scope);
  const dialectId = resolveDriverDialectId(driver);

  if (!dialectId) {
    throw new Error("Selected database driver did not expose a valid dialect id.");
  }

  if (configuredClient && configuredClient !== dialectId) {
    throw new Error(`DB_CLIENT="${configuredClient}" does not match installed database driver "${dialectId}".`);
  }

  const client = toKnexClientId(dialectId);
  const defaultPort = dialectId === "pg" ? 5432 : 3306;
  const connection = resolveDatabaseConnectionFromEnvironment(env, {
    defaultPort,
    context: "database runtime"
  });

  return {
    client,
    connection
  };
}

function createKnexInstance(scope) {
  const knexFactory = loadKnexFactory();
  const config = createKnexConfig(scope);
  return knexFactory(config);
}

class DatabaseRuntimeServiceProvider {
  static id = "runtime.database";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("DatabaseRuntimeServiceProvider requires application singleton()/has().");
    }

    app.singleton("runtime.database", () => DATABASE_RUNTIME_SERVER_API);

    if (!app.has("runtime.database.driver")) {
      app.singleton("runtime.database.driver", (scope) => resolveSingleRegisteredDriver(scope));
    }

    if (!app.has("jskit.database.knex")) {
      app.singleton("jskit.database.knex", (scope) => createKnexInstance(scope));
    }

    if (!app.has("jskit.database.transactionManager")) {
      app.singleton("jskit.database.transactionManager", (scope) => {
        const knex = scope.make("jskit.database.knex");
        return createTransactionManager({ knex });
      });
    }
  }

  boot() {}
}

export { DatabaseRuntimeServiceProvider };
