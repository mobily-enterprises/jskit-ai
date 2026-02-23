import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { __testables, closeDatabase, db, initDatabase } from "../db/knex.js";

test("resolveRuntimeEnv maps production, test, and default values", () => {
  assert.equal(__testables.resolveRuntimeEnv("production"), "production");
  assert.equal(__testables.resolveRuntimeEnv("test"), "test");
  assert.equal(__testables.resolveRuntimeEnv("development"), "development");
  assert.equal(__testables.resolveRuntimeEnv("anything-else"), "development");
});

test("resolveKnexConfig returns config and throws when environment is missing", () => {
  const environments = {
    development: { id: "dev" },
    test: { id: "test" },
    production: { id: "prod" }
  };

  const dev = __testables.resolveKnexConfig("development", environments);
  assert.equal(dev.runtimeEnv, "development");
  assert.deepEqual(dev.config, { id: "dev" });

  const prod = __testables.resolveKnexConfig("production", environments);
  assert.equal(prod.runtimeEnv, "production");
  assert.deepEqual(prod.config, { id: "prod" });

  const testEnv = __testables.resolveKnexConfig("test", environments);
  assert.equal(testEnv.runtimeEnv, "test");
  assert.deepEqual(testEnv.config, { id: "test" });

  assert.throws(
    () =>
      __testables.resolveKnexConfig("production", {
        development: { id: "dev" },
        test: { id: "test" }
      }),
    /Missing knex configuration/
  );
});

test("initDatabase and closeDatabase call knex client methods", async () => {
  const calls = [];
  const fakeClient = {
    async raw(sql) {
      calls.push(["raw", sql]);
      return [{ ok: 1 }];
    },
    async destroy() {
      calls.push(["destroy"]);
    }
  };

  await __testables.initDatabaseWithClient(fakeClient);
  await __testables.closeDatabaseWithClient(fakeClient);

  assert.deepEqual(calls, [["raw", "select 1 as ok"], ["destroy"]]);
});

test("initDatabase and closeDatabase wrappers call db client", async () => {
  const calls = [];
  const rawMock = mock.method(db, "raw", async (sql) => {
    calls.push(["raw", sql]);
    return [{ ok: 1 }];
  });
  const destroyMock = mock.method(db, "destroy", async () => {
    calls.push(["destroy"]);
  });

  try {
    await initDatabase();
    await closeDatabase();
  } finally {
    rawMock.mock.restore();
    destroyMock.mock.restore();
  }

  assert.deepEqual(calls, [["raw", "select 1 as ok"], ["destroy"]]);
});
