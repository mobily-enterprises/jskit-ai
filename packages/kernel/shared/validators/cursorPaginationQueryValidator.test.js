import test from "node:test";
import assert from "node:assert/strict";
import { cursorPaginationQueryValidator } from "./cursorPaginationQueryValidator.js";

test("cursorPaginationQueryValidator normalizes numeric strings as cursor text", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ cursor: "12", limit: "25" }), {
    cursor: "12",
    limit: 25
  });
});

test("cursorPaginationQueryValidator schema rejects opaque cursor strings", () => {
  assert.equal(
    cursorPaginationQueryValidator.schema.properties.cursor.anyOf.some(
      (entry) => entry.type === "string" && entry.pattern === "^[1-9][0-9]*$"
    ),
    true
  );
});

test("cursorPaginationQueryValidator keeps absent keys absent", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({}), {});
});

test("cursorPaginationQueryValidator ignores unsupported query fields", () => {
  assert.deepEqual(cursorPaginationQueryValidator.normalize({ q: "  to  " }), {});
});
