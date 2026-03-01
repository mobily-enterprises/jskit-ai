import { normalizeObject } from "@jskit-ai/support-core/normalize";
import { TransactionManagerError } from "./errors.js";

class TransactionManager {
  constructor({ knex } = {}) {
    if (!knex || typeof knex.transaction !== "function") {
      throw new TransactionManagerError("TransactionManager requires knex with transaction().");
    }

    this.knex = knex;
  }

  async inTransaction(work, { trx = null } = {}) {
    if (typeof work !== "function") {
      throw new TransactionManagerError("inTransaction requires a callback function.");
    }

    if (trx) {
      return work(trx);
    }

    return this.knex.transaction(async (nextTrx) => {
      return work(nextTrx);
    });
  }
}

function createTransactionManager(options = {}) {
  return new TransactionManager(normalizeObject(options));
}

export { TransactionManager, createTransactionManager };
