import test from "node:test";
import assert from "node:assert/strict";
import { DIALECT_ID, getDialectId } from "../src/shared/index.js";

test("mysql dialect package exposes mysql id", () => {
  assert.equal(DIALECT_ID, "mysql");
  assert.equal(getDialectId(), "mysql");
});
