import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { inngestProvider } from "../src/server/inngest.js";

const context = { applicationId: "workflow-app", subjectId: "workspace" };
const input = { context, integrationId: "jobs" };
const event = { name: "app/report.requested", data: { reportId: "42", filters: ["active"] }, id: "report-requested-42", ts: 1788920000000 };
const appPage = { data: [{ id: "reports", name: "Reports", method: "SERVE", isArchived: false }], page: { cursor: null, hasMore: false, limit: 20 } };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "inngest-connectors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" });
  const requests = [];
  const resolved = [];
  const state = { signing: "signkey-prod-fixture-signing", eventKey: "event+key/with?special#chars=", httpStatus: 200,
    page: appPage, receipt: { ids: ["01K1QQ3VQ8R3M8QX4D51J8G7XH"], status: 200 } };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { jobs: {
      provider: "inngest", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:INNGEST_SIGNING_KEY" },
      settings: { eventKeyRef: "env:INNGEST_EVENT_KEY", branchEnvironment: "feature/my-branch" }
    } }, extensions: { preserve: true } },
    providers: [inngestProvider], store: createFileConnectionStore({ directory, protection }),
    authorize: async (owner, request) => {
      if (request.operation === "events.send" && request.input.name !== event.name) return null;
      return owner;
    },
    resolveReference: async (reference) => {
      resolved.push(reference);
      if (reference === "env:INNGEST_SIGNING_KEY") return state.signing;
      if (reference === "env:INNGEST_EVENT_KEY") return state.eventKey;
      throw new Error("Unrecognized binding.");
    },
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted();
      const url = new URL(String(address));
      requests.push({ url, init, headers: new Headers(init.headers), body: init.body && JSON.parse(init.body) });
      if (state.pause) {
        state.started?.();
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      return Response.json(state.httpStatus === 200 ? (url.hostname === "inn.gs" ? state.receipt : state.page) : { error: state.eventKey, signing: state.signing },
        { status: state.httpStatus, headers: { Location: "https://unexpected.example", Link: '<https://unexpected.example/next>; rel="next"' } });
    }
  };
  return { service: createConnectionService(options), options, directory, protection, state, requests, resolved };
}

test("Inngest verifies only signing-key metadata and keeps both credential values out of file state", async (t) => {
  const { service, options, directory, protection, requests, resolved, state } = await fixture(t);
  const connection = await service.connectApiKey(input);
  assert.equal(connection.status, "connected");
  assert.deepEqual(resolved, ["env:INNGEST_SIGNING_KEY"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.href, "https://api.inngest.com/v2/apps?limit=20&archived=false");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].headers.get("authorization"), `Bearer ${state.signing}`);
  assert.equal(requests[0].headers.get("x-inngest-env"), null, "Event branch selection does not silently retarget API reads.");
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    assert.equal(text.includes(state.eventKey), false);
    assert.equal(text.includes(state.signing), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connection);
  for (const owner of [{ ...context, applicationId: "different-app" }, { ...context, subjectId: "different-owner" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "events.send", input: event }), { code: "connector_reconnect_required" });
  }
  assert.equal(requests.length, 1);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Inngest event delivery uses only the encoded Event Key and preserves payload and branch", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  const original = structuredClone(event);
  assert.deepEqual(await service.invoke({ ...input, operation: "events.send", input: event }), state.receipt);
  const request = requests.at(-1);
  assert.equal(request.url.href, `https://inn.gs/e/${encodeURIComponent(state.eventKey)}`);
  assert.equal(request.url.origin, "https://inn.gs");
  assert.equal(request.url.search, "");
  assert.equal(request.url.hash, "");
  assert.equal(request.headers.get("authorization"), null);
  assert.equal(request.headers.get("x-inngest-env"), "feature/my-branch");
  assert.equal(request.init.redirect, "error");
  assert.deepEqual(request.body, event);
  assert.equal(JSON.stringify(request.body).includes("env:"), false);
  assert.deepEqual(event, original);
  state.eventKey = "rotated-event-key";
  await service.invoke({ ...input, operation: "events.send", input: event });
  assert.equal(requests.at(-1).url.pathname, "/e/rotated-event-key");
  state.signing = "signkey-prod-rotated";
  await service.invoke({ ...input, operation: "apps.list" });
  assert.equal(requests.at(-1).headers.get("authorization"), `Bearer ${state.signing}`);
});

test("Inngest exposes bounded metadata pages without following provider links", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.page = { data: [{ id: "send-report", triggers: [{ type: "EVENT", value: event.name }] }], page: { cursor: "next+/=cursor", hasMore: true, limit: 5 } };
  assert.deepEqual(await service.invoke({ ...input, operation: "functions.list", input: { appId: "reports/a?b", limit: 5, cursor: "opaque+/=" } }), state.page);
  assert.equal(requests.at(-1).url.pathname, "/v2/apps/reports%2Fa%3Fb/functions");
  assert.equal(requests.at(-1).url.searchParams.get("cursor"), "opaque+/=");
  await service.invoke({ ...input, operation: "apps.list", input: { archived: true, limit: 100 } });
  assert.equal(requests.at(-1).url.searchParams.get("archived"), "true");
  assert.equal(requests.length, 3);
});

test("Inngest rejects invalid configuration, event payloads and metadata inputs before HTTP", async (t) => {
  const { options, service, requests } = await fixture(t);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [inngestProvider] });
  assert.deepEqual(parse(options.configuration), options.configuration);
  for (const eventKeyRef of [undefined, "raw-key", "env: KEY"]) {
    const config = structuredClone(options.configuration);
    config.integrations.jobs.settings.eventKeyRef = eventKeyRef;
    assert.throws(() => parse(config));
  }
  for (const branchEnvironment of ["branch\nAuthorization: other", "branch with spaces", "bránch"]) {
    const config = structuredClone(options.configuration);
    config.integrations.jobs.settings.branchEnvironment = branchEnvironment;
    assert.throws(() => parse(config));
  }
  await service.connectApiKey(input);
  const count = requests.length;
  for (const invalid of [{ name: event.name }, { name: event.name, data: [] }, { ...event, ts: 1 }, { ...event, ts: 1788920000000.5 }, { ...event, url: "https://unexpected.example" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "events.send", input: invalid }), { code: "connector_input_invalid" });
  }
  for (const value of [0, 101, 3.5]) await assert.rejects(service.invoke({ ...input, operation: "apps.list", input: { limit: value } }), { code: "connector_input_invalid" });
  for (const appId of [".", "..", ""]) await assert.rejects(service.invoke({ ...input, operation: "functions.list", input: { appId } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
});

test("Inngest authorizes event name and data before delivery and checks the Event Key binding lazily", async (t) => {
  const { service, requests, state, resolved } = await fixture(t);
  await service.connectApiKey(input);
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "events.send", input: { ...event, name: "unauthorized/event" } }), { code: "connector_access_denied" });
  assert.equal(resolved.includes("env:INNGEST_EVENT_KEY"), false);
  for (const key of [undefined, "", "\n", "key\rAuthorization: secret"]) {
    state.eventKey = key;
    await assert.rejects(service.invoke({ ...input, operation: "events.send", input: event }), { code: "connector_binding_missing" });
  }
  assert.equal(requests.length, count);
  assert.equal((await service.status(input)).status, "connected", "The existing metadata grant remains; Event Key validity was not asserted.");
});

test("Inngest rejects ambiguous event receipts and provider failures without disclosing credentials or retrying", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  for (const [receipt, code] of [[{ status: 200, ids: [] }, "connector_response_invalid"], [{ status: 200, ids: ["id"], error: "failure" }, "connector_response_invalid"],
    [{ status: 403, error: "denied" }, "connector_permission_denied"], [{ status: 429, error: "limited" }, "connector_rate_limited"]]) {
    state.receipt = receipt;
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "events.send", input: event }), { code });
    assert.equal(requests.length, count + 1);
  }
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.httpStatus = status;
    await assert.rejects(service.invoke({ ...input, operation: "events.send", input: event }), (error) => error.code === code && !error.message.includes(state.eventKey) && !error.message.includes(state.signing));
  }
  state.httpStatus = 401;
  await assert.rejects(service.invoke({ ...input, operation: "events.send", input: event }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Inngest rejects malformed metadata and failed verification without creating a connection", async (t) => {
  const { service, state } = await fixture(t);
  for (const page of [{ ok: true }, { data: [{}], page: { hasMore: false, limit: 20 } }, { data: [], page: { hasMore: "false", limit: 20 } }]) {
    state.page = page;
    await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.httpStatus = 401;
  await assert.rejects(service.connectApiKey(input), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Inngest reference and branch changes require reverification, including branch removal", async (t) => {
  const { service, options, requests } = await fixture(t);
  await service.connectApiKey(input);
  for (const changes of [{ eventKeyRef: "env:OTHER_EVENT_KEY" }, { branchEnvironment: "other-branch" }, { branchEnvironment: undefined }]) {
    const config = structuredClone(options.configuration);
    Object.assign(config.integrations.jobs.settings, changes);
    for (const [name, value] of Object.entries(changes)) if (value === undefined) delete config.integrations.jobs.settings[name];
    const changed = createConnectionService({ ...options, configuration: config });
    const count = requests.length;
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "events.send", input: event }), { code: "connector_reconnect_required" });
    assert.equal(requests.length, count);
  }
  const config = structuredClone(options.configuration);
  delete config.integrations.jobs.settings.branchEnvironment;
  const changed = createConnectionService({ ...options, configuration: config });
  await changed.connectApiKey(input);
  await changed.invoke({ ...input, operation: "events.send", input: event });
  assert.equal(requests.at(-1).headers.get("x-inngest-env"), null);
});

test("Inngest cancellation reports interruption without replaying an event", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  const controller = new AbortController();
  state.pause = true;
  const started = new Promise((resolve) => { state.started = resolve; });
  const pending = service.invoke({ ...input, operation: "events.send", input: event, signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "connector_cancelled" });
  await started;
  controller.abort();
  await rejected;
  assert.equal(requests.length, 2);
  assert.equal((await service.status(input)).status, "connected");
});
