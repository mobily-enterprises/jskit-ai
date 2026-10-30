import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { retryDeadlocks } from "./repositoryOptions.js";

class TransactionManager {
  constructor({ knex } = {}) {
    if (!knex || typeof knex.transaction !== "function") {
      throw new TypeError("TransactionManager requires knex with transaction().");
    }

    this.knex = knex;
  }

  async inTransaction(work, { trx = null } = {}) {
    if (typeof work !== "function") {
      throw new TypeError("inTransaction requires a callback function.");
    }

    if (trx) {
      return work(trx);
    }

    return retryDeadlocks(() => this.knex.transaction(async (nextTrx) => {
      return work(nextTrx);
    }));
  }
}

function createTransactionManager(options = {}) {
  return new TransactionManager(normalizeObject(options));
}

export { TransactionManager, createTransactionManager };
