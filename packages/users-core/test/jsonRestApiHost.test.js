import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_JSON_REST_API,
  registerJsonRestApiHost
} from "../src/server/common/jsonRestApiHost.js";

test("registerJsonRestApiHost binds the internal API lazily without resolving knex during register", async () => {
  const singletonBindings = new Map();
  let knexResolved = false;

  const app = {
    singleton(token, factory) {
      singletonBindings.set(String(token || ""), factory);
      return this;
    },
    has(token) {
      return singletonBindings.has(String(token || ""));
    },
    make(token) {
      if (String(token || "") === "jskit.database.knex") {
        knexResolved = true;
      }
      return null;
    }
  };

  const result = await registerJsonRestApiHost(app);

  assert.equal(result, null);
  assert.equal(knexResolved, false);
  assert.equal(singletonBindings.has(INTERNAL_JSON_REST_API), true);
});
