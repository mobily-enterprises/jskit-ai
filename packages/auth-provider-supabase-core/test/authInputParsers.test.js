import assert from "node:assert/strict";
import test from "node:test";
import { parseOAuthCompletePayload } from "../src/server/lib/authInputParsers.js";

test("parseOAuthCompletePayload accepts provider-less session pairs", () => {
  const parsed = parseOAuthCompletePayload(
    {
      accessToken: "access-token",
      refreshToken: "refresh-token"
    },
    {
      providerIds: [],
      defaultProvider: null
    }
  );

  assert.equal(parsed.hasSessionPair, true);
  assert.equal(parsed.provider, null);
  assert.deepEqual(parsed.fieldErrors, {});
});

test("parseOAuthCompletePayload still requires OAuth provider for code exchanges", () => {
  assert.throws(
    () =>
      parseOAuthCompletePayload(
        {
          code: "oauth-code"
        },
        {
          providerIds: [],
          defaultProvider: null
        }
      ),
    (error) => {
      assert.equal(error?.status, 400);
      assert.equal(String(error?.details?.fieldErrors?.provider || "").length > 0, true);
      return true;
    }
  );
});
