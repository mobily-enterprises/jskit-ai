import test from "node:test";
import assert from "node:assert/strict";
import { normalizePath } from "../src/lib/json.js";

test("normalizePath accepts string and array forms", () => {
  assert.deepEqual(normalizePath("a.b.c"), ["a", "b", "c"]);
  assert.deepEqual(normalizePath(["a", "b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(normalizePath(""), []);
});
