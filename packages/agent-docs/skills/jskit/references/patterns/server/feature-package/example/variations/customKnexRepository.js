import { createWithTransaction } from "@jskit-ai/database-runtime/shared";

function createRepository({ knex } = {}) {
  if (!knex) {
    throw new TypeError("createRepository requires knex.");
  }

  return Object.freeze({
    withTransaction: createWithTransaction(knex),
    async getStatus(input = {}, options = {}) {
      return {
        ok: true,
        feature: "invoice-rollup",
        persistence: "custom-knex",
        tableName: "invoice_rollups",
        hasTransaction: Boolean(options.trx),
        input
      };
    },
    async execute(input = {}, options = {}) {
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
  });
}

export { createRepository };
