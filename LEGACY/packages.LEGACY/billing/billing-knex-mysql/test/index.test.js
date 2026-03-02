import assert from "node:assert/strict";
import test from "node:test";
import * as billingKnex from "../src/lib/index.js";

test("billing knex mysql exports repository constructor", () => {
  assert.equal(typeof billingKnex.createBillingRepository, "function");
});
