import test from "node:test";
import assert from "node:assert/strict";
import { DIALECT_ID, getDialectId } from "../src/shared/index.js";

test("postgres dialect package exposes postgres id", () => {
  assert.equal(DIALECT_ID, "postgres");
  assert.equal(getDialectId(), "postgres");
});
