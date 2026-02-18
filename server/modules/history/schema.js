import { Type } from "@fastify/type-provider-typebox";
import { createPaginationQuerySchema } from "../api/schema/paginationQuery.schema.js";
import { registerTypeBoxFormats } from "../api/schema/formats.schema.js";

registerTypeBoxFormats();

const decimalStringPattern = "^-?\\d+(?:\\.\\d+)?$";
const nonNegativeDecimalStringPattern = "^(?:0|[1-9]\\d*)(?:\\.\\d+)?$";

const query = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const entry = Type.Object(
  {
    id: Type.String({ format: "uuid" }),
    createdAt: Type.String({ format: "iso-utc-date-time" }),
    mode: Type.Union([Type.Literal("fv"), Type.Literal("pv")]),
    timing: Type.Union([Type.Literal("ordinary"), Type.Literal("due")]),
    payment: Type.String({ pattern: decimalStringPattern }),
    annualRate: Type.String({ pattern: decimalStringPattern }),
    annualGrowthRate: Type.String({ pattern: decimalStringPattern }),
    years: Type.Union([Type.String({ pattern: nonNegativeDecimalStringPattern }), Type.Null()]),
    paymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    periodicRate: Type.String({ pattern: decimalStringPattern }),
    periodicGrowthRate: Type.String({ pattern: decimalStringPattern }),
    totalPeriods: Type.Union([Type.String({ pattern: nonNegativeDecimalStringPattern }), Type.Null()]),
    isPerpetual: Type.Boolean(),
    value: Type.String({ pattern: decimalStringPattern })
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
