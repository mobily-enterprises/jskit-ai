/**
 * The invoice rollup's persistence: the queries of the invoices table its
 * feature owns, on that table's handle. The handle adds the workspace to every
 * statement, so no query names it.
 * @param {{ invoices: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} dependencies
 */
function createInvoiceRollup({ invoices }) {
  /**
   * How many invoices of each status the workspace issued each month, and their total.
   * @param {Record<string, never>} input
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  function totalsByMonth(input, options) {
    return invoices.aggregate({
      groupBy: ["status", { field: "issuedAt", bucket: "month", as: "month" }],
      measures: { invoices: { count: "*" }, amount: { sum: "amount" } },
      sort: ["month"]
    }, options);
  }

  return Object.freeze({
    withTransaction: invoices.withTransaction,
    totalsByMonth
  });
}

export { createInvoiceRollup };
