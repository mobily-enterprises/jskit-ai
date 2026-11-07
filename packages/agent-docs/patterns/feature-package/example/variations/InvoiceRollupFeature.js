import { defineFeature } from "@jskit-ai/kernel/server/features";
import { invoiceResource } from "./invoiceResource.js";
import { createInvoiceRollup } from "./ownedTableRepository.js";
import { createInvoiceRollupActions } from "./invoiceRollupActions.js";

const InvoiceRollupFeature = defineFeature({
  id: "feature.invoice-rollup",
  domain: "invoices",
  owns: [invoiceResource],
  provides: {
    invoiceRollup: "feature.invoice-rollup"
  },
  /** @param {{ resources: { invoices: import("@jskit-ai/resource-runtime/server/types").ResourceHandle } }} capabilities */
  setup({ resources }) {
    return { invoiceRollup: createInvoiceRollup({ invoices: resources.invoices }) };
  },
  actions({ invoiceRollup }) {
    return createInvoiceRollupActions({ invoiceRollup });
  }
});

export { InvoiceRollupFeature };
