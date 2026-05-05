import { createWithTransaction } from "@jskit-ai/database-runtime/shared";

const FEATURE_TABLE_NAME = "${option:feature-name|snake}";
const FEATURE_NAME = "${option:feature-name|kebab}";

function createRepository({ knex } = {}) {
  if (!knex) {
    throw new TypeError("createRepository requires knex.");
  }

  const withTransaction = createWithTransaction(knex);

  return Object.freeze({
    withTransaction,
    async getStatus(input = {}, options = {}) {
      return {
        ok: true,
        feature: FEATURE_NAME,
        persistence: "custom-knex",
        tableName: FEATURE_TABLE_NAME,
        hasTransaction: Boolean(options?.trx),
        input
      };
    },
    async execute(input = {}, options = {}) {
      return {
        accepted: false,
        feature: FEATURE_NAME,
        persistence: "custom-knex",
        tableName: FEATURE_TABLE_NAME,
        hasTransaction: Boolean(options?.trx),
        input,
        message: "Customize repository.execute() with explicit knex queries."
      };
    }
  });
}

export { createRepository };
