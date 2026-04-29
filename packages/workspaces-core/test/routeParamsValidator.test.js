import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import { routeParamsValidator } from "../src/server/common/validators/routeParamsValidator.js";

function composeSchemaDefinition(...definitions) {
  return Object.freeze({
    schema: createSchema(
      Object.assign({}, ...definitions.map((definition) => definition.schema.getFieldDefinitions()))
    ),
    mode: "patch"
  });
}

test("routeParamsValidator exposes a shared workspace route params schema definition", () => {
  assert.equal(typeof routeParamsValidator.schema, "object");
  assert.equal(routeParamsValidator.mode, "patch");
});

test("workspace route validator pipeline uses the shared params validator with a composed query schema", () => {
  const paginationQueryValidator = Object.freeze({
    schema: createSchema({
      cursor: {
        type: "string",
        required: false,
        minLength: 1
      },
      limit: {
        type: "string",
        required: false,
        pattern: "^[0-9]+$"
      }
    }),
    mode: "patch"
  });
  const searchQueryValidator = Object.freeze({
    schema: createSchema({
      search: {
        type: "string",
        required: false,
        minLength: 1
      }
    }),
    mode: "patch"
  });

  const compiled = compileRouteValidator({
    params: routeParamsValidator,
    query: composeSchemaDefinition(paginationQueryValidator, searchQueryValidator)
  });

  assert.equal(compiled.schema.params.type, "object");
  assert.equal(compiled.schema.params.additionalProperties, false);
  assert.equal(typeof compiled.schema.params.properties.workspaceSlug, "object");
  assert.equal(typeof compiled.schema.params.properties.memberUserId, "object");
  assert.equal(typeof compiled.schema.params.properties.inviteId, "object");
  assert.equal(typeof compiled.schema.params.properties.provider, "object");
  const normalizedParams = compiled.input.params({ workspaceSlug: "ACME" });
  assert.equal(normalizedParams.workspaceSlug, "acme");

  assert.equal(compiled.schema.querystring.type, "object");
  assert.equal(compiled.schema.querystring.additionalProperties, false);
  assert.equal(typeof compiled.schema.querystring.properties.cursor, "object");
  assert.equal(typeof compiled.schema.querystring.properties.limit, "object");
  assert.equal(typeof compiled.schema.querystring.properties.search, "object");
});
