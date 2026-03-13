import test from "node:test";
import assert from "node:assert/strict";

import { recordIdParamsValidator } from "./recordIdParamsValidator.js";

test("recordIdParamsValidator normalizes string id to positive integer", () => {
  assert.deepEqual(recordIdParamsValidator.normalize({ recordId: "42" }), {
    recordId: 42
  });
});

test("recordIdParamsValidator normalizes invalid id to 0", () => {
  assert.deepEqual(recordIdParamsValidator.normalize({ recordId: "nope" }), {
    recordId: 0
  });
});

test("recordIdParamsValidator keeps absent key absent", () => {
  assert.deepEqual(recordIdParamsValidator.normalize({}), {});
});
