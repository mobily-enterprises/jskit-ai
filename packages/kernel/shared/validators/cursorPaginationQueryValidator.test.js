import test from "node:test";
import assert from "node:assert/strict";
import { cursorPaginationQueryValidator } from "./cursorPaginationQueryValidator.js";

test("cursorPaginationQueryValidator normalizes numeric strings", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ cursor: "12", limit: "25" }), {
    cursor: 12,
    limit: 25
  });
});

test("cursorPaginationQueryValidator normalizes invalid values to 0", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ cursor: "abc", limit: "-1" }), {
    cursor: 0,
    limit: 0
  });
});

test("cursorPaginationQueryValidator keeps absent keys absent", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({}), {});
});

test("cursorPaginationQueryValidator ignores unsupported query fields", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ q: "  to  " }), {});
});
