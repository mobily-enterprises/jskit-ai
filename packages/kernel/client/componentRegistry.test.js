import assert from "node:assert/strict";
import test from "node:test";
import { createClientComponentRegistry } from "./componentRegistry.js";

test("client component registry exposes named UI components without a service locator", () => {
  const registry = createClientComponentRegistry();
  const component = Object.freeze({ name: "ExampleWidget" });

  registry.register("example.widget", component);

  assert.equal(registry.has("example.widget"), true);
  assert.equal(registry.get("example.widget"), component);
  assert.deepEqual(registry.ids(), ["example.widget"]);
  assert.throws(() => registry.register("example.widget", {}), /duplicated/);
  assert.throws(() => registry.get("missing.widget"), /not registered/);
});
