import { createTransactionManager } from "./transactionManager.js";
import { DatabaseRuntimeError } from "./runtimeErrors.js";

function ensureContainerInterface(app) {
  if (
    !app ||
    typeof app.instance !== "function" ||
    typeof app.singleton !== "function" ||
    typeof app.make !== "function" ||
    typeof app.has !== "function"
  ) {
    throw new DatabaseRuntimeError("registerDatabaseRuntime requires application instance/singleton/make/has methods.");
  }
}

function ensureKnexInterface(knex) {
  if (!knex || typeof knex.transaction !== "function") {
    throw new DatabaseRuntimeError("registerDatabaseRuntime requires knex with transaction().");
  }
}

function ensureKnexBinding(app, knex) {
  if (!app.has("jskit.database.knex")) {
    app.instance("jskit.database.knex", knex);
    return;
  }

  const existingKnex = app.make("jskit.database.knex");
  if (existingKnex !== knex) {
    throw new DatabaseRuntimeError("registerDatabaseRuntime received knex that differs from existing Knex binding.");
  }
}

function ensureTransactionManagerBinding(app) {
  if (app.has("jskit.database.transactionManager")) {
    return;
  }

  app.singleton("jskit.database.transactionManager", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createTransactionManager({ knex });
  });
}

function registerDatabaseRuntime(app, { knex } = {}) {
  ensureContainerInterface(app);
  ensureKnexInterface(knex);

  ensureKnexBinding(app, knex);
  ensureTransactionManagerBinding(app);

  return {
    knex: app.make("jskit.database.knex"),
    transactionManager: app.make("jskit.database.transactionManager")
  };
}

export { registerDatabaseRuntime };
