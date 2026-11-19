import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { DEV_AUTH_SECRET_HEADER } from "../src/server/config.js";
import { DEFAULT_PREVIEW_IDENTITY_PROTOCOL, executePreviewIdentityRequest } from "../src/server/previewIdentity.js";
import { createAccount, createBrowser } from "./support/browser.js";
import { startHub } from "./support/hub.js";

const SECRET = "a".repeat(64);
let hub;

before(async () => {
  hub = await startHub({ env: { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: SECRET } });
  await createAccount(createBrowser(), hub.url, { email: "ada@example.test", password: "correct horse battery staple" });
});

after(async () => {
  await hub?.stop();
});

function request(selector, protocol = DEFAULT_PREVIEW_IDENTITY_PROTOCOL) {
  return {
    protocol,
    requestId: "r1",
    operation: "login-as",
    subject: { kind: "selector", selector },
    target: { origin: hub.url }
  };
}

test("the preview signs in as an existing hub account and receives its cookie", async () => {
  const env = { APP_ENV: "development", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: SECRET };
  const result = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), { env });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.identity.email, "ada@example.test");
  assert.ok(result.setCookie.some((cookie) => cookie.startsWith("hub_session=")));
});

test("the command answers only the protocol id its host names", async () => {
  const env = { APP_ENV: "development", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: SECRET };
  const protocol = "example-host.preview-identity.command.v1";
  const named = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }, protocol), { env, protocol });
  assert.equal(named.ok, true, JSON.stringify(named));
  assert.equal(named.protocol, protocol);
  const other = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), { env, protocol });
  assert.equal(other.code, "preview_identity_request_invalid");
  assert.equal(other.protocol, protocol);
});

test("a wrong secret, an unknown account or a disabled exchange is refused", async () => {
  const wrong = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), {
    env: { APP_ENV: "development", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: "b".repeat(64) }
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.statusCode, 403);
  const unknown = await executePreviewIdentityRequest(request({ type: "email", value: "nobody@example.test" }), {
    env: { APP_ENV: "development", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: SECRET }
  });
  assert.equal(unknown.statusCode, 404);
  const disabled = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), { env: { APP_ENV: "development" } });
  assert.equal(disabled.code, "preview_identity_disabled");
  await assert.rejects(executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), {}),
    /requires the hub's environment/u);
});

test("a staging or production hub has no preview sign-in, even enabled, with its secret, from this computer", async () => {
  for (const APP_ENV of ["staging", "production"]) {
    const served = await startHub({
      env: {
        APP_ENV, NODE_ENV: "production",
        APP_PUBLIC_URL: "https://accounts.example.test",
        OIDC_HUB_EMAIL_FROM: "hub@example.test",
        RESEND_API_KEY: "re_test_not_real",
        AUTH_DEV_BYPASS_ENABLED: "true",
        AUTH_DEV_BYPASS_SECRET: SECRET
      }
    });
    try {
      const response = await fetch(`http://127.0.0.1:${served.port}/hub/api/dev/login-as`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-request": "1", [DEV_AUTH_SECRET_HEADER]: SECRET },
        body: JSON.stringify({ email: "ada@example.test" })
      });
      assert.equal(response.status, 404, APP_ENV);
      // The route itself is missing there, not merely the account ("account_not_found").
      assert.equal((await response.json()).error, "not_found", APP_ENV);
    } finally {
      await served.stop();
    }
  }
});
