import { retryDeadlocks } from "./repositoryOptions.js";

/**
 * Runs work in a transaction of the database's Knex instance, retrying deadlocks,
 * or in the transaction the caller already holds.
 * @param {object} dependencies
 * @param {import("../server/types.js").RuntimeKnex} dependencies.knex
 */
function createTransactionManager({ knex }) {
  /**
   * @template T
   * @param {(trx: import("knex").Knex.Transaction) => Promise<T>} work
   * @param {{ trx?: import("knex").Knex.Transaction | null }} [options] A transaction to run in instead of a new one.
   */
  async function inTransaction(work, { trx = null } = {}) {
    if (typeof work !== "function") {
      throw new TypeError("inTransaction requires a callback function.");
    }

    if (trx) {
      return work(trx);
    }

    return retryDeadlocks(() => knex.transaction((nextTrx) => work(nextTrx)));
  }

  return Object.freeze({ inTransaction });
}

export { createTransactionManager };
