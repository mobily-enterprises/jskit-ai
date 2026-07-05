import assert from "node:assert/strict";
import test from "node:test";
import {
  readPasswordRecoveryCallbackPayloadFromUrl,
  stripPasswordRecoveryCallbackParamsFromUrl
} from "../src/client/runtime/passwordRecoveryCallbackRuntime.js";

test("readPasswordRecoveryCallbackPayloadFromUrl preserves Supabase session-pair hashes", () => {
  assert.deepEqual(
    readPasswordRecoveryCallbackPayloadFromUrl(
      "/auth/reset-password#access_token=access&refresh_token=refresh&type=recovery"
    ),
    {
      accessToken: "access",
      refreshToken: "refresh",
      type: "recovery"
    }
  );
});

test("readPasswordRecoveryCallbackPayloadFromUrl reads local tokens and token hashes", () => {
  assert.deepEqual(
    readPasswordRecoveryCallbackPayloadFromUrl("/auth/reset-password?token=local-token&type=recovery"),
    {
      code: "local-token",
      type: "recovery"
    }
  );
  assert.deepEqual(
    readPasswordRecoveryCallbackPayloadFromUrl("/auth/reset-password?token_hash=hashed-token&type=recovery"),
    {
      tokenHash: "hashed-token",
      type: "recovery"
    }
  );
  assert.equal(readPasswordRecoveryCallbackPayloadFromUrl("/auth/reset-password"), null);
});

test("readPasswordRecoveryCallbackPayloadFromUrl prefers complete recovery tokens over partial session pairs", () => {
  assert.deepEqual(
    readPasswordRecoveryCallbackPayloadFromUrl(
      "/auth/reset-password?token_hash=hashed-token#access_token=access&type=recovery"
    ),
    {
      tokenHash: "hashed-token",
      type: "recovery"
    }
  );
});

test("stripPasswordRecoveryCallbackParamsFromUrl removes credentials but keeps unrelated state", () => {
  assert.equal(
    stripPasswordRecoveryCallbackParamsFromUrl(
      "/auth/reset-password?token=local-token&returnTo=%2Fhome#access_token=access&refresh_token=refresh&tab=reset"
    ),
    "/auth/reset-password?returnTo=%2Fhome#tab=reset"
  );
});
