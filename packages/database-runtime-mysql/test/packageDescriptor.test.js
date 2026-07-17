import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";
import { DIALECT_ID } from "../src/shared/dialect.js";

test("database-runtime-mysql contributes canonical synthetic MariaDB CI requirements", () => {
  assert.equal(descriptor.ci.environment.DB_CLIENT, DIALECT_ID);
  assert.equal(descriptor.ci.environment.DB_HOST, "127.0.0.1");
  assert.equal(descriptor.ci.environment.DB_PORT, "33060");
  assert.match(descriptor.ci.environment.DB_PASSWORD, /ci_only/u);

  const service = descriptor.ci.services.find((entry) => entry.id === "mariadb");
  assert.equal(service.image, "mariadb:11.4");
  assert.equal(service.environment.MARIADB_DATABASE, descriptor.ci.environment.DB_NAME);
  assert.equal(service.environment.MARIADB_USER, descriptor.ci.environment.DB_USER);
  assert.equal(service.environment.MARIADB_PASSWORD, descriptor.ci.environment.DB_PASSWORD);
  assert.deepEqual(service.ports, ["33060:3306"]);
  assert.match(service.healthCheck.command, /healthcheck\.sh/u);

  const clientMutation = descriptor.mutations.text.find((entry) => entry.key === "DB_CLIENT");
  assert.equal(clientMutation.value, DIALECT_ID);
});
