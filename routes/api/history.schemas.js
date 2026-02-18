import { Type } from "@fastify/type-provider-typebox";
import { HistoryEntrySchema } from "../../lib/schemas/historyEntrySchema.js";
import { createPaginationQuerySchema } from "../../lib/schemas/paginationQuerySchema.js";

const historyQuerySchema = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const historyEntryWithUsernameSchema = Type.Object(
  {
    ...HistoryEntrySchema.properties,
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const historyListResponseSchema = Type.Object(
  {
    entries: Type.Array(historyEntryWithUsernameSchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

export { historyQuerySchema, historyEntryWithUsernameSchema, historyListResponseSchema };
