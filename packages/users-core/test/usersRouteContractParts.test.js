import test from "node:test";
import assert from "node:assert/strict";
import { compileRouteContract } from "@jskit-ai/kernel/server/http/routeContract";
import { routeParamsValidator } from "../src/server/common/validators/routeParamsValidator.js";
import { routeQueries } from "../src/server/common/contracts/routeQueries.js";

test("routeParamsValidator exposes a shared route params contract part", () => {
  assert.equal(typeof routeParamsValidator.schema, "object");
  assert.equal(typeof routeParamsValidator.normalize, "function");
});

test("routeQueries exposes first-class query contract parts", () => {
  assert.equal(typeof routeQueries.pagination.schema, "object");
  assert.equal(typeof routeQueries.search.schema, "object");
  assert.equal(typeof routeQueries.oauthReturnTo.schema, "object");
});

test("route contract uses the shared params contract part and merges query arrays automatically", () => {
  const compiled = compileRouteContract({
    params: routeParamsValidator,
    query: [routeQueries.pagination, routeQueries.search]
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
