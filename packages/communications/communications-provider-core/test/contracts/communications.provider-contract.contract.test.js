import assert from "node:assert/strict";
import test from "node:test";
import * as communicationsProviderCore from "../../src/shared/index.js";

test("communications.provider-contract contract exports required symbols", () => {
  assert.equal(typeof communicationsProviderCore.assertDispatchProvider, "function");
});

