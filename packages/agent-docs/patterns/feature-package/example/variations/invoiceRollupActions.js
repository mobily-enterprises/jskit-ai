import { emptyInputValidator } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

const ACTION_GET_ROLLUP_STATUS = "invoices.rollup.status.read";

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
      id: ACTION_GET_ROLLUP_STATUS,
      input: emptyInputValidator,
      output: null,
      execute: (input, context) => invoiceRollup.getStatus(input, { context })
    })
  ]);
}

export { ACTION_GET_ROLLUP_STATUS, createInvoiceRollupActions };
