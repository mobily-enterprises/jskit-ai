import test from "node:test";
import assert from "node:assert/strict";
import { toCanonicalJson, toSha256Hex } from "../src/canonicalJson.js";

test("canonical json helper sorts object keys recursively", () => {
  const value = {
    b: 2,
    a: {
      d: 4,
      c: 3
    }
  };
  assert.equal(toCanonicalJson(value), "{\"a\":{\"c\":3,\"d\":4},\"b\":2}");
});

test("sha256 helper returns deterministic digest", () => {
  const digest = toSha256Hex("abc");
  assert.equal(digest.length, 64);
  assert.equal(digest, toSha256Hex("abc"));
});
