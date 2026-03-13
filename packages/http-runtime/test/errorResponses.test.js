import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDARD_ERROR_STATUS_CODES,
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  fastifyDefaultErrorResponseSchema,
  enumSchema,
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
  assert.equal(responses[400].schema.anyOf.length, 2);
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

  assert.equal(responses[400].schema.anyOf.length, 3);
  assert.deepEqual(
    responses[400].schema.anyOf.map((schema) => schema.type),
    [apiValidationErrorResponseSchema.type, apiErrorResponseSchema.type, fastifyDefaultErrorResponseSchema.type]
  );
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
      400: {
        schema: custom400
      }
    },
    { includeValidation400: true }
  );

  assert.equal(responses[400].schema, custom400);
});

test("enumSchema creates a literal union", () => {
  const schema = enumSchema(["one", "two", "three"]);

  assert.equal(schema.anyOf.length, 3);
  assert.deepEqual(
    schema.anyOf.map((entry) => entry.const),
    ["one", "two", "three"]
  );
});
