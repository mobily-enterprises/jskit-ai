import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createTransactionManager } from "./transactionManager.js";
import { DatabaseRuntimeError } from "./errors.js";

function registerDatabaseRuntime(app, { knex } = {}) {
  if (!app || typeof app.instance !== "function" || typeof app.singleton !== "function" || typeof app.make !== "function") {
    throw new DatabaseRuntimeError("registerDatabaseRuntime requires application container methods.");
  }
  if (!knex || typeof knex.transaction !== "function") {
    throw new DatabaseRuntimeError("registerDatabaseRuntime requires knex with transaction().");
  }

  app.instance(TOKENS.Knex, knex);
  app.singleton(TOKENS.TransactionManager, (scope) => {
    const knexInstance = scope.make(TOKENS.Knex);
    return createTransactionManager({ knex: knexInstance });
  });

  return {
    knex: app.make(TOKENS.Knex),
    transactionManager: app.make(TOKENS.TransactionManager)
  };
}

export { registerDatabaseRuntime };
