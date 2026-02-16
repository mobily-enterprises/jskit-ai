import { Type } from "@fastify/type-provider-typebox";
import { registerTypeBoxFormats } from "./registerTypeBoxFormats.js";

registerTypeBoxFormats();

const DECIMAL_STRING_PATTERN = "^-?\\d+(?:\\.\\d+)?$";
const NON_NEGATIVE_DECIMAL_STRING_PATTERN = "^(?:0|[1-9]\\d*)(?:\\.\\d+)?$";

const annuityCalculatorAssumptionsSchema = Type.Object(
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

export const annuityCalculatorResponseSchema = Type.Object(
  {
    historyId: Type.String({ format: "uuid" }),
    mode: Type.Union([Type.Literal("fv"), Type.Literal("pv")]),
    timing: Type.Union([Type.Literal("ordinary"), Type.Literal("due")]),
    payment: Type.String({ pattern: DECIMAL_STRING_PATTERN }),
    annualRate: Type.String({ pattern: DECIMAL_STRING_PATTERN }),
    annualGrowthRate: Type.String({ pattern: DECIMAL_STRING_PATTERN }),
    years: Type.Union([Type.String({ pattern: NON_NEGATIVE_DECIMAL_STRING_PATTERN }), Type.Null()]),
    paymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    periodicRate: Type.String({ pattern: DECIMAL_STRING_PATTERN }),
    periodicGrowthRate: Type.String({ pattern: DECIMAL_STRING_PATTERN }),
    totalPeriods: Type.Union([Type.String({ pattern: NON_NEGATIVE_DECIMAL_STRING_PATTERN }), Type.Null()]),
    isPerpetual: Type.Boolean(),
    value: Type.String({ pattern: DECIMAL_STRING_PATTERN }),
    warnings: Type.Array(Type.String({ minLength: 1 })),
    assumptions: annuityCalculatorAssumptionsSchema
  },
  {
    additionalProperties: false
  }
);
