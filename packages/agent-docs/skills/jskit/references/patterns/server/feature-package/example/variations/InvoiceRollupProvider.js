import { defineFeature } from "@jskit-ai/kernel/server/features";
import { emptyInputValidator } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { createRepository } from "./customKnexRepository.js";

/** @param {{ invoiceRollup: import("./types.js").InvoiceRollup }} dependencies */
function createInvoiceRollupActions({ invoiceRollup }) {
  return Object.freeze([
    Object.freeze({
      id: "invoices.rollup.status.read",
      kind: "query",
      input: emptyInputValidator,
      idempotency: "none",
      execute: (input, context) => invoiceRollup.getStatus(input, { context })
    })
  ]);
}

const InvoiceRollupProvider = defineFeature({
  id: "feature.invoice-rollup",
  domain: "invoices",
  requires: {
    database: "runtime.database"
  },
  provides: {
    invoiceRollup: "feature.invoice-rollup"
  },
  actionDefaults: {
    channels: ["api", "assistant", "internal"],
    surfaces: ["admin"]
  },
  /** @param {{ database: import("@jskit-ai/database-runtime/server/types").RuntimeDatabase }} capabilities */
  setup({ database }) {
    return {
      invoiceRollup: createRepository({ knex: database.knex })
    };
  },
  actions({ invoiceRollup }) {
    return createInvoiceRollupActions({ invoiceRollup });
  }
});

export { InvoiceRollupProvider };
