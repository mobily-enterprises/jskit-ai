import { defineFeature } from "@jskit-ai/kernel/server/features";
import { emptyInputValidator } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { createRepository } from "./repository.js";

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
  setup({ database }) {
    return {
      invoiceRollup: createRepository({ knex: database.knex })
    };
  },
  actions({ invoiceRollup }) {
    return [{
      id: "invoices.rollup.status.read",
      kind: "query",
      input: emptyInputValidator,
      idempotency: "none",
      async execute(input, context) {
        return invoiceRollup.getStatus(input, { context });
      }
    }];
  }
});

export { InvoiceRollupProvider };
