import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOptionalHttpUrl } from "../src/server/lib/providers/common.js";

test("normalizeOptionalHttpUrl accepts empty values", () => {
  assert.equal(normalizeOptionalHttpUrl(""), "");
  assert.equal(normalizeOptionalHttpUrl("   "), "");
});

test("normalizeOptionalHttpUrl rejects non-http absolute values", () => {
  assert.throws(
    () => normalizeOptionalHttpUrl("cd ../89", { context: "assistant AI_BASE_URL" }),
    /assistant AI_BASE_URL must be an absolute http\(s\) URL\./
  );
});
