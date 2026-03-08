import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseRuntimePostgresServiceProvider } from "../src/server/providers/DatabaseRuntimePostgresServiceProvider.js";

function createSingletonApp() {
  const singletons = new Map();

  return {
    has(token) {
      return singletons.has(token);
    },
    singleton(token, factory) {
      singletons.set(token, factory(this));
    },
    make(token) {
      if (!singletons.has(token)) {
        throw new Error(`Token ${String(token)} is not registered.`);
      }
      return singletons.get(token);
    }
  };
}

test("DatabaseRuntimePostgresServiceProvider registers postgres driver api", () => {
  const app = createSingletonApp();
  const provider = new DatabaseRuntimePostgresServiceProvider();
  provider.register(app);

  assert.equal(app.has("runtime.database.driver.postgres"), true);
  const api = app.make("runtime.database.driver.postgres");
  assert.equal(api.DIALECT_ID, "pg");
  assert.equal(api.getDialectId(), "pg");
});
