import { Type } from "@fastify/type-provider-typebox";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

const contactBodySchema = Type.Object(
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

const contactQuerySchema = Type.Object(
  {
    dryRun: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const contactParamsSchema = Type.Object(
  {
    contactId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const contactRecordSchema = Type.Object(
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

const contactSuccessSchema = Type.Object(
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
    contact: contactRecordSchema
  },
  { additionalProperties: false }
);

const contactDomainErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.String({ minLength: 1 }),
    details: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const contactByIdResponseSchema = Object.freeze(
  withStandardErrorResponses(
    {
      200: contactByIdSuccessSchema
    },
    { includeValidation400: true }
  )
);

const contactResponseSchema = Object.freeze(
  withStandardErrorResponses(
    {
    200: contactSuccessSchema,
    422: contactDomainErrorSchema
    },
    { includeValidation400: true }
  )
);

const contactIntakeRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: {
    schema: contactBodySchema
  },
  query: {
    schema: contactQuerySchema
  },
  response: contactResponseSchema
});

const contactPreviewFollowupRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: {
    schema: contactBodySchema
  },
  query: {
    schema: contactQuerySchema
  },
  response: contactResponseSchema
});

const contactByIdRouteContract = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: {
    schema: contactParamsSchema
  },
  response: contactByIdResponseSchema
});

function normalizeContactBody(rawBody) {
  return {
    name: String(rawBody?.name || "").trim(),
    email: String(rawBody?.email || "").trim().toLowerCase(),
    company: String(rawBody?.company || "").trim(),
    employees: Number(rawBody?.employees || 0),
    plan: String(rawBody?.plan || "").trim().toLowerCase(),
    source: String(rawBody?.source || "").trim().toLowerCase(),
    country: String(rawBody?.country || "").trim().toUpperCase(),
    consentMarketing: Boolean(rawBody?.consentMarketing)
  };
}

function normalizeContactQuery(rawQuery) {
  return {
    dryRun: rawQuery?.dryRun === true || rawQuery?.dryRun === "true"
  };
}

function normalizeContactParams(rawParams) {
  return {
    contactId: String(rawParams?.contactId || "").trim()
  };
}

const contactIntakeRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: {
    schema: contactBodySchema,
    normalize: normalizeContactBody
  },
  query: {
    schema: contactQuerySchema,
    normalize: normalizeContactQuery
  },
  response: contactResponseSchema
});

const contactPreviewFollowupRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: {
    schema: contactBodySchema,
    normalize: normalizeContactBody
  },
  query: {
    schema: contactQuerySchema,
    normalize: normalizeContactQuery
  },
  response: contactResponseSchema
});

const contactByIdRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: {
    schema: contactParamsSchema,
    normalize: normalizeContactParams
  },
  response: contactByIdResponseSchema
});

// Backward-compat export used by earlier stage files in this chapter.
const contactRouteSchema = Object.freeze({
  body: contactBodySchema,
  response: contactResponseSchema
});

export {
  contactBodySchema,
  contactQuerySchema,
  contactParamsSchema,
  contactRecordSchema,
  contactSuccessSchema,
  contactByIdSuccessSchema,
  contactDomainErrorSchema,
  contactByIdResponseSchema,
  contactResponseSchema,
  contactIntakeRouteContract,
  contactPreviewFollowupRouteContract,
  contactByIdRouteContract,
  contactIntakeRouteContractStage7,
  contactPreviewFollowupRouteContractStage7,
  contactByIdRouteContractStage7,
  contactRouteSchema
};
