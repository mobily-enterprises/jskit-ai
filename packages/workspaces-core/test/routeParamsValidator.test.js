import test from "node:test";
import assert from "node:assert/strict";
import { compileRouteValidator } from "@jskit-ai/kernel/_testable";
import { routeParamsValidator } from "../src/server/common/validators/routeParamsValidator.js";

test("routeParamsValidator exposes a shared workspace route params schema definition", () => {
  assert.equal(typeof routeParamsValidator.schema, "object");
  assert.equal(routeParamsValidator.mode, "patch");
});

test("workspace route validator pipeline uses the shared params validator and merges query arrays automatically", async () => {
  const paginationQueryValidator = Object.freeze({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cursor: {
          type: "string",
          minLength: 1
        },
        limit: {
          type: "string",
          pattern: "^[0-9]+$"
        }
      }
    }
  });
  const searchQueryValidator = Object.freeze({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        search: {
          type: "string",
          minLength: 1
        }
      }
    }
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
  const normalizedParams = await compiled.input.params({ workspaceSlug: "ACME" });
  assert.equal(normalizedParams.workspaceSlug, "acme");

  assert.equal(compiled.schema.querystring.type, "object");
  assert.equal(compiled.schema.querystring.additionalProperties, false);
  assert.equal(typeof compiled.schema.querystring.properties.cursor, "object");
  assert.equal(typeof compiled.schema.querystring.properties.limit, "object");
  assert.equal(typeof compiled.schema.querystring.properties.search, "object");
});
