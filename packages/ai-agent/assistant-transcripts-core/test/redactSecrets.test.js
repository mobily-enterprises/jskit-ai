import test from "node:test";
import assert from "node:assert/strict";
import { REDACTION_VERSION, redactSecrets } from "../src/redactSecrets.js";

test("redactSecrets masks known sensitive payload patterns", () => {
  const source = "Bearer sk-12345678901234567890 password=secret";
  const result = redactSecrets(source);
  assert.equal(result.redacted, true);
  assert.equal(result.version, REDACTION_VERSION);
  assert.match(result.text, /Bearer \[REDACTED\]/);
  assert.match(result.text, /password=\[REDACTED\]/);
  assert.ok(result.hitCount >= 1);
});
