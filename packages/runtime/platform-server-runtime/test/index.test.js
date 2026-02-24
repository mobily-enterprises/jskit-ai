import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformRuntimeBundle,
  createServerRuntime,
  createServerRuntimeWithPlatformBundle
} from "../src/index.js";

test("platform server runtime creates bundle and assembly", () => {
  const platformBundle = createPlatformRuntimeBundle({
    repositoryDefinitions: [],
    serviceDefinitions: [],
    controllerDefinitions: [],
    runtimeServiceIds: []
  });

  const runtimeA = createServerRuntime({ bundles: [platformBundle], dependencies: {} });
  const runtimeB = createServerRuntimeWithPlatformBundle({
    platformBundle,
    appFeatureBundle: createPlatformRuntimeBundle({}),
    dependencies: {}
  });

  assert.ok(runtimeA);
  assert.ok(runtimeB);
  assert.equal(typeof runtimeA.controllers, "object");
});
