import { Type } from "@fastify/type-provider-typebox";
import {
  normalizeContactBody,
  normalizeContactParams
} from "../input/contactInputNormalizationStage6.js";

const contactIntakePreviewBodySchemaStage7 = Type.Object(
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

const contactByIdParamsSchemaStage7 = Type.Object(
  {
    contactId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const contactStoredRecordSchemaStage7 = Type.Object(
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

const contactIntakePreviewSuccessSchemaStage7 = Type.Object(
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

const contactByIdSuccessSchemaStage7 = Type.Object(
  {
    ok: Type.Boolean(),
    contact: contactStoredRecordSchemaStage7
  },
  { additionalProperties: false }
);

const contactFieldErrorsSchemaStage7 = Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }));

const contactDomainValidationErrorSchemaStage7 = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Literal("contact_domain_invalid"),
    details: Type.Object(
      {
        fieldErrors: contactFieldErrorsSchemaStage7
      },
      { additionalProperties: false }
    ),
    fieldErrors: contactFieldErrorsSchemaStage7
  },
  { additionalProperties: false }
);

const contactDuplicateConflictErrorSchemaStage7 = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Literal("duplicate_contact"),
    details: Type.Object(
      {
        fieldErrors: contactFieldErrorsSchemaStage7
      },
      { additionalProperties: false }
    ),
    fieldErrors: contactFieldErrorsSchemaStage7
  },
  { additionalProperties: false }
);

const contactNotFoundErrorSchemaStage7 = Type.Object(
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

const contactGenericErrorSchemaStage7 = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(contactFieldErrorsSchemaStage7),
    statusCode: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const contactByIdResponseSchemaStage7 = Object.freeze({
  200: contactByIdSuccessSchemaStage7,
  400: contactGenericErrorSchemaStage7,
  401: contactGenericErrorSchemaStage7,
  403: contactGenericErrorSchemaStage7,
  404: contactNotFoundErrorSchemaStage7,
  409: contactGenericErrorSchemaStage7,
  422: contactGenericErrorSchemaStage7,
  429: contactGenericErrorSchemaStage7,
  500: contactGenericErrorSchemaStage7,
  503: contactGenericErrorSchemaStage7
});

const contactIntakePreviewResponseSchemaStage7 = Object.freeze({
  200: contactIntakePreviewSuccessSchemaStage7,
  400: contactGenericErrorSchemaStage7,
  401: contactGenericErrorSchemaStage7,
  403: contactGenericErrorSchemaStage7,
  404: contactGenericErrorSchemaStage7,
  409: contactDuplicateConflictErrorSchemaStage7,
  422: contactDomainValidationErrorSchemaStage7,
  429: contactGenericErrorSchemaStage7,
  500: contactGenericErrorSchemaStage7,
  503: contactGenericErrorSchemaStage7
});

const contactIntakePostRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Create contact"
  },
  body: Object.freeze({
    schema: contactIntakePreviewBodySchemaStage7,
    normalize: normalizeContactBody
  }),
  response: contactIntakePreviewResponseSchemaStage7
});

const contactPreviewFollowupPostRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Preview follow-up"
  },
  body: Object.freeze({
    schema: contactIntakePreviewBodySchemaStage7,
    normalize: normalizeContactBody
  }),
  response: contactIntakePreviewResponseSchemaStage7
});

const contactByIdGetRouteContractStage7 = Object.freeze({
  meta: {
    tags: ["contacts"],
    summary: "Get contact by id"
  },
  params: Object.freeze({
    schema: contactByIdParamsSchemaStage7,
    normalize: normalizeContactParams
  }),
  response: contactByIdResponseSchemaStage7
});

export {
  contactByIdGetRouteContractStage7,
  contactIntakePostRouteContractStage7,
  contactPreviewFollowupPostRouteContractStage7
};
