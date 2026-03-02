import assert from "node:assert/strict";
import test from "node:test";

import { ActionRuntimeCoreServiceProvider } from "../src/server/providers/ActionRuntimeCoreServiceProvider.js";
import { ActionRuntimeCoreClientProvider } from "../src/client/providers/ActionRuntimeCoreClientProvider.js";

function createSingletonApp() {
  const singletons = new Map();
  return {
    singletons,
    singleton(token, factory) {
      singletons.set(token, factory(this));
    }
  };
}

test("ActionRuntimeCoreServiceProvider registers runtime actions api", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeCoreServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.actions"), true);
  const api = app.singletons.get("runtime.actions");
  assert.equal(typeof api.createActionRegistry, "function");
});

test("ActionRuntimeCoreClientProvider registers runtime actions client api", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeCoreClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.actions.client"), true);
  const api = app.singletons.get("runtime.actions.client");
  assert.equal(typeof api.createActionRegistry, "function");
});
