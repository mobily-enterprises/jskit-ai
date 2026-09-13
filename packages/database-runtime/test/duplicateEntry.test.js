import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateEntryError, isDuplicateEntryError } from "../src/shared/duplicateEntry.js";

test("isDuplicateEntryError matches mysql and postgres duplicate signatures", () => {
  assert.equal(isDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(isDuplicateEntryError({ errno: 1062 }), true);
  assert.equal(isDuplicateEntryError({ code: "23505" }), true);
  assert.equal(isDuplicateEntryError({ code: "ER_PARSE_ERROR", errno: 1064 }), false);
});

test("duplicate classification follows causes and retains the database error", () => {
  const databaseError = Object.freeze({ code: "23505", message: "users_email_unique" });
  const failure = new Error("Write failed", { cause: new Error("Storage failed", { cause: databaseError }) });

  assert.equal(isDuplicateEntryError(failure, { dialect: "postgres" }), true);
  assert.equal(findDuplicateEntryError(failure), databaseError);
  failure.code = "23505";
  assert.equal(findDuplicateEntryError(failure), databaseError);
  assert.equal(findDuplicateEntryError(failure, { dialect: "mysql" }), null);
  assert.equal(findDuplicateEntryError({ cause: { errno: 1062 } }, { dialect: "mysql" }).errno, 1062);
});

test("duplicate classification terminates on missing, primitive and cyclic causes", () => {
  const first = new Error("first");
  const second = new Error("second", { cause: first });
  first.cause = second;

  for (const error of [null, undefined, false, "failure", { cause: 42 }, first]) {
    assert.equal(findDuplicateEntryError(error), null);
    assert.equal(isDuplicateEntryError(error), false);
  }
});
