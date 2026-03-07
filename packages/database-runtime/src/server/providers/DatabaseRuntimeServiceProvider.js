import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import * as databaseRuntime from "../../shared/index.js";
import { createTransactionManager } from "../../shared/transactionManager.js";

const DATABASE_RUNTIME_TOKEN = "runtime.database";
const DATABASE_DRIVER_TOKEN = "runtime.database.driver";
const MYSQL_DRIVER_TOKEN = "runtime.database.driver.mysql";
const POSTGRES_DRIVER_TOKEN = "runtime.database.driver.postgres";

const DATABASE_RUNTIME_SERVER_API = Object.freeze({
  ...databaseRuntime
});

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
  const drivers = resolveRegisteredDrivers(scope);

  if (drivers.length === 1) {
    return drivers[0];
  }

  if (drivers.length < 1) {
    throw new Error("No database driver is registered. Install @jskit-ai/database-runtime-mysql or @jskit-ai/database-runtime-postgres.");
  }

  throw new Error("Multiple database drivers are registered. Install exactly one database runtime driver package.");
}

class DatabaseRuntimeServiceProvider {
  static id = DATABASE_RUNTIME_TOKEN;

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("DatabaseRuntimeServiceProvider requires application singleton()/has().");
    }

    app.singleton(DATABASE_RUNTIME_TOKEN, () => DATABASE_RUNTIME_SERVER_API);

    if (app.has(KERNEL_TOKENS.Knex) && !app.has(KERNEL_TOKENS.TransactionManager)) {
      app.singleton(KERNEL_TOKENS.TransactionManager, (scope) => {
        const knex = scope.make(KERNEL_TOKENS.Knex);
        return createTransactionManager({ knex });
      });
    }

    if (!app.has(DATABASE_DRIVER_TOKEN)) {
      app.singleton(DATABASE_DRIVER_TOKEN, (scope) => resolveSingleRegisteredDriver(scope));
    }
  }

  boot() {}
}

export { DatabaseRuntimeServiceProvider };
