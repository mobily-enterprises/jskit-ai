import assert from "node:assert/strict";
import test from "node:test";

import { HttpValidatorsServiceProvider } from "../src/server/providers/HttpValidatorsServiceProvider.js";
import { HttpValidatorsClientProvider } from "../src/client/providers/HttpValidatorsClientProvider.js";

function createSingletonApp() {
  const singletons = new Map();
  return {
    singletons,
    singleton(token, factory) {
      singletons.set(token, factory(this));
    }
  };
}

test("HttpValidatorsServiceProvider registers shared validators api", () => {
  const app = createSingletonApp();
  const provider = new HttpValidatorsServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has("validators.http"), true);
  const api = app.singletons.get("validators.http");
  assert.equal(typeof api.withStandardErrorResponses, "function");
  assert.equal(typeof api.createResource, "function");
  assert.equal(typeof api.createCommand, "function");
});

test("HttpValidatorsClientProvider registers client validators api", () => {
  const app = createSingletonApp();
  const provider = new HttpValidatorsClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has("validators.http.client"), true);
  const api = app.singletons.get("validators.http.client");
  assert.equal(typeof api.withStandardErrorResponses, "function");
  assert.equal(typeof api.createResource, "function");
  assert.equal(typeof api.createCommand, "function");
});
