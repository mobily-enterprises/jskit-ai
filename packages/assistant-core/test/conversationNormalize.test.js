import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNullableText } from "../src/server/conversation/normalize.js";

test("conversation text normalization blanks only null and undefined", () => {
  assert.equal(normalizeNullableText(null), "");
  assert.equal(normalizeNullableText(undefined), "");
  assert.equal(normalizeNullableText(0), "0");
  assert.equal(normalizeNullableText(false), "false");
  assert.equal(normalizeNullableText("  id  "), "id");
});
