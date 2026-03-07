import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseRuntimeMysqlServiceProvider } from "../src/server/providers/DatabaseRuntimeMysqlServiceProvider.js";

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

test("DatabaseRuntimeMysqlServiceProvider registers mysql driver api", () => {
  const app = createSingletonApp();
  const provider = new DatabaseRuntimeMysqlServiceProvider();
  provider.register(app);

  assert.equal(app.has("runtime.database.driver.mysql"), true);
  const api = app.make("runtime.database.driver.mysql");
  assert.equal(api.DIALECT_ID, "mysql");
  assert.equal(api.getDialectId(), "mysql");
});
