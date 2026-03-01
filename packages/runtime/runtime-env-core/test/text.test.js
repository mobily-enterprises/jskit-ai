import assert from "node:assert/strict";
import test from "node:test";

import { normalizeText } from "../src/shared/text.js";

test("normalizeText trims string-like input and normalizes nullish to empty", () => {
  assert.equal(normalizeText("  hello  "), "hello");
  assert.equal(normalizeText(123), "123");
  assert.equal(normalizeText(""), "");
  assert.equal(normalizeText(null), "");
  assert.equal(normalizeText(undefined), "");
});
