import assert from "node:assert/strict";
import test from "node:test";

import { HttpClientRuntimeServiceProvider } from "../src/server/providers/HttpClientRuntimeServiceProvider.js";
import { HttpClientRuntimeClientProvider } from "../src/client/providers/HttpClientRuntimeClientProvider.js";

function createSingletonApp() {
  const singletons = new Map();
  return {
    singletons,
    singleton(token, factory) {
      singletons.set(token, factory(this));
    }
  };
}

test("HttpClientRuntimeServiceProvider registers runtime http client api", () => {
  const app = createSingletonApp();
  const provider = new HttpClientRuntimeServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.http-client"), true);
  const api = app.singletons.get("runtime.http-client");
  assert.equal(typeof api.createHttpClient, "function");
});

test("HttpClientRuntimeClientProvider registers client http client api", () => {
  const app = createSingletonApp();
  const provider = new HttpClientRuntimeClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.http-client.client"), true);
  const api = app.singletons.get("runtime.http-client.client");
  assert.equal(typeof api.createHttpClient, "function");
});
