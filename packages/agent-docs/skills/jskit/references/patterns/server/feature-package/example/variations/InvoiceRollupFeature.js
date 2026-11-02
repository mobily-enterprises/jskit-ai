import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createInvoiceRollup } from "./customKnexRepository.js";
import { createInvoiceRollupActions } from "./invoiceRollupActions.js";

const InvoiceRollupFeature = defineFeature({
  id: "feature.invoice-rollup",
  domain: "invoices",
  requires: {
    database: "runtime.database"
  },
  provides: {
    invoiceRollup: "feature.invoice-rollup"
  },
  /** @param {{ database: import("@jskit-ai/database-runtime/server/types").RuntimeDatabase }} capabilities */
  setup({ database }) {
    return { invoiceRollup: createInvoiceRollup({ knex: database.knex }) };
  },
  actions({ invoiceRollup }) {
    return createInvoiceRollupActions({ invoiceRollup });
  }
});

export { InvoiceRollupFeature };
