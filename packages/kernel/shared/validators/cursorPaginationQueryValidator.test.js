import test from "node:test";
import assert from "node:assert/strict";
import { cursorPaginationQueryValidator } from "./cursorPaginationQueryValidator.js";

test("cursorPaginationQueryValidator normalizes numeric strings as cursor text", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ cursor: "12", limit: "25" }), {
    cursor: "12",
    limit: 25
  });
});

test("cursorPaginationQueryValidator keeps opaque cursor strings", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ cursor: "abc", limit: "-1" }), {
    cursor: "abc",
    limit: 0
  });
});

test("cursorPaginationQueryValidator trims opaque cursor strings", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ cursor: "  offset:3  " }), {
    cursor: "offset:3"
  });
});

test("cursorPaginationQueryValidator keeps absent keys absent", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({}), {});
});

test("cursorPaginationQueryValidator ignores unsupported query fields", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ q: "  to  " }), {});
});
