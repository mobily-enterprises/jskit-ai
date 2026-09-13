import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { gongProvider } from "../src/server/gong.js";

const context = { applicationId: "sales-app", subjectId: "sales-team" };
const input = { context, integrationId: "sales" };
const users = { requestId: "fixture-request", users: [{ id: "123", emailAddress: "user@example.test" }],
  records: { totalRecords: 1, currentPageSize: 1, currentPageNumber: 0 } };

async function fixture(t, apiBaseUrl = "https://api.gong.io") {
  const directory = await mkdtemp(path.join(tmpdir(), "gong-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" });
  const requests = [];
  const state = { secret: "fixture-access-secret", status: 200, response: users };
  const configuration = { schemaVersion: 1, registrations: {}, integrations: { sales: {
    provider: "gong", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:GONG_ACCESS_SECRET" },
    settings: { accessKey: "EXAMPLE_ACCESS_KEY", apiBaseUrl }, extensions: { keep: true }
  } } };
  const options = {
    configuration, providers: [gongProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (reference) => { assert.equal(reference, "env:GONG_ACCESS_SECRET"); return state.secret; },
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, directory, protection, state };
}

for (const apiBaseUrl of ["https://api.gong.io", "https://company-17.api.gong.io/"]) {
  test(`Gong verifies ${apiBaseUrl} and persists ownership across restart and key rotation`, async (t) => {
    const { service, options, requests, directory, protection, state } = await fixture(t, apiBaseUrl);
    const connected = await service.connectApiKey(input);
    assert.equal(connected.status, "connected");
    assert.equal(requests[0].url.href, `${new URL(apiBaseUrl).origin}/v2/users?includeAvatars=false`);
    assert.equal(requests[0].init.method, "GET");
    assert.equal(requests[0].init.redirect, "error");
    const header = `Basic ${Buffer.from(`EXAMPLE_ACCESS_KEY:${state.secret}`).toString("base64")}`;
    assert.equal(requests[0].headers.get("authorization"), header);
    assert.equal(requests[0].url.href.includes(state.secret), false);
    for (const name of await readdir(directory)) {
      const stored = await readFile(path.join(directory, name), "utf8");
      assert.equal(stored.includes(state.secret), false);
      assert.equal(stored.includes(header), false);
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), connected);
    state.secret = "rotated-fixture-secret";
    assert.deepEqual(await restarted.invoke({ ...input, operation: "users.list" }), users);
    assert.equal(requests.at(-1).headers.get("authorization"), `Basic ${Buffer.from(`EXAMPLE_ACCESS_KEY:${state.secret}`).toString("base64")}`);
    for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "users.list" }), { code: "connector_reconnect_required" });
    }
    assert.equal(requests.length, 2);
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });
}

test("Gong rejects invalid key identities and untrusted URLs before network or credential access", async (t) => {
  const { options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [gongProvider] });
  const configuration = structuredClone(options.configuration);
  delete configuration.integrations.sales.settings.apiBaseUrl;
  assert.deepEqual(parse(configuration), options.configuration);
  configuration.integrations.sales.settings.accessKey = " EXAMPLE_ACCESS_KEY ";
  assert.deepEqual(parse(configuration), options.configuration);
  const invalidUrls = [
    "https://api.gong.io.attacker.invalid", "https://api.gong.io@attacker.invalid", "http://api.gong.io",
    "https://user:password@api.gong.io", "https://api.gong.io:444", "https://api.gong.io/v2",
    "https://api.gong.io?url=elsewhere", "https://api.gong.io#fragment", "https://127.0.0.1",
    "https://api.gong.io/../", "https://-bad.api.gong.io", "https://bad-.api.gong.io",
    `https://${"a".repeat(64)}.api.gong.io`, "https://app.gong.io", "https://api.gong.io\\@attacker.invalid"
  ];
  for (const url of invalidUrls) {
    const changed = structuredClone(options.configuration);
    changed.integrations.sales.settings.apiBaseUrl = url;
    assert.throws(() => parse(changed), (error) => Boolean(error.fieldErrors["integrations.sales.settings.apiBaseUrl"]));
  }
  for (const accessKey of [undefined, "", "user:password", "key with spaces", "key\nheader", "key\u0000", "x".repeat(513)]) {
    const changed = structuredClone(options.configuration);
    changed.integrations.sales.settings.accessKey = accessKey;
    assert.throws(() => parse(changed), (error) => Boolean(error.fieldErrors["integrations.sales.settings.accessKey"]));
  }
  configuration.integrations.sales.authentication.secretRef = "raw-secret";
  assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.sales.authentication.secretRef"]));
  assert.equal(requests.length, 0);
});

test("Gong requires verification after key identity or host changes and never crosses customer origins", async (t) => {
  const { service, options, requests } = await fixture(t, "https://company-17.api.gong.io");
  await service.connectApiKey(input);
  for (const [field, value] of [["accessKey", "OTHER_KEY"], ["apiBaseUrl", "https://company-18.api.gong.io"]]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.sales.settings[field] = value;
    const changed = createConnectionService({ ...options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "users.list" }), { code: "connector_reconnect_required" });
  }
  for (const origin of ["https://company-18.api.gong.io", "https://api.gong.io"]) {
    const wrongHost = createConnectionService({ ...options, providers: [{ ...gongProvider, operations: {
      "users.list": { scopes: [], request: () => ({ method: "GET", url: `${origin}/v2/users` }) }
    } }] });
    await assert.rejects(wrongHost.invoke({ ...input, operation: "users.list" }), { code: "connector_destination_invalid" });
  }
  assert.equal(requests.length, 1);
});

test("Gong preserves paged users and encodes opaque cursors with explicit avatar selection", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = { ...users, records: { ...users.records, totalRecords: 2, cursor: "next+&=token" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "users.list", input: { cursor: "next+&=token", includeAvatars: true } }), state.response);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { cursor: "next+&=token", includeAvatars: "true" });
  assert.equal(requests.length, 2);
  for (const invalid of [{ cursor: "" }, { cursor: "x".repeat(8193) }, { includeAvatars: "perhaps" }, { page: 2 }, { apiBaseUrl: "https://company-18.api.gong.io" }, { url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "users.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 2);
  state.response = { users: [], records: { totalRecords: 0, currentPageSize: 0, currentPageNumber: 0 } };
  assert.deepEqual(await service.invoke({ ...input, operation: "users.list" }), state.response);
});

test("Gong rejects denied credentials, rate limits and malformed results without leaking provider bodies", async (t) => {
  const { service, requests, state } = await fixture(t);
  for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { errors: [state.secret] };
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(state.secret), false);
      assert.equal(JSON.stringify(error).includes(state.secret), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  assert.equal(requests.length, 5);
  state.status = 200;
  state.response = users;
  await service.connectApiKey(input);
  for (const malformed of [{ users: [] }, { ...users, users: {} }, { ...users, records: { ...users.records, cursor: {} } }, { ...users, records: { ...users.records, totalRecords: -1 } }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "users.list" }), { code: "connector_response_invalid" });
  }
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "users.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Gong call content preserves speaker, CRM context, statistics and opaque paging without fetching media", async t => {
  const { service, state, requests } = await fixture(t, "https://company-17.api.gong.io");
  await service.connectApiKey(input);
  const callId = "7782342274025937895";
  state.response = { records: { ...users.records, cursor: " next +/= " }, calls: [{ metaData: { id: callId, title: "Renewal" },
    parties: [{ speakerId: "22", name: "Customer" }], context: [{ system: "Salesforce", objects: [{ objectType: "Opportunity", objectId: "opp-one" }] }],
    content: { brief: "Renewal next month" }, interaction: { personInteractionStats: [{ name: "Talk Ratio", value: 0.4 }] } }] };
  const call = await service.invoke({ ...input, operation: "calls.extensive", input: { callIds: [callId], cursor: " previous +/= " } });
  assert.equal(call.calls[0].context[0].objects[0].objectId, "opp-one");
  const body = JSON.parse(requests.at(-1).init.body);
  assert.deepEqual(body.filter, { callIds: [callId] });
  assert.equal(body.cursor, " previous +/= ");
  assert.equal(body.contentSelector.exposedFields.media, false);
  assert.deepEqual(body.contentSelector.contextTiming, ["Now", "TimeOfCall"]);
  assert.equal(requests.at(-1).url.origin, "https://company-17.api.gong.io");
  state.response = { records: users.records, callTranscripts: [{ callId, transcript: [{ speakerId: "22", sentences: [{ start: 1000, end: 2000, text: "Renew next month" }] }] }] };
  const transcript = await service.invoke({ ...input, operation: "calls.transcripts", input: { callIds: [callId] } });
  assert.equal(transcript.callTranscripts[0].transcript[0].speakerId, call.calls[0].parties[0].speakerId);
  assert.equal(transcript.callTranscripts[0].transcript[0].sentences[0].text, "Renew next month");
  assert.equal(requests.at(-1).url.pathname, "/v2/calls/transcript");
  state.response = { records: users.records, peopleInteractionStats: [{ userId: "33", personInteractionStats: [{ name: "Interactivity", value: 9.23 }] }] };
  assert.equal((await service.invoke({ ...input, operation: "stats.interaction", input: { fromDate: "2026-09-01", toDate: "2026-09-03", userIds: ["33"] } })).peopleInteractionStats[0].personInteractionStats[0].value, 9.23);
  state.response = { records: users.records, calls: [{ metaData: { id: callId }, media: { audioUrl: "https://media.example.test/temporary" } }] };
  await service.invoke({ ...input, operation: "calls.extensive", input: { fromDateTime: "2026-09-01T00:00:00Z", toDateTime: "2026-09-03T00:00:00Z", includeMedia: true } });
  assert.equal(JSON.parse(requests.at(-1).init.body).contentSelector.exposedFields.media, true);
  assert.equal(requests.some(request => request.url.origin === "https://media.example.test"), false);
  const count = requests.length;
  for (const [operation, values] of [["calls.extensive", {}], ["calls.transcripts", { callIds: [Number(callId)] }], ["calls.transcripts", { fromDateTime: "2026-09-01T00:00:00Z" }], ["stats.interaction", { fromDate: "2026-02-30", toDate: "2026-03-01" }], ["stats.interaction", { fromDate: "2026-09-03", toDate: "2026-09-01" }]]) await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response = { records: { totalRecords: 0, currentPageSize: 0, currentPageNumber: 0 }, callTranscripts: [] };
  assert.deepEqual((await service.invoke({ ...input, operation: "calls.transcripts", input: { callIds: [callId] } })).callTranscripts, []);
  state.response = { callTranscripts: [] };
  await assert.rejects(service.invoke({ ...input, operation: "calls.transcripts", input: { callIds: [callId] } }), { code: "connector_response_invalid" });
});
