import { Type } from "@fastify/type-provider-typebox";
import {
  normalizeContactBody,
  normalizeContactParams
} from "../input/contactInputNormalization.js";

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

const contactFieldErrorsSchema = Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }));

const contactDomainValidationErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Literal("contact_domain_invalid"),
    details: Type.Object(
      {
        fieldErrors: contactFieldErrorsSchema
      },
      { additionalProperties: false }
    ),
    fieldErrors: contactFieldErrorsSchema
  },
  { additionalProperties: false }
);

const contactDuplicateConflictErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Literal("duplicate_contact"),
    details: Type.Object(
      {
        fieldErrors: contactFieldErrorsSchema
      },
      { additionalProperties: false }
    ),
    fieldErrors: contactFieldErrorsSchema
  },
  { additionalProperties: false }
);

const contactNotFoundErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Literal("contact_not_found"),
    details: Type.Object(
      {
        contactId: Type.String()
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
);

const contactGenericErrorSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(contactFieldErrorsSchema),
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
  404: contactNotFoundErrorSchema,
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
  409: contactDuplicateConflictErrorSchema,
  422: contactDomainValidationErrorSchema,
  429: contactGenericErrorSchema,
  500: contactGenericErrorSchema,
  503: contactGenericErrorSchema
});

const contactIntakePostRouteValidator = Object.freeze({
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

const contactPreviewFollowupPostRouteValidator = Object.freeze({
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

const contactByIdGetRouteValidator = Object.freeze({
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
  contactByIdGetRouteValidator,
  contactIntakePostRouteValidator,
  contactPreviewFollowupPostRouteValidator
};
