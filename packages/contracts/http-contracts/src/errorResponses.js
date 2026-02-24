import { Type } from "@fastify/type-provider-typebox";

const fieldErrorsSchema = Type.Record(Type.String(), Type.String());

const apiErrorDetailsSchema = Type.Object(
  {
    fieldErrors: Type.Optional(fieldErrorsSchema)
  },
  {
    additionalProperties: true
  }
);

const apiErrorResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    details: Type.Optional(apiErrorDetailsSchema),
    fieldErrors: Type.Optional(fieldErrorsSchema)
  },
  {
    additionalProperties: false
  }
);

const apiValidationErrorResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    fieldErrors: fieldErrorsSchema,
    details: Type.Object(
      {
        fieldErrors: fieldErrorsSchema
      },
      {
        additionalProperties: true
      }
    )
  },
  {
    additionalProperties: false
  }
);

const fastifyDefaultErrorResponseSchema = Type.Object(
  {
    statusCode: Type.Integer({ minimum: 400, maximum: 599 }),
    error: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(fieldErrorsSchema)
  },
  {
    additionalProperties: true
  }
);

const STANDARD_ERROR_STATUS_CODES = [400, 401, 403, 404, 409, 422, 429, 500, 503];

function withStandardErrorResponses(successResponses, { includeValidation400 = false } = {}) {
  const responses = {
    ...successResponses
  };

  for (const statusCode of STANDARD_ERROR_STATUS_CODES) {
    if (responses[statusCode]) {
      continue;
    }

    if (statusCode === 400 && includeValidation400) {
      responses[statusCode] = Type.Union([
        apiValidationErrorResponseSchema,
        apiErrorResponseSchema,
        fastifyDefaultErrorResponseSchema
      ]);
      continue;
    }

    responses[statusCode] = Type.Union([apiErrorResponseSchema, fastifyDefaultErrorResponseSchema]);
  }

  return responses;
}

function enumSchema(values) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

export {
  fieldErrorsSchema,
  apiErrorDetailsSchema,
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  fastifyDefaultErrorResponseSchema,
  STANDARD_ERROR_STATUS_CODES,
  withStandardErrorResponses,
  enumSchema
};
