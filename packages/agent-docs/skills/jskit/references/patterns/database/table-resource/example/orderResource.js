import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

// The orders table: one workspace owns each row. Shared with the client; the
// owner feature lists it in `owns` on the server.
const orderResource = defineTableResource({
  name: "orders",
  tableName: "orders",
  ownership: "workspace",
  lockVersionField: "lockVersion",
  schema: {
    workspaceId: { type: "id", required: true, hidden: true },
    customerId: { type: "id", required: true, search: true, lookup: "customers" },
    reference: { type: "string", maxLength: 64, required: true, search: true },
    status: { type: "string", maxLength: 32, search: true, defaultTo: "open" },
    total: { type: "number", defaultTo: 0 },
    lockVersion: { type: "integer", min: 0, readOnly: true, defaultTo: 0 },
    createdAt: { type: "dateTime", temporalPrecision: 0, readOnly: true }
  },
  searchSchema: {
    q: { type: "string", oneOf: ["reference"], filterOperator: "like" }
  },
  defaultSort: ["-createdAt"]
});

export { orderResource };
