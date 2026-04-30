import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const fieldErrorsFieldDefinition = deepFreeze({
  type: "object",
  values: {
    type: "string",
    minLength: 1
  }
});

const apiErrorDetailsSchema = createSchema({
  fieldErrors: {
    ...fieldErrorsFieldDefinition,
    required: false
  }
});

const apiValidationErrorDetailsSchema = createSchema({
  fieldErrors: {
    ...fieldErrorsFieldDefinition,
    required: true
  }
});

const apiErrorOutputValidator = deepFreeze({
  schema: createSchema({
    error: { type: "string", required: true, minLength: 1 },
    code: { type: "string", required: false, minLength: 1 },
    details: {
      type: "object",
      required: false,
      schema: apiErrorDetailsSchema,
      additionalProperties: true
    },
    fieldErrors: {
      ...fieldErrorsFieldDefinition,
      required: false
    }
  }),
  mode: "replace"
});

const apiValidationErrorOutputValidator = deepFreeze({
  schema: createSchema({
    error: { type: "string", required: true, minLength: 1 },
    code: { type: "string", required: false, minLength: 1 },
    fieldErrors: {
      ...fieldErrorsFieldDefinition,
      required: true
    },
    details: {
      type: "object",
      required: true,
      schema: apiValidationErrorDetailsSchema,
      additionalProperties: true
    }
  }),
  mode: "replace"
});

const apiErrorTransportSchema = apiErrorOutputValidator.schema.toJsonSchema({
  mode: apiErrorOutputValidator.mode
});

const apiValidationErrorTransportSchema = apiValidationErrorOutputValidator.schema.toJsonSchema({
  mode: apiValidationErrorOutputValidator.mode
});

const fastifyDefaultErrorTransportSchema = {
  type: "object",
  additionalProperties: true,
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer", minimum: 400, maximum: 599 },
    error: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
    details: {},
    fieldErrors: {
      type: "object",
      additionalProperties: {
        type: "string"
      }
    }
  }
};

const STANDARD_ERROR_STATUS_CODES = [400, 401, 403, 404, 409, 422, 429, 500, 503];

function rewriteEmbeddedTransportSchemaRefs(value, {
  rootRef = "#",
  definitionRefByName = {}
} = {}) {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteEmbeddedTransportSchemaRefs(entry, {
      rootRef,
      definitionRefByName
    }));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const rewritten = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") {
      if (entry === "#") {
        rewritten[key] = rootRef;
        continue;
      }

      if (entry.startsWith("#/definitions/")) {
        const definitionName = entry.slice("#/definitions/".length);
        rewritten[key] = definitionRefByName[definitionName] || entry;
        continue;
      }
    }

    rewritten[key] = rewriteEmbeddedTransportSchemaRefs(entry, {
      rootRef,
      definitionRefByName
    });
  }

  return rewritten;
}

function createEmbeddableTransportSchemaDocument(schemaDocument = {}, rootDefinitionName = "TransportSchema") {
  const {
    $schema: _jsonSchemaDraft,
    definitions: sourceDefinitions = {},
    ...rootSchema
  } = schemaDocument || {};

  const rootRef = `#/definitions/${rootDefinitionName}`;
  const definitionRefByName = {};
  const definitions = {};

  for (const definitionName of Object.keys(sourceDefinitions)) {
    definitionRefByName[definitionName] = `#/definitions/${rootDefinitionName}__${definitionName}`;
  }

  definitions[rootDefinitionName] = rewriteEmbeddedTransportSchemaRefs(rootSchema, {
    rootRef,
    definitionRefByName
  });

  for (const [definitionName, definitionSchema] of Object.entries(sourceDefinitions)) {
    definitions[`${rootDefinitionName}__${definitionName}`] = rewriteEmbeddedTransportSchemaRefs(definitionSchema, {
      rootRef,
      definitionRefByName
    });
  }

  return {
    schema: {
      allOf: [{
        $ref: rootRef
      }]
    },
    definitions
  };
}

function createTransportResponseSchema(schema = {}) {
  return {
    transportSchema: schema
  };
}

const embeddedApiErrorTransportSchema = createEmbeddableTransportSchemaDocument(
  apiErrorTransportSchema,
  "ApiErrorOutput"
);

const embeddedApiValidationErrorTransportSchema = createEmbeddableTransportSchemaDocument(
  apiValidationErrorTransportSchema,
  "ApiValidationErrorOutput"
);

const sharedErrorTransportDefinitions = {
  ...embeddedApiValidationErrorTransportSchema.definitions,
  ...embeddedApiErrorTransportSchema.definitions
};

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
      responses[statusCode] = createTransportResponseSchema({
        anyOf: [
          embeddedApiValidationErrorTransportSchema.schema,
          embeddedApiErrorTransportSchema.schema,
          fastifyDefaultErrorTransportSchema
        ],
        definitions: sharedErrorTransportDefinitions
      });
      continue;
    }

    responses[statusCode] = createTransportResponseSchema({
      anyOf: [
        embeddedApiErrorTransportSchema.schema,
        fastifyDefaultErrorTransportSchema
      ],
      definitions: embeddedApiErrorTransportSchema.definitions
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
  fieldErrorsFieldDefinition,
  apiErrorDetailsSchema,
  apiValidationErrorDetailsSchema,
  apiErrorOutputValidator,
  apiValidationErrorOutputValidator,
  apiErrorTransportSchema,
  apiValidationErrorTransportSchema,
  fastifyDefaultErrorTransportSchema,
  STANDARD_ERROR_STATUS_CODES,
  createTransportResponseSchema,
  passthroughErrorResponses,
  withStandardErrorResponses,
  enumSchema
};
