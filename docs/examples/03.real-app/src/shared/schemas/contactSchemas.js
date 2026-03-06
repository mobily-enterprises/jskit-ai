import { Type } from "@fastify/type-provider-typebox";

/**
 * Chapter 3 baseline route contracts (Stages 1-6).
 *
 * How this maps to controller flow:
 * - POST routes: controller/action reads body (+ query when needed).
 * - GET by id route: controller/action reads params.contactId.
 * - These route contracts validate incoming request data before controller code runs.
 * - Controller/action responses are expected to match the response maps below.
 *
 * Stage 7 adds normalization in a separate file:
 * - ./contactSchemasStage7.js
 */

// 1) Incoming request schemas (transport validation).
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

const contactIntakePreviewQuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const contactByIdParamsSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

// 2) Contact read model schema (what a stored/retrieved contact record looks like).
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

// 3) Success response schemas.
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

// 4) Error response schemas.
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

// 5) Response maps by route family.
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

// 6) Route contracts consumed by router.register(...).
const contactIntakePostRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: {
    schema: contactIntakePreviewBodySchema
  },
  query: {
    schema: contactIntakePreviewQuerySchema
  },
  response: contactIntakePreviewResponseSchema
});

const contactPreviewFollowupPostRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: {
    schema: contactIntakePreviewBodySchema
  },
  query: {
    schema: contactIntakePreviewQuerySchema
  },
  response: contactIntakePreviewResponseSchema
});

const contactByIdGetRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: {
    schema: contactByIdParamsSchema
  },
  response: contactByIdResponseSchema
});

export {
  contactIntakePostRouteContract,
  contactPreviewFollowupPostRouteContract,
  contactByIdGetRouteContract
};
