import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/client/authApi.js";

test("authApi exposes the expected methods and request routes", async () => {
  const calls = [];
  const api = createApi({
    request: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), [
    "session",
    "register",
    "login",
    "requestOtp",
    "verifyOtp",
    "oauthStartUrl",
    "oauthComplete",
    "requestPasswordReset",
    "completePasswordRecovery",
    "resetPassword",
    "logout"
  ]);

  await api.session();
  await api.login({ email: "x@example.com" });
  await api.logout();

  assert.equal(calls[0].url, "/api/session");
  assert.equal(calls[1].url, "/api/login");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].url, "/api/logout");
  assert.equal(calls[2].options.method, "POST");
});

test("authApi oauthStartUrl builds provider path with optional returnTo", () => {
  const api = createApi({
    request: async () => ({})
  });

  assert.equal(api.oauthStartUrl("GitHub"), "/api/oauth/github/start");
  assert.equal(api.oauthStartUrl("github", { returnTo: "/console" }), "/api/oauth/github/start?returnTo=%2Fconsole");
});
