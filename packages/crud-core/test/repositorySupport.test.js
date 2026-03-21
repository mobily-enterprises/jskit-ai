import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIST_LIMIT,
  normalizeCrudListLimit,
  requireCrudTableName
} from "../src/server/repositorySupport.js";

test("normalizeCrudListLimit enforces fallback and max", () => {
  assert.equal(normalizeCrudListLimit(null), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit("abc"), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit(0), DEFAULT_LIST_LIMIT);
  assert.equal(normalizeCrudListLimit(5), 5);
  assert.equal(normalizeCrudListLimit(200), 100);
});

test("requireCrudTableName trims and rejects empty values", () => {
  assert.equal(requireCrudTableName("  crud_customers  "), "crud_customers");

  assert.throws(
    () => requireCrudTableName("   "),
    /requires tableName/
  );
});
