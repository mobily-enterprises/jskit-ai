import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { twilioProvider, verifyTwilioRequest } from "../src/server/twilio.js";

const accountSid = `AC${"a".repeat(32)}`;
const apiKeySid = `SK${"b".repeat(32)}`;
const context = { applicationId: "app-one", subjectId: "team-one" };
const input = { context, integrationId: "voice" };
const calls = { calls: [{ sid: `CA${"c".repeat(32)}`, status: "completed" }], page: 0, page_size: 50, next_page_uri: null };

test("Twilio form callbacks bind the account, exact URL, all fields and account token", () => {
  const fields = { AccountSid: accountSid, MessageSid: `SM${"d".repeat(32)}`, From: "+61400000000", To: "+61411111111", Body: "Booking & wash + trim ✓", FutureField: "preserved" };
  // Independently calculated with Python hmac/hashlib from the documented Twilio algorithm.
  const request = { rawBody: Buffer.from(new URLSearchParams(fields).toString()),
    signature: "UnC3xg2DtLI2bM+vaqPuX3giUfY=", authToken: "fixture-account-token",
    url: "https://app.example.com/twilio/inbound?route=sms", accountSid,
    contentType: "application/x-www-form-urlencoded; charset=UTF-8" };
  assert.deepEqual(verifyTwilioRequest(request), fields);
  for (const changes of [
    { authToken: "fixture-key-secret" }, { accountSid: `AC${"b".repeat(32)}` },
    { url: "https://app.example.com/twilio/other?route=sms" },
    { url: "https://app.example.com/twilio/inbound?route=voice" },
    { rawBody: Buffer.from(new URLSearchParams({ ...fields, FutureField: "changed" }).toString()) },
    { rawBody: Buffer.concat([request.rawBody, Buffer.from(`&AccountSid=${accountSid}`)]) },
    { rawBody: new Uint8Array(1048577) }, { signature: "invalid" },
    { contentType: "application/json" }, { url: "http://app.example.com/twilio/inbound?route=sms" }
  ]) assert.throws(() => verifyTwilioRequest({ ...request, ...changes }), { code: "connector_webhook_invalid" });
});

test("Twilio sends encoded SMS and creates calls, with explicit status reads and no retry of uncertain writes", async t => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  const message = { sid: `SM${"d".repeat(32)}`, account_sid: accountSid, status: "queued", error_code: null };
  const sms = { To: "+61400000000", From: "+61411111111", Body: "  Booking & wash + trim ✓  ", StatusCallback: "https://app.example.com/twilio/status?a=1&b=2" };
  state.response = message;
  assert.deepEqual(await service.invoke({ ...input, operation: "messages.send", input: sms }), message);
  assert.equal(requests.at(-1).url.pathname, `/2010-04-01/Accounts/${accountSid}/Messages.json`);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), sms);
  state.response = { ...message, status: "delivered" };
  assert.equal((await service.invoke({ ...input, operation: "messages.get", input: { resourceSid: message.sid } })).status, "delivered");
  assert.equal(requests.at(-1).url.pathname, `/2010-04-01/Accounts/${accountSid}/Messages/${message.sid}.json`);
  const call = { sid: `CA${"e".repeat(32)}`, account_sid: accountSid, status: "queued" };
  state.response = call;
  const voice = { To: sms.To, From: sms.From, Twiml: '<Response><Say>Booking &amp; grooming</Say></Response>' };
  assert.deepEqual(await service.invoke({ ...input, operation: "calls.create", input: voice }), call);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(requests.at(-1).init.body)), { ...voice, Timeout: "60" });
  state.response = { ...call, status: "completed", duration: "12" };
  assert.equal((await service.invoke({ ...input, operation: "calls.get", input: { resourceSid: call.sid } })).duration, "12");
  const before = requests.length;
  state.status = 503;
  state.response = { message: state.secret };
  await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: sms }), { code: "connector_provider_failed" });
  assert.equal(requests.length, before + 1);
});

test("Twilio rejects invalid or ambiguous sends before transport and preserves the app operation policy", async t => {
  const { service, options, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  const base = { To: "+61400000000", From: "+61411111111", Body: "Booking reminder" };
  for (const invalid of [
    { ...base, To: "not-a-number" }, { ...base, MessagingServiceSid: `MG${"c".repeat(32)}` },
    { To: base.To, Body: base.Body }, { ...base, Body: "" }, { ...base, Body: "a".repeat(1601) },
    { ...base, StatusCallback: "https://user:secret@app.example.com/callback" },
    { ...base, AccountSid: accountSid }
  ]) await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: invalid }), { code: "connector_input_invalid" });
  for (const invalid of [
    { To: base.To, From: base.From },
    { To: base.To, From: base.From, Url: "https://app.example.com/voice", Twiml: "<Response/>" },
    { To: base.To, From: base.From, Url: "http://app.example.com/voice" }
  ]) await assert.rejects(service.invoke({ ...input, operation: "calls.create", input: invalid }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "messages.get", input: { resourceSid: "../Accounts" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, 1);
  const denied = createConnectionService({ ...options, authorize: async () => { throw new Error("App policy denied destination"); } });
  await assert.rejects(denied.invoke({ ...input, operation: "messages.send", input: base }), /App policy denied destination/u);
  assert.equal(requests.length, 1);
  state.response = { sid: "invalid", account_sid: accountSid, status: "queued" };
  await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: base }), { code: "connector_response_invalid" });
});

async function fixture(t, region = "us1") {
  const directory = await mkdtemp(path.join(tmpdir(), "twilio-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" });
  const requests = [];
  const state = { secret: "fixture-key-secret", status: 200, response: calls };
  const configuration = { schemaVersion: 1, registrations: {}, integrations: { voice: {
    provider: "twilio", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:TWILIO_API_SECRET" },
    settings: { accountSid, apiKeySid, region }, extensions: { keep: true }
  } } };
  const options = {
    configuration, providers: [twilioProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (ref) => { assert.equal(ref, "env:TWILIO_API_SECRET"); return state.secret; },
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, directory, protection, state };
}

for (const [region, host] of [["us1", "api.twilio.com"], ["ie1", "api.dublin.ie1.twilio.com"], ["au1", "api.sydney.au1.twilio.com"]]) {
  test(`Twilio ${region} uses regional Standard-key authentication and survives file restart and rotation`, async (t) => {
    const { service, options, requests, directory, protection, state } = await fixture(t, region);
    const connected = await service.connectApiKey(input);
    assert.equal(connected.status, "connected");
    const request = requests[0];
    assert.equal(request.url.href, `https://${host}/2010-04-01/Accounts/${accountSid}/Calls.json?PageSize=50&Page=0`);
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.redirect, "error");
    const authorization = `Basic ${Buffer.from(`${apiKeySid}:${state.secret}`).toString("base64")}`;
    assert.equal(request.headers.get("authorization"), authorization);
    assert.equal(request.url.href.includes(state.secret), false);
    for (const name of await readdir(directory)) {
      const stored = await readFile(path.join(directory, name), "utf8");
      assert.equal(stored.includes(state.secret), false);
      assert.equal(stored.includes(authorization), false);
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), connected);
    state.secret = "rotated-fixture-secret";
    assert.deepEqual(await restarted.invoke({ ...input, operation: "calls.list" }), calls);
    assert.equal(requests.at(-1).headers.get("authorization"), `Basic ${Buffer.from(`${apiKeySid}:${state.secret}`).toString("base64")}`);
    for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "calls.list" }), { code: "connector_reconnect_required" });
    }
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });
}

test("Twilio configuration validates both SID types and defaults the same region for CLI and UI", async (t) => {
  const { options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [twilioProvider] });
  const config = structuredClone(options.configuration);
  delete config.integrations.voice.settings.region;
  assert.deepEqual(parse(config), options.configuration);
  for (const [field, value] of [
    ["accountSid", undefined], ["accountSid", apiKeySid], ["accountSid", `AC${"g".repeat(32)}`],
    ["accountSid", "../Calls"], ["apiKeySid", accountSid], ["apiKeySid", `SK${"x".repeat(32)}`],
    ["apiKeySid", ""], ["region", "de1"], ["region", "https://attacker.invalid"]
  ]) {
    const changed = structuredClone(options.configuration);
    changed.integrations.voice.settings[field] = value;
    assert.throws(() => parse(changed), (error) => Boolean(error.fieldErrors[`integrations.voice.settings.${field}`]));
  }
  config.integrations.voice.authentication.secretRef = "a-secret-value";
  assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors["integrations.voice.authentication.secretRef"]));
  assert.equal(requests.length, 0);
});

test("Twilio requires re-verification after account, API key identity or region changes", async (t) => {
  const { service, options, requests } = await fixture(t);
  await service.connectApiKey(input);
  for (const [field, value] of [["accountSid", `AC${"d".repeat(32)}`], ["apiKeySid", `SK${"e".repeat(32)}`], ["region", "ie1"]]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.voice.settings[field] = value;
    const changed = createConnectionService({ ...options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "calls.list" }), { code: "connector_reconnect_required" });
  }
  const wrongDestination = createConnectionService({ ...options, providers: [{ ...twilioProvider, operations: {
    "calls.list": { scopes: [], request: () => ({ method: "GET", url: `https://api.dublin.ie1.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json` }) }
  } }] });
  await assert.rejects(wrongDestination.invoke({ ...input, operation: "calls.list" }), { code: "connector_destination_invalid" });
  assert.equal(requests.length, 1);
});

test("Twilio preserves call pagination and encodes filters without following provider URLs", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = { ...calls, next_page_uri: `/2010-04-01/Accounts/${accountSid}/Calls.json?Page=2&PageToken=next%2B%26` };
  const values = { PageSize: 25, Page: 1, PageToken: "next+&", To: "+61400000000", From: "client:operator", Status: "completed" };
  assert.deepEqual(await service.invoke({ ...input, operation: "calls.list", input: values }), state.response);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])));
  assert.equal(requests.length, 2);
  for (const invalid of [
    { PageSize: 0 }, { PageSize: 1001 }, { Page: -1 }, { PageToken: "" }, { PageToken: "x".repeat(4097) },
    { Status: "unknown" }, { To: "x".repeat(257) }, { AccountSid: accountSid }, { region: "ie1" },
    { url: "https://attacker.invalid" }, { next_page_uri: state.response.next_page_uri }
  ]) await assert.rejects(service.invoke({ ...input, operation: "calls.list", input: invalid }), { code: "connector_input_invalid" });
  assert.equal(requests.length, 2);
  state.response = { calls: [], page: 1, page_size: 1000, next_page_uri: null };
  assert.deepEqual(await service.invoke({ ...input, operation: "calls.list", input: { PageSize: 1000 } }), state.response);
});

test("Twilio errors, wrong-region credentials and malformed successes never verify or leak secrets", async (t) => {
  const { service, requests, state } = await fixture(t, "au1");
  for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { message: state.secret, code: 20003 };
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(state.secret), false);
      assert.equal(JSON.stringify(error).includes(state.secret), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ url }) => url.hostname === "api.sydney.au1.twilio.com"));
  state.status = 200;
  state.response = calls;
  await service.connectApiKey(input);
  for (const malformed of [{ calls: [] }, { ...calls, calls: {} }, { ...calls, next_page_uri: 1 }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "calls.list" }), { code: "connector_response_invalid" });
  }
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "calls.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});
