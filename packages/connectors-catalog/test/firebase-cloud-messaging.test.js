import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPair, exportPKCS8, jwtVerify } from "jose";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { firebaseCloudMessagingProvider as provider } from "../src/server/firebase-cloud-messaging.js";
import { firebaseMessagingScope } from "../src/shared/firebase-cloud-messaging.js";
import { firebaseCloudMessagingWebConfiguration } from "../src/client/firebase-cloud-messaging.js";

const keys = await generateKeyPair("RS256", { extractable: true });
const account = { type: "service_account", project_id: "sender-project", private_key_id: "a".repeat(40),
  private_key: await exportPKCS8(keys.privateKey), client_email: "messaging@sender-project.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token", universe_domain: "googleapis.com" };
const web = { clientMode: "web", projectId: "target-project", apiKey: `AIza${"a".repeat(35)}`, appId: "1:123456789012:web:abcdef1234567890", vapidKey: `B${"a".repeat(85)}A` };
const context = { applicationId: "notifications-app", subjectId: "team" };
const input = { context, integrationId: "push" };
const message = { fid: "fixture-installation-id", notification: { title: "Order ready", body: "Your order is ready." }, data: { orderId: "42" } };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "firebase-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { now: Date.now(), credential: JSON.stringify(account, null, 2), grants: [], requests: [], status: 200, tokenStatus: 200 };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { push: {
      provider: provider.id, accountMode: "shared", scopes: [firebaseMessagingScope], settings: { projectId: "target-project", clientMode: "server" },
      authentication: { method: "service-account", secretRef: "env:FIREBASE_SERVICE_ACCOUNT" }, extensions: { cli: true }
    } }, extensions: { retained: true } },
    now: () => state.now, providers: [{ ...provider, requestTimeoutMs: 100 }], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" }) }),
    resolveReference: async () => state.credential,
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted(); const url = String(address);
      assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      const token = url === account.token_uri;
      if (token) state.grants.push({ init, parameters: new URLSearchParams(init.body) });
      else { assert.equal(url, "https://fcm.googleapis.com/v1/projects/target-project/messages:send"); state.requests.push({ init, body: JSON.parse(init.body) }); }
      if (state.hang === (token ? "token" : "message")) {
        state.started?.();
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      if (token && state.rawTokenResponse) return new Response("not-json", { status: 200 });
      return token ? Response.json(state.tokenResponse ?? { token_type: "Bearer", access_token: `access-${state.grants.length}`, expires_in: 3600 }, { status: state.tokenStatus })
        : Response.json(state.response ?? { name: "projects/target-project/messages/fixture-receipt" }, { status: state.status });
    }
  };
  return { state, options, directory, service: createConnectionService(options) };
}

test("Firebase CLI validates both client modes, public fields and indirect credentials without accepting mixed setup", async (t) => {
  const f = await fixture(t);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [provider] });
  assert.deepEqual(parse(f.options.configuration), f.options.configuration);
  const browser = structuredClone(f.options.configuration); browser.integrations.push.settings = web;
  assert.deepEqual(parse(browser).integrations.push.settings, web);
  for (const changes of [{ projectId: "https://target-project" }, { projectId: "123456789012" }, { projectId: "UPPERCASE" }, { projectId: "bad-" }, { clientMode: "unknown" }, { apiKey: web.apiKey }]) {
    const config = structuredClone(f.options.configuration); Object.assign(config.integrations.push.settings, changes);
    assert.throws(() => parse(config), { code: "integration_configuration_invalid" });
  }
  for (const field of ["apiKey", "appId", "vapidKey"]) {
    for (const value of [undefined, "", "env:WRONG_KIND", "raw-invalid-value"]) {
      const config = structuredClone(browser); config.integrations.push.settings[field] = value;
      assert.throws(() => parse(config), { code: "integration_configuration_invalid" });
    }
  }
  for (const changes of [{ scopes: [] }, { scopes: ["openid"] }, { accountMode: "per-user" },
    { authentication: { method: "service-account", secretRef: JSON.stringify(account) } },
    { authentication: { method: "api-key", secretRef: "env:KEY" } },
    { authentication: { method: "service-account", secretRef: "env:KEY", registrationRef: "google" } }]) {
    const config = structuredClone(browser); Object.assign(config.integrations.push, changes);
    assert.throws(() => parse(config), { code: "integration_configuration_invalid" });
  }
  assert.equal(f.state.grants.length, 0);
});

test("the browser helper returns only public Firebase settings and derives the sender ID without numeric rounding", () => {
  const config = firebaseCloudMessagingWebConfiguration({ ...web, appId: "1:9007199254740993:web:abcdef1234567890" });
  assert.deepEqual(config, { firebaseConfig: { projectId: web.projectId, apiKey: web.apiKey, appId: "1:9007199254740993:web:abcdef1234567890", messagingSenderId: "9007199254740993" }, vapidKey: web.vapidKey });
  assert.throws(() => firebaseCloudMessagingWebConfiguration({ projectId: "project-id" }), TypeError);
  assert.throws(() => firebaseCloudMessagingWebConfiguration({ ...web, private_key: account.private_key }));
});

test("Firebase signs a bounded RS256 assertion and verifies target-project IAM using only a dry-run message", async (t) => {
  const f = await fixture(t); const connected = await f.service.connectServiceAccount(input);
  assert.equal(connected.status, "connected"); assert.equal(f.state.grants.length, 1); assert.equal(f.state.requests.length, 1);
  const grant = f.state.grants[0]; assert.equal(grant.parameters.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(new Headers(grant.init.headers).get("content-type"), "application/x-www-form-urlencoded");
  const { payload, protectedHeader } = await jwtVerify(grant.parameters.get("assertion"), keys.publicKey, {
    algorithms: ["RS256"], issuer: account.client_email, audience: account.token_uri, currentDate: new Date(f.state.now)
  });
  assert.deepEqual(protectedHeader, { alg: "RS256", typ: "JWT", kid: account.private_key_id });
  assert.deepEqual(payload, { scope: firebaseMessagingScope, iss: account.client_email, aud: account.token_uri, iat: Math.floor(f.state.now / 1000), exp: Math.floor(f.state.now / 1000) + 3600 });
  assert.deepEqual(f.state.requests[0].body, { validate_only: true, message: { topic: "jskit-connection-check", data: { connectionCheck: "true" } } });
  assert.equal(new Headers(f.state.requests[0].init.headers).get("authorization"), "Bearer access-1");
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8"); assert(!text.includes("access-1")); assert(!text.includes("PRIVATE KEY"));
  }
});

test("explicit validate and send operations support each target and never replay or turn validation into delivery", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  for (const target of [{ fid: "fixture-fid" }, { token: "fixture-token" }, { topic: "news_updates" }, { condition: "'news' in topics && 'offers' in topics" }]) {
    for (const operation of ["messages.validate", "messages.send"]) {
      const value = { ...target, notification: message.notification, data: message.data };
      const before = f.state.requests.length;
      await f.service.invoke({ ...input, operation, input: { message: value } });
      assert.deepEqual(f.state.requests.at(-1).body, { message: value, validate_only: operation === "messages.validate" });
      assert.equal(f.state.requests.length, before + 1);
    }
  }
  assert.equal(f.state.grants.length, 1);
});

test("Firebase rejects malformed targets, reserved data and oversized payloads before sending", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input); const before = f.state.requests.length;
  for (const value of [{}, { ...message, topic: "extra-target" }, { ...message, fid: "white space" },
    { topic: "/topics/news", data: { value: "x" } }, { fid: "x" }, { fid: "x", notification: {} },
    { ...message, name: "projects/another/messages/1" }, { ...message, data: { count: 2 } },
    { ...message, data: { from: "x" } }, { ...message, data: { "google.x": "x" } },
    { ...message, data: { "gcm.notification.body": "x" } }, { ...message, data: { value: "💌".repeat(1100) } },
    { topic: "news", data: { value: "x".repeat(2100) } }, { ...message, notification: { image: "http://image.test/x" } }]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "messages.send", input: { message: value } }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...input, operation: "messages.send", input: { message, validate_only: true } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...input, operation: "messages.delete" }), { code: "connector_operation_unknown" });
  assert.equal(f.state.requests.length, before);
});

test("Firebase accepts only explicit service-account keys and never loads another credential or token destination", async (t) => {
  const f = await fixture(t);
  for (const changes of [{ type: "external_account" }, { type: "authorized_user" }, { project_id: "../other" }, { private_key: "bad-key" },
    { private_key_id: "unsafe\nkey" }, { client_email: "not-an-account@example.com" }, { token_uri: "http://169.254.169.254/token" },
    { token_uri: "https://oauth2.googleapis.com/token?extra=1" }, { universe_domain: "other.googleapis.com" }]) {
    f.state.credential = JSON.stringify({ ...account, ...changes });
    await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_binding_missing" });
  }
  f.state.credential = "{not-json";
  await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_binding_missing" });
  assert.equal(f.state.grants.length, 0); assert.equal(f.state.requests.length, 0);
});

test("failed or malformed token grants remain disconnected and redact provider diagnostics", async (t) => {
  const f = await fixture(t);
  for (const [status, value, code] of [[400, { error: "invalid_grant" }, "connector_reconnect_required"],
    [403, {}, "connector_permission_denied"], [429, {}, "connector_rate_limited"], [500, {}, "connector_provider_failed"],
    [200, { access_token: "raw-private-token", token_type: "Bearer" }, "connector_response_invalid"],
    [302, {}, "connector_response_invalid"]]) {
    f.state.tokenStatus = status; f.state.tokenResponse = { ...value, error_description: account.private_key };
    await assert.rejects(f.service.connectServiceAccount(input), (error) => error.code === code && !JSON.stringify(error).includes("PRIVATE KEY"));
  }
  f.state.rawTokenResponse = true;
  await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_response_invalid" });
  assert.equal((await f.service.status(input)).status, "disconnected"); assert.equal(f.state.requests.length, 0);
});

test("Firebase cannot claim a connection for denied sends or a malformed or wrong-project receipt", async (t) => {
  const f = await fixture(t);
  for (const [status, response, code] of [[401, {}, "connector_reconnect_required"], [403, {}, "connector_permission_denied"],
    [429, {}, "connector_rate_limited"], [500, {}, "connector_provider_failed"], [200, {}, "connector_response_invalid"],
    [200, { name: "projects/other-project/messages/1" }, "connector_response_invalid"], [200, { name: "garbage" }, "connector_response_invalid"]]) {
    f.state.status = status; f.state.response = response;
    await assert.rejects(f.service.connectServiceAccount(input), { code });
    assert.equal((await f.service.status(input)).status, "disconnected");
  }
});

test("Firebase grants survive file restart, renew with rotated credentials and retain owner and project boundaries", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  const restarted = createConnectionService(f.options); await restarted.invoke({ ...input, operation: "messages.validate", input: { message } });
  assert.equal(f.state.grants.length, 1); f.state.now += 3_600_000;
  await restarted.invoke({ ...input, operation: "messages.validate", input: { message } }); assert.equal(f.state.grants.length, 2);
  f.state.credential = JSON.stringify({ ...account, private_key_id: "b".repeat(40) });
  await restarted.invoke({ ...input, operation: "messages.validate", input: { message } }); assert.equal(f.state.grants.length, 3);
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "messages.send", input: { message } }), { code: "connector_reconnect_required" });
  }
  const configuration = structuredClone(f.options.configuration); configuration.integrations.push.settings.projectId = "other-project";
  const changed = createConnectionService({ ...f.options, configuration }); assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "messages.send", input: { message } }), { code: "connector_reconnect_required" });
  await restarted.disconnect(input); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("sending requires application authorization over the exact audience and payload", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  let release; const paused = new Promise((resolve) => { release = resolve; }); let started;
  const authorizing = new Promise((resolve) => { started = resolve; });
  const service = createConnectionService({ ...f.options, authorize: async (owner, operation) => {
    if (operation.operation !== "messages.send") return owner;
    if (operation.input.message.fid !== message.fid) return null;
    started(); await paused; operation.input.message.fid = "policy-mutation"; return owner;
  } });
  await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: { message: { ...message, fid: "not-owned" } } }), { code: "connector_access_denied" });
  const values = { message: structuredClone(message) };
  const pending = service.invoke({ ...input, operation: "messages.send", input: values }); await authorizing;
  values.message.fid = "caller-mutation"; release(); await pending;
  assert.equal(f.state.requests.at(-1).body.message.fid, message.fid);
});

test("Firebase cancellation and timeout never retry a token exchange or notification send", async (t) => {
  const f = await fixture(t);
  for (const stage of ["token", "message"]) {
    f.state.hang = stage; const control = new AbortController(); const started = new Promise((resolve) => { f.state.started = resolve; });
    const pending = f.service.connectServiceAccount({ ...input, signal: control.signal }); await started; control.abort();
    await assert.rejects(pending, { code: "connector_cancelled" });
  }
  f.state.hang = false; await f.service.connectServiceAccount(input);
  f.state.hang = "message"; const before = f.state.requests.length;
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(f.service.invoke({ ...input, operation: "messages.send", input: { message } }), { code: "connector_provider_timeout" }); } finally { clearTimeout(keepAlive); }
  assert.equal(f.state.requests.length, before + 1); assert.equal((await f.service.status(input)).status, "connected");
});

test("the published Firebase setup example validates as the same CLI configuration", async () => {
  const guide = await readFile(new URL("../docs/firebase-cloud-messaging.md", import.meta.url), "utf8");
  const source = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  const config = parseIntegrationConfiguration(source, { providers: [provider] });
  assert.equal(config.integrations.push.authentication.method, "service-account");
  assert.equal(config.integrations.push.settings.projectId, "my-notifications-app");
  assert.deepEqual(config.registrations, {});
});


test("Firebase distinguishes expired recipients from malformed payloads without invalidating the sender grant", async t => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  f.state.status = 404; f.state.response = { error: { message: "private provider diagnostics", details: [
    { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }
  ] } };
  for (const target of [{ fid: "old-installation" }, { token: "old-token" }]) {
    const before = f.state.requests.length;
    await assert.rejects(f.service.invoke({ ...input, operation: "messages.send", input: { message: { ...target, data: { orderId: "42" } } } }), error => error.code === "connector_recipient_unregistered" && !error.message.includes("private provider"));
    assert.equal(f.state.requests.length, before + 1);
    assert.equal((await f.service.status(input)).status, "connected");
  }
  f.state.status = 400; f.state.response = { error: { details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "INVALID_ARGUMENT" }] } };
  await assert.rejects(f.service.invoke({ ...input, operation: "messages.send", input: { message } }), { code: "connector_message_invalid" });
  f.state.status = 404; f.state.response = { error: { status: "NOT_FOUND" } };
  await assert.rejects(f.service.invoke({ ...input, operation: "messages.send", input: { message } }), { code: "connector_provider_failed" });
  f.state.status = 200; f.state.response = undefined;
  assert.equal((await f.service.invoke({ ...input, operation: "messages.send", input: { message } })).name, "projects/target-project/messages/fixture-receipt");
});
