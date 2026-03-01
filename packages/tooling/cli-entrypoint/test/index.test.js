import test from "node:test";
import assert from "node:assert/strict";

import { shellQuote } from "../src/shared/index.js";

test("shellQuote passes through safe shell tokens", () => {
  assert.equal(shellQuote("npm"), "npm");
  assert.equal(shellQuote("scripts/test.mjs"), "scripts/test.mjs");
  assert.equal(shellQuote("A_B-1.0"), "A_B-1.0");
});

test("shellQuote wraps and escapes unsafe shell tokens", () => {
  assert.equal(shellQuote(""), "''");
  assert.equal(shellQuote("two words"), "'two words'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});
