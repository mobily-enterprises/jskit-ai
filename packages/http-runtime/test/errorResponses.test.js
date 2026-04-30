import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDARD_ERROR_STATUS_CODES,
  apiErrorOutputValidator,
  apiValidationErrorOutputValidator,
  apiErrorTransportSchema,
  apiValidationErrorTransportSchema,
  fastifyDefaultErrorTransportSchema,
  enumSchema,
  createTransportResponseSchema,
  withStandardErrorResponses
} from "../src/shared/validators/errorResponses.js";

test("withStandardErrorResponses includes standard statuses", () => {
  const success = {
    200: {
      schema: {
        type: "string"
      }
    }
  };

  const responses = withStandardErrorResponses(success);

  assert.equal(responses[200].schema.type, "string");
  for (const statusCode of STANDARD_ERROR_STATUS_CODES) {
    assert.ok(responses[statusCode], `missing status ${statusCode}`);
  }
  assert.equal(responses[400].transportSchema.anyOf.length, 2);
  assert.deepEqual(responses[400].transportSchema.anyOf[0], {
    allOf: [{
      $ref: "#/definitions/ApiErrorOutput"
    }]
  });
  assert.equal(responses[400].transportSchema.definitions.ApiErrorOutput.type, "object");
  assert.equal(
    responses[400].transportSchema.definitions.ApiErrorOutput.properties.details.allOf[0].$ref,
    "#/definitions/ApiErrorOutput__SchemaNode_1_replace"
  );
});

test("withStandardErrorResponses uses validation union for 400 when enabled", () => {
  const responses = withStandardErrorResponses(
    {
      201: {
        schema: {
          type: "null"
        }
      }
    },
    { includeValidation400: true }
  );

  assert.equal(responses[400].transportSchema.anyOf.length, 3);
  assert.deepEqual(responses[400].transportSchema.anyOf[0], {
    allOf: [{
      $ref: "#/definitions/ApiValidationErrorOutput"
    }]
  });
  assert.deepEqual(responses[400].transportSchema.anyOf[1], {
    allOf: [{
      $ref: "#/definitions/ApiErrorOutput"
    }]
  });
  assert.equal(responses[400].transportSchema.anyOf[2].type, fastifyDefaultErrorTransportSchema.type);
  assert.equal(responses[400].transportSchema.definitions.ApiValidationErrorOutput.type, "object");
  assert.equal(responses[400].transportSchema.definitions.ApiErrorOutput.type, "object");
});

test("withStandardErrorResponses does not override existing error schemas", () => {
  const custom400 = {
    type: "object",
    properties: {
      error: {
        type: "string"
      }
    }
  };
  const responses = withStandardErrorResponses(
    {
      200: {
        schema: {
          type: "string"
        }
      },
      400: createTransportResponseSchema(custom400)
    },
    { includeValidation400: true }
  );

  assert.equal(responses[400].transportSchema, custom400);
});

test("enumSchema creates a literal union", () => {
  const schema = enumSchema(["one", "two", "three"]);

  assert.equal(schema.anyOf.length, 3);
  assert.deepEqual(
    schema.anyOf.map((entry) => entry.const),
    ["one", "two", "three"]
  );
});

test("error response validators export transport schemas from the same contracts", () => {
  assert.equal(apiErrorOutputValidator.mode, "replace");
  assert.equal(apiValidationErrorOutputValidator.mode, "replace");
  assert.equal(apiErrorTransportSchema.type, "object");
  assert.equal(apiValidationErrorTransportSchema.type, "object");
  assert.equal(apiErrorTransportSchema.properties.details.allOf[0].$ref, "#/definitions/SchemaNode_1_replace");
  assert.equal(
    apiValidationErrorTransportSchema.properties.details.allOf[0].$ref,
    "#/definitions/SchemaNode_1_replace"
  );
  assert.equal(
    apiValidationErrorTransportSchema.definitions.SchemaNode_1_replace.required.includes("fieldErrors"),
    true
  );
});
