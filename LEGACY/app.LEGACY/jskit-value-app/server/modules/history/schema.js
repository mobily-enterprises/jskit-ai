import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "@jskit-ai/http-contracts/paginationQuery";

const decimalStringPattern = "^-?\\d+(?:\\.\\d+)?$";

const query = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const entry = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    DEG2RAD_operation: Type.Literal("DEG2RAD"),
    DEG2RAD_formula: Type.String({ minLength: 1 }),
    DEG2RAD_degrees: Type.String({ pattern: decimalStringPattern }),
    DEG2RAD_radians: Type.String({ pattern: decimalStringPattern })
  },
  {
    additionalProperties: false
  }
);

const listEntry = Type.Object(
  {
    ...entry.properties,
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const list = Type.Object(
  {
    entries: Type.Array(listEntry),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const schema = {
  query,
  entry,
  response: {
    list
  }
};

export { schema };
