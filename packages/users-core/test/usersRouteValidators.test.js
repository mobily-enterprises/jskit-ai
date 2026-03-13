import test from "node:test";
import assert from "node:assert/strict";
import { Type } from "@fastify/type-provider-typebox";
import { compileRouteValidator } from "@jskit-ai/kernel/server/http/routeValidator";
import { routeParamsValidator } from "../src/server/common/validators/routeParamsValidator.js";

test("routeParamsValidator exposes a shared route params validator", () => {
  assert.equal(typeof routeParamsValidator.schema, "object");
  assert.equal(typeof routeParamsValidator.normalize, "function");
});

test("route validator pipeline uses the shared params validator and merges query arrays automatically", () => {
  const paginationQueryValidator = Object.freeze({
    schema: Type.Object(
      {
        cursor: Type.Optional(Type.String({ minLength: 1 })),
        limit: Type.Optional(Type.String({ pattern: "^[0-9]+$" }))
      },
      { additionalProperties: false }
    )
  });
  const searchQueryValidator = Object.freeze({
    schema: Type.Object(
      {
        search: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  });

  const compiled = compileRouteValidator({
    params: routeParamsValidator,
    query: [paginationQueryValidator, searchQueryValidator]
  });

  assert.equal(compiled.schema.params.type, "object");
  assert.equal(compiled.schema.params.additionalProperties, false);
  assert.equal(typeof compiled.schema.params.properties.workspaceSlug, "object");
  assert.equal(typeof compiled.schema.params.properties.memberUserId, "object");
  assert.equal(typeof compiled.schema.params.properties.inviteId, "object");
  assert.equal(typeof compiled.schema.params.properties.provider, "object");
  assert.equal(compiled.input.params({ workspaceSlug: "  ACME  " }).workspaceSlug, "acme");

  assert.equal(compiled.schema.querystring.type, "object");
  assert.equal(compiled.schema.querystring.additionalProperties, false);
  assert.equal(typeof compiled.schema.querystring.properties.cursor, "object");
  assert.equal(typeof compiled.schema.querystring.properties.limit, "object");
  assert.equal(typeof compiled.schema.querystring.properties.search, "object");
});
