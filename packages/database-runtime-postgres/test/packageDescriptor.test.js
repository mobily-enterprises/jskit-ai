import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";
import { DIALECT_ID } from "../src/shared/dialect.js";

test("database-runtime-postgres contributes canonical synthetic Postgres CI requirements", () => {
  assert.equal(descriptor.ci.environment.DB_CLIENT, DIALECT_ID);
  assert.equal(descriptor.ci.environment.DB_HOST, "127.0.0.1");
  assert.equal(descriptor.ci.environment.DB_PORT, "54320");
  assert.match(descriptor.ci.environment.DB_PASSWORD, /ci_only/u);

  const service = descriptor.ci.services.find((entry) => entry.id === "postgres");
  assert.equal(service.image, "postgres:16");
  assert.equal(service.environment.POSTGRES_DB, descriptor.ci.environment.DB_NAME);
  assert.equal(service.environment.POSTGRES_USER, descriptor.ci.environment.DB_USER);
  assert.equal(service.environment.POSTGRES_PASSWORD, descriptor.ci.environment.DB_PASSWORD);
  assert.deepEqual(service.ports, ["54320:5432"]);
  assert.match(service.healthCheck.command, /pg_isready/u);

  const clientMutation = descriptor.mutations.text.find((entry) => entry.key === "DB_CLIENT");
  assert.equal(clientMutation.value, DIALECT_ID);
});
