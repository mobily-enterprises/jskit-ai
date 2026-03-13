import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
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
  if (!app.has(KERNEL_TOKENS.Knex)) {
    app.instance(KERNEL_TOKENS.Knex, knex);
    return;
  }

  const existingKnex = app.make(KERNEL_TOKENS.Knex);
  if (existingKnex !== knex) {
    throw new DatabaseRuntimeError("registerDatabaseRuntime received knex that differs from existing Knex binding.");
  }
}

function ensureTransactionManagerBinding(app) {
  if (app.has(KERNEL_TOKENS.TransactionManager)) {
    return;
  }

  app.singleton(KERNEL_TOKENS.TransactionManager, (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createTransactionManager({ knex });
  });
}

function registerDatabaseRuntime(app, { knex } = {}) {
  ensureContainerInterface(app);
  ensureKnexInterface(knex);

  ensureKnexBinding(app, knex);
  ensureTransactionManagerBinding(app);

  return {
    knex: app.make(KERNEL_TOKENS.Knex),
    transactionManager: app.make(KERNEL_TOKENS.TransactionManager)
  };
}

export { registerDatabaseRuntime };
