import test from "node:test";
import assert from "node:assert/strict";

import { recordIdParamsValidator } from "./recordIdParamsValidator.js";

test("recordIdParamsValidator normalizes canonical string ids", () => {
  assert.deepEqual(recordIdParamsValidator.normalize({ recordId: "42" }), {
    recordId: "42"
  });
});

test("recordIdParamsValidator rejects invalid ids", () => {
  assert.deepEqual(recordIdParamsValidator.normalize({ recordId: "nope" }), {
    recordId: ""
  });
  assert.deepEqual(recordIdParamsValidator.normalize({ recordId: 42 }), {
    recordId: ""
  });
});

test("recordIdParamsValidator keeps absent key absent", () => {
  assert.deepEqual(recordIdParamsValidator.normalize({}), {});
});
