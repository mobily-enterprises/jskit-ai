import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { HttpValidatorsProvider } from "../src/server/providers/HttpValidatorsProvider.js";

test("HttpValidatorsProvider provides the shared validator API", async () => {
  let validators;
  const consumer = defineProvider({
    id: "test.http-validators.consumer",
    requires: { value: "validators.http" },
    setup({ value }) {
      validators = value;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ providers: [HttpValidatorsProvider, consumer] });
  await runtime.start();
  assert.equal(typeof validators.enumSchema, "function");
  assert.equal(typeof validators.createResource, "function");
  await runtime.shutdown();
});
