import assert from "node:assert/strict";
import test from "node:test";

import { HttpContractsServiceProvider } from "../src/server/providers/HttpContractsServiceProvider.js";
import { HttpContractsClientProvider } from "../src/client/providers/HttpContractsClientProvider.js";

function createSingletonApp() {
  const singletons = new Map();
  return {
    singletons,
    singleton(token, factory) {
      singletons.set(token, factory(this));
    }
  };
}

test("HttpContractsServiceProvider registers shared contracts api", () => {
  const app = createSingletonApp();
  const provider = new HttpContractsServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has("contracts.http"), true);
  const api = app.singletons.get("contracts.http");
  assert.equal(typeof api.withStandardErrorResponses, "function");
});

test("HttpContractsClientProvider registers client contracts api", () => {
  const app = createSingletonApp();
  const provider = new HttpContractsClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has("contracts.http.client"), true);
  const api = app.singletons.get("contracts.http.client");
  assert.equal(typeof api.withStandardErrorResponses, "function");
});
