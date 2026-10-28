import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDARD_ERROR_STATUS_CODES,
  apiErrorOutputValidator,
  apiValidationErrorOutputValidator,
  apiErrorTransportSchema,
  apiValidationErrorTransportSchema,
  fastifyDefaultErrorTransportSchema,
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

test("standard error schemas preserve optional transaction outcomes during serialization", () => {
  const outcomes = ["none", "pending", "committed", "rolledBack", "unknown"];
  for (const schema of [apiErrorTransportSchema, apiValidationErrorTransportSchema, fastifyDefaultErrorTransportSchema]) {
    assert.deepEqual(schema.properties.transactionOutcome.enum, outcomes);
    assert.equal(schema.required.includes("transactionOutcome"), false);
  }
});

test("standard error response schemas keep the params, messageCode and field codes of real errors", async (t) => {
  const { default: Fastify } = await import("fastify");
  const { registerApiErrorHandler } = await import("../../kernel/server/http/errorHandling.js");
  const { AppError, isAppError } = await import("../../kernel/server/runtime/errors.js");
  const app = Fastify();
  t.after(() => app.close());
  registerApiErrorHandler(app, { isAppError });
  const response = Object.fromEntries(
    Object.entries(withStandardErrorResponses({ 200: createTransportResponseSchema({ type: "object" }) }, {
      includeValidation400: true
    })).map(([status, entry]) => [status, entry.transportSchema])
  );
  app.post("/books", {
    schema: {
      body: { type: "object", required: ["title"], properties: { title: { type: "string" } } },
      response
    }
  }, async () => {
    throw new AppError(409, "Pick a calendar first.", {
      code: "connector_input_invalid",
      params: { field: "calendar" },
      messageCode: "connectors.calendar.pickFirst",
      messageParams: { count: 1 }
    });
  });

  const conflict = await app.inject({ method: "POST", url: "/books", payload: { title: "Dune" } });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json(), {
    error: "Pick a calendar first.",
    code: "connector_input_invalid",
    params: { field: "calendar" },
    messageCode: "connectors.calendar.pickFirst",
    messageParams: { count: 1 }
  });

  const invalid = await app.inject({ method: "POST", url: "/books", payload: {} });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), {
    error: "Validation failed.",
    code: "FST_ERR_VALIDATION",
    params: {},
    fieldErrors: { title: "must have required property 'title'" },
    details: {
      fieldErrors: { title: "must have required property 'title'" },
      fieldErrorCodes: { title: { code: "kernel.validation.required", params: { missingProperty: "title" } } }
    }
  });
});
