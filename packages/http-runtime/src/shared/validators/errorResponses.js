const fieldErrorsSchema = {
  type: "object",
  additionalProperties: {
    type: "string"
  }
};

const apiErrorDetailsSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    fieldErrors: fieldErrorsSchema
  }
};

const apiErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
    details: apiErrorDetailsSchema,
    fieldErrors: fieldErrorsSchema
  }
};

const apiValidationErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "fieldErrors", "details"],
  properties: {
    error: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
    fieldErrors: fieldErrorsSchema,
    details: {
      type: "object",
      additionalProperties: true,
      required: ["fieldErrors"],
      properties: {
        fieldErrors: fieldErrorsSchema
      }
    }
  }
};

const fastifyDefaultErrorResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer", minimum: 400, maximum: 599 },
    error: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
    details: {},
    fieldErrors: fieldErrorsSchema
  }
};

const STANDARD_ERROR_STATUS_CODES = [400, 401, 403, 404, 409, 422, 429, 500, 503];

function transportResponseSchema(schema = {}) {
  return {
    transportSchema: schema
  };
}

function passthroughErrorResponses(successResponses) {
  return successResponses;
}

function withStandardErrorResponses(successResponses, { includeValidation400 = false } = {}) {
  const responses = {
    ...successResponses
  };

  for (const statusCode of STANDARD_ERROR_STATUS_CODES) {
    if (responses[statusCode]) {
      continue;
    }

    if (statusCode === 400 && includeValidation400) {
      responses[statusCode] = transportResponseSchema({
          anyOf: [
            apiValidationErrorResponseSchema,
            apiErrorResponseSchema,
            fastifyDefaultErrorResponseSchema
          ]
        });
      continue;
    }

    responses[statusCode] = transportResponseSchema({
      anyOf: [apiErrorResponseSchema, fastifyDefaultErrorResponseSchema]
    });
  }

  return responses;
}

function enumSchema(values) {
  return {
    anyOf: values.map((value) => ({ const: value }))
  };
}

export {
  fieldErrorsSchema,
  apiErrorDetailsSchema,
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  fastifyDefaultErrorResponseSchema,
  STANDARD_ERROR_STATUS_CODES,
  transportResponseSchema,
  passthroughErrorResponses,
  withStandardErrorResponses,
  enumSchema
};
