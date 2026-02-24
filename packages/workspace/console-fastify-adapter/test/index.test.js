import assert from "node:assert/strict";
import test from "node:test";
import { createController, buildRoutes, schema } from "../src/index.js";

test("console fastify adapter exports controller/routes/schema", () => {
  assert.equal(typeof createController, "function");
  assert.equal(typeof buildRoutes, "function");
  assert.ok(schema.response.bootstrap);
});
