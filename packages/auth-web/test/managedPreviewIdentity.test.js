import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_PREVIEW_IDENTITY_PROTOCOL,
  executeManagedPreviewIdentityRequest,
  runManagedPreviewIdentityCommand
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
      APP_ENV: "development",
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

test("managed preview identity requires the application's environment instead of reporting a disabled exchange", async () => {
  await assert.rejects(executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: HOST_PROTOCOL,
    requestId: "request-env",
    target: { origin: "http://localhost:3000" }
  }, { ...HOST_OPTIONS, fetchImpl: async () => assert.fail("fetch must not run") }), /requires the application's environment/u);
});

test("managed preview identity rejects a disabled or non-local exchange", async () => {
  const disabled = await executeManagedPreviewIdentityRequest({
    operation: "logout",
    protocol: HOST_PROTOCOL,
    requestId: "request-2",
    target: { origin: "http://localhost:3000" }
  }, { ...HOST_OPTIONS, env: { APP_ENV: "development" }, fetchImpl: async () => assert.fail("fetch must not run") });
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
      APP_ENV: "development",
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
      APP_ENV: "development",
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
    env: { APP_ENV: "development", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: "  " },
    fetchImpl: async () => assert.fail("fetch must not run")
  });
  assert.equal(missing.code, "jskit_managed_preview_identity_secret_missing");

  const responses = [
    jsonResponse({ csrfToken: "csrf-token" }, { cookie: "session=initial; Path=/" }),
    jsonResponse({ ok: true }, { cookie: "session=; Max-Age=0; Path=/" })
  ];
  const signedOut = await executeManagedPreviewIdentityRequest(request, {
    ...HOST_OPTIONS,
    env: { APP_ENV: "development", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: " any-local-secret " },
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

test("an application's own exchange signs the preview in instead of the development exchange", async () => {
  const exchanged = [];
  const request = {
    operation: "login-as",
    protocol: HOST_PROTOCOL,
    requestId: "request-own",
    subject: { kind: "selector", selector: { type: "email", value: "you@example.com" } },
    target: { origin: "http://127.0.0.1:3000" }
  };
  const fetchImpl = async () => assert.fail("JSKIT's development exchange must not run");
  const exchange = async (call) => {
    exchanged.push(call);
    return call.operation === "logout"
      ? { setCookie: ["key=; Max-Age=0; Path=/"] }
      : { identity: { displayName: "You", email: "You@Example.com" }, setCookie: ["key=k; Path=/; HttpOnly", "session=s; Path=/"] };
  };

  // No development exchange is enabled, and none is needed.
  const signedIn = await executeManagedPreviewIdentityRequest(request, { ...HOST_OPTIONS, fetchImpl, exchange });
  assert.equal(signedIn.ok, true);
  assert.equal(signedIn.protocol, HOST_PROTOCOL);
  assert.equal(signedIn.requestId, "request-own");
  assert.equal(signedIn.signedOut, false);
  assert.deepEqual(signedIn.identity, { displayName: "You", email: "you@example.com", userId: "", username: "" });
  assert.deepEqual(signedIn.setCookie, ["key=k; Path=/; HttpOnly", "session=s; Path=/"]);
  assert.deepEqual(exchanged[0], {
    operation: "login-as",
    identity: { email: "you@example.com" },
    targetOrigin: "http://127.0.0.1:3000",
    fetchImpl
  });

  const signedOut = await executeManagedPreviewIdentityRequest({ ...request, operation: "logout", subject: undefined }, {
    ...HOST_OPTIONS,
    fetchImpl,
    exchange
  });
  assert.equal(signedOut.ok, true);
  assert.equal(signedOut.signedOut, true);
  assert.equal(signedOut.identity, null);
  assert.deepEqual(signedOut.setCookie, ["key=; Max-Age=0; Path=/"]);
  assert.equal(exchanged[1].identity, null);

  // The request is checked before the exchange runs.
  const remote = await executeManagedPreviewIdentityRequest({ ...request, target: { origin: "https://example.com" } }, {
    ...HOST_OPTIONS,
    exchange: async () => assert.fail("the exchange must not run")
  });
  assert.equal(remote.code, "jskit_managed_preview_identity_target_invalid");
});

test("an application's own exchange refuses with its own error, and must return its cookies", async () => {
  const request = {
    operation: "login-as",
    protocol: HOST_PROTOCOL,
    requestId: "request-refused",
    subject: { kind: "selector", selector: { type: "email", value: "someone@example.com" } },
    target: { origin: "http://localhost:3000" }
  };
  const refused = await executeManagedPreviewIdentityRequest(request, {
    ...HOST_OPTIONS,
    exchange: async () => {
      throw Object.assign(new Error("This application has one person."), { code: "one_person", statusCode: 404 });
    }
  });
  assert.deepEqual(
    [refused.ok, refused.code, refused.error, refused.statusCode, refused.setCookie],
    [false, "one_person", "This application has one person.", 404, []]
  );

  const cookieless = await executeManagedPreviewIdentityRequest(request, {
    ...HOST_OPTIONS,
    exchange: async () => ({ identity: { email: "someone@example.com" } })
  });
  assert.equal(cookieless.ok, false);
  assert.equal(cookieless.code, "jskit_managed_preview_identity_exchange_invalid");
});

test("the preview identity command hands an application's exchange the request it reads", async () => {
  const written = [];
  const exitCode = await runManagedPreviewIdentityCommand({
    protocol: HOST_PROTOCOL,
    stdin: [Buffer.from(JSON.stringify({
      operation: "logout",
      protocol: HOST_PROTOCOL,
      requestId: "request-command",
      target: { origin: "http://localhost:3000" }
    }))],
    stdout: { write: (text) => written.push(text) },
    exchange: async ({ operation }) => ({ setCookie: [`${operation}=done; Path=/`] })
  });
  assert.equal(exitCode, 0);
  const answer = JSON.parse(written.join(""));
  assert.deepEqual([answer.ok, answer.signedOut, answer.setCookie], [true, true, ["logout=done; Path=/"]]);
});
