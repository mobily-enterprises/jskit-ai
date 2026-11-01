import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  executeManagedPreviewIdentityRequest
} from "../src/server/managedPreviewIdentity.js";

const SECRET = "a".repeat(64);
const HOST_PROTOCOL = "example-host.preview-identity.command.v1";
const HOST_OPTIONS = Object.freeze({ protocol: HOST_PROTOCOL, localHostnames: [/^preview-[a-f0-9]{12}$/u] });

function jsonResponse(payload, { cookie = "", status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      ...(cookie ? { "set-cookie": cookie } : {})
    },
    status
  });
}

test("managed preview identity answers only the protocol id its host names", async () => {
  assert.equal(DEFAULT_PREVIEW_IDENTITY_PROTOCOL, "jskit.preview-identity.command.v1");

  const result = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: "retired.preview-identity.command.v1",
    requestId: "retired-protocol",
    target: { origin: "http://localhost:3000" }
  }, {
    ...HOST_OPTIONS,
    env: {},
    fetchImpl: async () => assert.fail("fetch must not run")
  });

  assert.equal(result.ok, false);
  assert.equal(result.protocol, HOST_PROTOCOL);
  assert.equal(result.code, "jskit_managed_preview_identity_protocol_invalid");

  const unnamed = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: HOST_PROTOCOL,
    requestId: "default-protocol",
    target: { origin: "http://localhost:3000" }
  }, {
    env: {},
    fetchImpl: async () => assert.fail("fetch must not run")
  });
  assert.equal(unnamed.protocol, DEFAULT_PREVIEW_IDENTITY_PROTOCOL);
  assert.equal(unnamed.code, "jskit_managed_preview_identity_protocol_invalid");
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
    protocol: HOST_PROTOCOL,
    requestId: "request-1",
    subject: {
      kind: "selector",
      selector: { type: "email", value: "ada@example.com" }
    },
    target: { origin: "http://preview-deadbeefcafe" }
  }, {
    ...HOST_OPTIONS,
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
  assert.equal(result.protocol, HOST_PROTOCOL);
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
    protocol: HOST_PROTOCOL,
    requestId: "request-2",
    target: { origin: "http://localhost:3000" }
  }, { ...HOST_OPTIONS, env: {}, fetchImpl: async () => assert.fail("fetch must not run") });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, "jskit_managed_preview_identity_disabled");

  const remote = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: HOST_PROTOCOL,
    requestId: "request-3",
    target: { origin: "https://example.com" }
  }, {
    ...HOST_OPTIONS,
    env: {
      AUTH_DEV_BYPASS_ENABLED: "true",
      AUTH_DEV_BYPASS_SECRET: SECRET
    },
    fetchImpl: async () => assert.fail("fetch must not run")
  });
  assert.equal(remote.ok, false);
  assert.equal(remote.code, "jskit_managed_preview_identity_target_invalid");

  const unlisted = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
    requestId: "request-4",
    target: { origin: "http://preview-deadbeefcafe" }
  }, {
    env: {
      AUTH_DEV_BYPASS_ENABLED: "true",
      AUTH_DEV_BYPASS_SECRET: SECRET
    },
    fetchImpl: async () => assert.fail("fetch must not run")
  });
  assert.equal(unlisted.code, "jskit_managed_preview_identity_target_invalid",
    "a hostname the application does not list is not local");
});

test("managed preview identity accepts the dev auth secret auth-core accepts", async () => {
  const request = {
    operation: "logout",
    protocol: HOST_PROTOCOL,
    requestId: "request-5",
    target: { origin: "http://localhost:3000" }
  };
  const missing = await executeManagedPreviewIdentityRequest(request, {
    ...HOST_OPTIONS,
    env: { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: "  " },
    fetchImpl: async () => assert.fail("fetch must not run")
  });
  assert.equal(missing.code, "jskit_managed_preview_identity_secret_missing");

  const responses = [
    jsonResponse({ csrfToken: "csrf-token" }, { cookie: "session=initial; Path=/" }),
    jsonResponse({ ok: true }, { cookie: "session=; Max-Age=0; Path=/" })
  ];
  const signedOut = await executeManagedPreviewIdentityRequest(request, {
    ...HOST_OPTIONS,
    env: { AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: " any-local-secret " },
    fetchImpl: async () => responses.shift()
  });
  assert.equal(signedOut.ok, true);
  assert.deepEqual(signedOut.setCookie, ["session=initial; Path=/", "session=; Max-Age=0; Path=/"]);
});

test("the auth surface pattern ships the managed-preview login as standard", () => {
  const pattern = readFileSync(new URL("../patterns/auth-surface/PATTERN.md", import.meta.url), "utf8");
  const executable = new URL("../patterns/auth-surface/example/tools/preview-identity", import.meta.url);

  assert.equal(statSync(executable).mode & 0o111, 0o111);
  const source = readFileSync(executable, "utf8");
  assert.match(source, /runManagedPreviewIdentityCommand\(\{\n {2}protocol: /u);
  assert.match(source, /localHostnames: /u);
  assert.match(pattern, /standard, not optional/u);
  assert.ok(pattern.includes([
    "#### Preview identity",
    "",
    "- Command: `tools/preview-identity`",
    "- Protocol: `<the host's protocol id>`",
    "- Identity types: `email` `user-id`",
    "- Enabled environment: `AUTH_DEV_BYPASS_ENABLED`",
    "- Secret environment: `AUTH_DEV_BYPASS_SECRET`",
    "- Runtimes: `nodejs`"
  ].join("\n")));
});
