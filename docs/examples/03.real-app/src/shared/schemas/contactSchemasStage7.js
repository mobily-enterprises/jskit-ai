import { Type } from "@fastify/type-provider-typebox";
import {
  normalizeContactBody,
  normalizeContactParams
} from "../input/contactInputNormalizationStage7.js";

const contactIntakePreviewBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ minLength: 5, maxLength: 200 }),
    company: Type.String({ minLength: 1, maxLength: 160 }),
    employees: Type.Integer({ minimum: 1, maximum: 1000000 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean()
  },
  { additionalProperties: false }
);

const contactByIdParamsSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const contactStoredRecordSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    company: Type.String({ minLength: 1 }),
    employees: Type.Integer({ minimum: 1 }),
    plan: Type.Union([Type.Literal("starter"), Type.Literal("growth"), Type.Literal("enterprise")]),
    source: Type.Union([Type.Literal("web"), Type.Literal("referral"), Type.Literal("webinar"), Type.Literal("partner")]),
    country: Type.String({ minLength: 2, maxLength: 2 }),
    consentMarketing: Type.Boolean(),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const contactIntakePreviewSuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    mode: Type.Union([Type.Literal("intake"), Type.Literal("preview")]),
    email: Type.String({ minLength: 1 }),
    score: Type.Integer({ minimum: 0, maximum: 100 }),
    segment: Type.String({ minLength: 1 }),
    followupPlan: Type.Array(Type.String({ minLength: 1 })),
    duplicateDetected: Type.Boolean(),
    persisted: Type.Boolean()
  },
  { additionalProperties: false }
);

const contactByIdSuccessSchema = Type.Object(
  {
    ok: Type.Boolean(),
    contact: contactStoredRecordSchema
  },
  { additionalProperties: false }
);

const contactIntakePreviewDomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const contactGenericErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(Type.Record(Type.String(), Type.String())),
    statusCode: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const contactByIdResponseSchema = Object.freeze({
  200: contactByIdSuccessSchema,
  400: contactGenericErrorSchema,
  401: contactGenericErrorSchema,
  403: contactGenericErrorSchema,
  404: contactGenericErrorSchema,
  409: contactGenericErrorSchema,
  422: contactGenericErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

const contactIntakePreviewResponseSchema = Object.freeze({
  200: contactIntakePreviewSuccessSchema,
  400: contactGenericErrorSchema,
  401: contactGenericErrorSchema,
  403: contactGenericErrorSchema,
  404: contactGenericErrorSchema,
  409: contactGenericErrorSchema,
  422: contactIntakePreviewDomainErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

const contactIntakePostRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: Object.freeze({
    schema: contactIntakePreviewBodySchema,
    normalize: normalizeContactBody
  }),
  response: contactIntakePreviewResponseSchema
});

const contactPreviewFollowupPostRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: Object.freeze({
    schema: contactIntakePreviewBodySchema,
    normalize: normalizeContactBody
  }),
  response: contactIntakePreviewResponseSchema
});

const contactByIdGetRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: Object.freeze({
    schema: contactByIdParamsSchema,
    normalize: normalizeContactParams
  }),
  response: contactByIdResponseSchema
});

export {
  contactIntakePostRouteContractStage7,
  contactPreviewFollowupPostRouteContractStage7,
  contactByIdGetRouteContractStage7
};
