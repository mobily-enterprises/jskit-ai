import { createWithTransaction } from "@jskit-ai/database-runtime/shared";

/**
 * The invoice rollup's persistence: a reviewed custom Knex repository.
 * @param {{ knex: import("@jskit-ai/database-runtime/server/types").RuntimeKnex }} dependencies
 */
function createInvoiceRollup({ knex }) {
  const withTransaction = createWithTransaction(knex);

  async function getStatus(input, options = {}) {
    return {
      ok: true,
      feature: "invoice-rollup",
      persistence: "custom-knex",
      tableName: "invoice_rollups",
      hasTransaction: Boolean(options.trx),
      input
    };
  }

  async function execute(input, options = {}) {
    return {
      accepted: false,
      feature: "invoice-rollup",
      persistence: "custom-knex",
      tableName: "invoice_rollups",
      hasTransaction: Boolean(options.trx),
      input,
      message: "Replace this example with the reviewed domain-specific query."
    };
  }

  return Object.freeze({
    withTransaction,
    getStatus,
    execute
  });
}

export { createInvoiceRollup };
