import test from "node:test";
import assert from "node:assert/strict";
import { isDuplicateEntryError } from "../src/shared/errors.js";

test("isDuplicateEntryError matches mysql and postgres duplicate signatures", () => {
  assert.equal(isDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(isDuplicateEntryError({ errno: 1062 }), true);
  assert.equal(isDuplicateEntryError({ code: "23505" }), true);
  assert.equal(isDuplicateEntryError({ code: "ER_PARSE_ERROR", errno: 1064 }), false);
});
