import assert from "node:assert/strict";
import test from "node:test";
import { mapAuthError } from "../src/server/lib/authErrorMappers.js";

test("mapAuthError preserves rate-limit errors as 429 with actionable message", () => {
  const mapped = mapAuthError(
    {
      status: 429,
      message: "email rate limit exceeded"
    },
    400
  );

  assert.equal(mapped.status, 429);
  assert.equal(mapped.message, "Too many authentication attempts. Please wait and try again.");
});

test("mapAuthError honors upstream status codes for unknown client errors", () => {
  const mapped = mapAuthError(
    {
      status: 422,
      message: "unexpected auth validation issue"
    },
    400
  );

  assert.equal(mapped.status, 422);
  assert.equal(mapped.message, "Authentication request could not be processed.");
});
