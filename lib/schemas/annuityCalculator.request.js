import { Type } from "@fastify/type-provider-typebox";

export const annuityCalculatorRequestBodySchema = Type.Object(
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
