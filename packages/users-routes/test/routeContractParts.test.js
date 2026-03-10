import test from "node:test";
import assert from "node:assert/strict";
import { compileRouteContract } from "@jskit-ai/kernel/server/http/routeContract";
import { routeParams } from "../src/shared/contracts/routeParams.js";
import { routeQueries } from "../src/shared/contracts/routeQueries.js";

test("routeParams exposes first-class params contract parts", () => {
  assert.equal(typeof routeParams.workspaceSlug.schema, "object");
  assert.equal(typeof routeParams.memberUserId.schema, "object");
  assert.equal(typeof routeParams.inviteId.schema, "object");
  assert.equal(typeof routeParams.provider.schema, "object");
});

test("routeQueries exposes first-class query contract parts", () => {
  assert.equal(typeof routeQueries.pagination.schema, "object");
  assert.equal(typeof routeQueries.search.schema, "object");
  assert.equal(typeof routeQueries.oauthReturnTo.schema, "object");
  assert.equal(typeof routeQueries.workspaceBootstrap.schema, "object");
});

test("route contract merges params and query contract part arrays automatically", () => {
  const compiled = compileRouteContract({
    params: [routeParams.workspaceSlug, routeParams.inviteId],
    query: [routeQueries.pagination, routeQueries.search]
  });

  assert.equal(compiled.schema.params.type, "object");
  assert.equal(compiled.schema.params.additionalProperties, false);
  assert.equal(typeof compiled.schema.params.properties.workspaceSlug, "object");
  assert.equal(typeof compiled.schema.params.properties.inviteId, "object");

  assert.equal(compiled.schema.querystring.type, "object");
  assert.equal(compiled.schema.querystring.additionalProperties, false);
  assert.equal(typeof compiled.schema.querystring.properties.cursor, "object");
  assert.equal(typeof compiled.schema.querystring.properties.limit, "object");
  assert.equal(typeof compiled.schema.querystring.properties.search, "object");
});
