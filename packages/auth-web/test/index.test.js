import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../src/server/controllers/AuthController.js";
import { buildRoutes } from "../src/server/routes/authRoutes.js";
import { schema } from "../src/server/schema/index.js";

test("auth fastify adapter exports controller/routes/schema", () => {
  assert.equal(typeof AuthController, "function");
  assert.equal(typeof buildRoutes, "function");
  assert.ok(schema.login.body);
});
