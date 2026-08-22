import assert from "node:assert/strict";
import test from "node:test";

import {
  MANAGED_PREVIEW_IDENTITY_PROTOCOL,
  executeManagedPreviewIdentityRequest
} from "../src/server/managedPreviewIdentity.js";

const SECRET = "a".repeat(64);

function jsonResponse(payload, { cookie = "", status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      ...(cookie ? { "set-cookie": cookie } : {})
    },
    status
  });
}

test("managed preview identity uses only the Vibe64-owned command protocol", async () => {
  assert.equal(MANAGED_PREVIEW_IDENTITY_PROTOCOL, "vibe64.preview-identity.command.v1");

  const result = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: "genesis.preview-identity.command.v1",
    requestId: "retired-protocol",
    target: { origin: "http://localhost:3000" }
  }, {
    env: {},
    fetchImpl: async () => assert.fail("fetch must not run")
  });

  assert.equal(result.ok, false);
  assert.equal(result.protocol, MANAGED_PREVIEW_IDENTITY_PROTOCOL);
  assert.equal(result.code, "jskit_managed_preview_identity_protocol_invalid");
});

test("managed preview identity signs out before selecting an existing application user", async () => {
  const calls = [];
  const responses = [
    jsonResponse({ csrfToken: "csrf-token" }, { cookie: "session=initial; Path=/" }),
    jsonResponse({ ok: true }, { cookie: "session=; Max-Age=0; Path=/" }),
    jsonResponse({
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      ok: true,
      userId: "user-1"
    }, { cookie: "session=selected; Path=/" })
  ];
  const result = await executeManagedPreviewIdentityRequest({
    operation: "login-as",
    protocol: MANAGED_PREVIEW_IDENTITY_PROTOCOL,
    requestId: "request-1",
    subject: {
      kind: "selector",
      selector: { type: "email", value: "ada@example.com" }
    },
    target: { origin: "http://vibe64-launch-deadbeefcafe" }
  }, {
    env: {
      AUTH_DEV_BYPASS_ENABLED: "true",
      AUTH_DEV_BYPASS_SECRET: SECRET
    },
    fetchImpl: async (href, options) => {
      calls.push({ href, options });
      return responses.shift();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.identity.email, "ada@example.com");
  assert.equal(result.signedOut, false);
  assert.deepEqual(calls.map(({ href }) => new URL(href).pathname), [
    "/api/session",
    "/api/logout",
    "/api/dev-auth/login-as"
  ]);
  assert.equal(calls[2].options.headers["x-jskit-dev-auth-secret"], SECRET);
  assert.equal(JSON.parse(calls[2].options.body).email, "ada@example.com");
});

test("managed preview identity rejects a disabled or non-local exchange", async () => {
  const disabled = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: MANAGED_PREVIEW_IDENTITY_PROTOCOL,
    requestId: "request-2",
    target: { origin: "http://localhost:3000" }
  }, { env: {}, fetchImpl: async () => assert.fail("fetch must not run") });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, "jskit_managed_preview_identity_disabled");

  const remote = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: MANAGED_PREVIEW_IDENTITY_PROTOCOL,
    requestId: "request-3",
    target: { origin: "https://example.com" }
  }, {
    env: {
      AUTH_DEV_BYPASS_ENABLED: "true",
      AUTH_DEV_BYPASS_SECRET: SECRET
    },
    fetchImpl: async () => assert.fail("fetch must not run")
  });
  assert.equal(remote.ok, false);
  assert.equal(remote.code, "jskit_managed_preview_identity_target_invalid");
});
