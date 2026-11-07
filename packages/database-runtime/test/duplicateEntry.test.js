import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateEntryError, isDuplicateEntryError, isLostDuplicateInsertRace } from "../src/shared/duplicateEntry.js";

test("isDuplicateEntryError matches mysql and postgres duplicate signatures", () => {
  assert.equal(isDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(isDuplicateEntryError({ errno: 1062 }), true);
  assert.equal(isDuplicateEntryError({ code: "23505" }), true);
  assert.equal(isDuplicateEntryError({ code: "ER_PARSE_ERROR", errno: 1064 }), false);
});

test("isDuplicateEntryError matches SQLite's unique and primary key violations, and no other constraint", () => {
  const unique = Object.assign(new Error("UNIQUE constraint failed: users.email"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
  const primaryKey = Object.assign(new Error("UNIQUE constraint failed: users.id"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
  assert.equal(isDuplicateEntryError(unique), true);
  assert.equal(isDuplicateEntryError(primaryKey), true);
  assert.equal(isDuplicateEntryError(new Error("Write failed", { cause: unique })), true);
  assert.equal(isDuplicateEntryError(unique, { dialect: "sqlite" }), true);
  assert.equal(isDuplicateEntryError(unique, { client: { client: { config: { client: "better-sqlite3" } } } }), true);
  assert.equal(isDuplicateEntryError(unique, { dialect: "mysql" }), false);
  assert.equal(isDuplicateEntryError({ code: "ER_DUP_ENTRY" }, { dialect: "sqlite" }), false);
  for (const code of ["SQLITE_CONSTRAINT_NOTNULL", "SQLITE_CONSTRAINT_FOREIGNKEY", "SQLITE_CONSTRAINT_CHECK", "SQLITE_BUSY"]) {
    assert.equal(isDuplicateEntryError({ code }), false, code);
  }
  assert.equal(isLostDuplicateInsertRace({ transactionOutcome: "rolledBack", cause: unique }, {}), true);
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

test("isLostDuplicateInsertRace is a rolled-back duplicate insert outside a caller's transaction", () => {
  const lostRace = { transactionOutcome: "rolledBack", code: "ER_DUP_ENTRY" };

  assert.equal(isLostDuplicateInsertRace(lostRace, {}), true);
  assert.equal(isLostDuplicateInsertRace(lostRace, { trx: () => {} }), false);
  assert.equal(isLostDuplicateInsertRace({ ...lostRace, transactionOutcome: "pending" }, {}), false);
  assert.equal(isLostDuplicateInsertRace({ transactionOutcome: "rolledBack", code: "ER_PARSE_ERROR" }, {}), false);
  assert.equal(isLostDuplicateInsertRace(undefined, {}), false);
});
