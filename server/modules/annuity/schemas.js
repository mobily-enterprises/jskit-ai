import { Type } from "@fastify/type-provider-typebox";
import { registerTypeBoxFormats } from "../api/schema/formats.schema.js";

registerTypeBoxFormats();

const decimalStringPattern = "^-?\\d+(?:\\.\\d+)?$";
const nonNegativeDecimalStringPattern = "^(?:0|[1-9]\\d*)(?:\\.\\d+)?$";

const body = Type.Object(
  {
    mode: Type.Union([Type.Literal("fv"), Type.Literal("pv")]),
    timing: Type.Union([Type.Literal("ordinary"), Type.Literal("due")]),
    payment: Type.Number({ exclusiveMinimum: 0 }),
    annualRate: Type.Number({ exclusiveMinimum: -100 }),
    annualGrowthRate: Type.Optional(Type.Number({ exclusiveMinimum: -100, default: 0 })),
    years: Type.Optional(Type.Number({ minimum: 0 })),
    paymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    isPerpetual: Type.Optional(Type.Boolean({ default: false }))
  },
  {
    additionalProperties: false
  }
);

const assumptions = Type.Object(
  {
    rateConversion: Type.String({ minLength: 1 }),
    timing: Type.String({ minLength: 1 }),
    growingAnnuity: Type.String({ minLength: 1 }),
    perpetuity: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const response = Type.Object(
  {
    historyId: Type.String({ format: "uuid" }),
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
    value: Type.String({ pattern: decimalStringPattern }),
    warnings: Type.Array(Type.String({ minLength: 1 })),
    assumptions
  },
  {
    additionalProperties: false
  }
);

const schema = {
  body,
  response
};

export { schema };
