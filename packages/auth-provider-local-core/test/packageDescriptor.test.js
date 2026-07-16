import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("local auth contributes only its provider selection to CI", () => {
  assert.deepEqual(descriptor.ci, {
    environment: {
      AUTH_PROVIDER: "local"
    },
    services: [],
    steps: []
  });
});
