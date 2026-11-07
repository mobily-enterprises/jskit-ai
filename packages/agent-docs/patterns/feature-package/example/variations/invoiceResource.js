import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** The invoices table: its fields, and the workspace that owns each row. Shared with the client. */
const invoiceResource = defineTableResource({
  name: "invoices",
  tableName: "invoices",
  ownership: "workspace",
  schema: {
    status: { type: "string", required: true, search: true },
    amount: { type: "number", required: true },
    issuedAt: { type: "dateTime", required: true }
  }
});

export { invoiceResource };
