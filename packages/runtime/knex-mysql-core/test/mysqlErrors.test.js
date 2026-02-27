import assert from "node:assert/strict";
import test from "node:test";
import { isMysqlDuplicateEntryError } from "../src/shared/mysqlErrors.js";

test("isMysqlDuplicateEntryError matches ER_DUP_ENTRY code", () => {
  assert.equal(isMysqlDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(isMysqlDuplicateEntryError({ code: " er_dup_entry " }), true);
});

test("isMysqlDuplicateEntryError matches errno 1062", () => {
  assert.equal(isMysqlDuplicateEntryError({ errno: 1062 }), true);
  assert.equal(isMysqlDuplicateEntryError({ errorno: 1062 }), true);
});

test("isMysqlDuplicateEntryError is false for non-duplicates", () => {
  assert.equal(isMysqlDuplicateEntryError({ code: "ER_PARSE_ERROR", errno: 1064 }), false);
  assert.equal(isMysqlDuplicateEntryError(null), false);
});
