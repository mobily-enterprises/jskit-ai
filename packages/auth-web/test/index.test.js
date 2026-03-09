import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AuthController } from "../src/server/controllers/AuthController.js";
import { buildRoutes } from "../src/server/routes/authRoutes.js";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/contracts/commands/authLoginPasswordCommand";

test("auth fastify adapter exports controller/routes backed by shared command contracts", () => {
  assert.equal(typeof AuthController, "function");
  assert.equal(typeof buildRoutes, "function");
  assert.ok(authLoginPasswordCommand.operation.body.schema);
});

test("auth-web no longer contains legacy server/schema directory", () => {
  const testFilePath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(testFilePath), "..");
  const legacySchemaDir = path.join(packageRoot, "src", "server", "schema");
  assert.equal(existsSync(legacySchemaDir), false, "src/server/schema must not exist.");
});
