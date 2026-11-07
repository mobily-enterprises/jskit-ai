import { emptyInputValidator } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

const ACTION_READ_MONTHLY_TOTALS = "invoices.rollup.monthly-totals.read";

/** The fields every invoice rollup query shares, spread first into each definition: they run on the admin surface. */
const ROLLUP_QUERY = Object.freeze({
  version: 1,
  kind: "query",
  channels: ["api", "assistant", "internal"],
  surfaces: ["admin"]
});

/** @param {{ invoiceRollup: import("./types.js").InvoiceRollup }} dependencies */
function createInvoiceRollupActions({ invoiceRollup }) {
  return Object.freeze([
    Object.freeze({
      ...ROLLUP_QUERY,
      id: ACTION_READ_MONTHLY_TOTALS,
      input: emptyInputValidator,
      output: null,
      execute: (input, context) => invoiceRollup.totalsByMonth(input, { context })
    })
  ]);
}

export { ACTION_READ_MONTHLY_TOTALS, createInvoiceRollupActions };
