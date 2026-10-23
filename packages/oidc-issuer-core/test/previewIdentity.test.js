import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { executePreviewIdentityRequest } from "../src/server/previewIdentity.js";
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

function request(selector) {
  return {
    protocol: "vibe64.preview-identity.command.v1",
    requestId: "r1",
    operation: "login-as",
    subject: { kind: "selector", selector },
    target: { origin: hub.url }
  };
}

test("the preview signs in as an existing hub account and receives its cookie", async () => {
  const env = { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: SECRET };
  const result = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), { env });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.identity.email, "ada@example.test");
  assert.ok(result.setCookie.some((cookie) => cookie.startsWith("hub_session=")));
});

test("a wrong secret, an unknown account or a disabled exchange is refused", async () => {
  const wrong = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), {
    env: { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: "b".repeat(64) }
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.statusCode, 403);
  const unknown = await executePreviewIdentityRequest(request({ type: "email", value: "nobody@example.test" }), {
    env: { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: SECRET }
  });
  assert.equal(unknown.statusCode, 404);
  const disabled = await executePreviewIdentityRequest(request({ type: "email", value: "ada@example.test" }), { env: {} });
  assert.equal(disabled.code, "preview_identity_disabled");
});
