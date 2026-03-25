import test from "node:test";
import assert from "node:assert/strict";
import { isContainerToken } from "./containerToken.js";

test("isContainerToken accepts valid container token types", () => {
  assert.equal(isContainerToken("appConfig"), true);
  assert.equal(isContainerToken("jskit.test"), true);
  assert.equal(isContainerToken(() => {}), true);
});

test("isContainerToken rejects empty and unsupported token values", () => {
  assert.equal(isContainerToken(""), false);
  assert.equal(isContainerToken("   "), false);
  assert.equal(isContainerToken(null), false);
  assert.equal(isContainerToken(123), false);
  assert.equal(isContainerToken({}), false);
});
