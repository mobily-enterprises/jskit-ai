import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { wixProvider as provider } from "../src/server/wix.js";

const accountId = "01234567-89ab-cdef-0123-456789abcdef";
const siteId = "12345678-9abc-def0-1234-56789abcdef0";
const context = { applicationId: "app-one", subjectId: "team-one" };
const input = { context, integrationId: "wix" };
const sites = { sites: [{ id: siteId, displayName: "Fixture site", published: false }], metadata: { count: 1, cursors: { next: "fixture +/cursor==" } } };

test("Wix retrieves service choices without converting native prices or crossing service identities", async t => {
  const { service, state, requests } = await fixture(t, { siteId });
  await service.connectApiKey(input);
  const variants = { id: siteId, serviceId: accountId, revision: "9007199254740993",
    options: { values: [{ id: siteId, type: "CUSTOM", customData: { name: "Customer type", choices: ["Adult", "Child"] } }] },
    variants: { values: [{ choices: [{ optionId: siteId, custom: "Child" }], price: { value: "15.10", currency: "AUD" } }] } };
  state.response = { serviceVariants: variants };
  const call = { ...input, operation: "bookingServices.getVariants", input: { serviceId: accountId } };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).url.pathname, `/bookings/v1/serviceOptionsAndVariants/service_id/${accountId}`);
  assert.equal(requests.at(-1).init.method, "GET");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response = { serviceVariants: { ...variants, serviceId: siteId } };
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  state.response = { serviceOptionsAndVariants: variants };
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  state.response = { serviceVariants: { ...variants, variants: { values: [null] } } };
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  let count = requests.length;
  await assert.rejects(service.invoke({ ...call, input: { serviceId: "wrong" } }), { code: "connector_input_invalid" });
  state.deny = true;
  await assert.rejects(service.invoke(call), /Host denied/);
  assert.equal(requests.length, count);
  state.deny = false; state.status = 404; state.response = { message: "Not found" };
  await assert.rejects(service.invoke(call));
  assert.equal(requests.length, count + 1);
});

async function fixture(t, settings = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "wix-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const requests = [];
  const state = { key: "fixture-wix-key", status: 200, response: sites, stall: false, deny: false };
  const configuration = { schemaVersion: 1, integrations: {
    wix: { provider: "wix", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:WIX_KEY" },
      settings: { accountId, ...settings }, extensions: { keep: true } }
  }, registrations: {}, extensions: { fromCli: true } };
  const options = { configuration, providers: [provider], authorize: async (owner) => { if (state.deny) throw new Error("Host denied"); return owner; },
    resolveReference: async (ref) => { assert.equal(ref, "env:WIX_KEY"); return state.key; },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      if (state.stall) return new Promise((resolve, reject) => {
        init.signal.throwIfAborted(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, configuration, directory, protection, requests, state };
}

test("Wix validates account settings and secret references without opening an OAuth journey", async (t) => {
  const { service, configuration, requests } = await fixture(t);
  const validate = (config) => validateIntegrationConfiguration(config, { providers: [provider] });
  assert.deepEqual(validate(configuration), configuration);
  for (const value of [undefined, "", "not-a-guid", "https://attacker.invalid", `${accountId}\r\nheader`]) {
    const config = structuredClone(configuration); config.integrations.wix.settings.accountId = value;
    assert.throws(() => validate(config), (error) => Boolean(error.fieldErrors["integrations.wix.settings.accountId"]));
  }
  for (const change of [{ accountMode: "per-user" }, { scopes: ["sites.write"] }, { authentication: { method: "api-key", secretRef: "raw-secret" } }]) {
    const config = structuredClone(configuration); Object.assign(config.integrations.wix, change);
    assert.throws(() => validate(config), { code: "integration_configuration_invalid" });
  }
  const config = structuredClone(configuration); config.integrations.wix.accountMode = "assistant";
  config.integrations.wix.settings.accountId = ` ${accountId} `;
  assert.equal(validate(config).integrations.wix.settings.accountId, accountId);
  await assert.rejects(service.beginAuthorization(input), { code: "connector_mode_unavailable" });
  assert.equal(requests.length, 0);
});

test("Wix verifies with account headers, encrypts its file grant and resolves rotated keys", async (t) => {
  const { service, options, directory, protection, requests, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected"); assert.equal(JSON.stringify(connected).includes(state.key), false);
  const first = requests[0];
  assert.equal(first.url.href, "https://www.wixapis.com/site-list/v2/sites/query"); assert.equal(first.init.method, "POST");
  assert.equal(first.headers.get("authorization"), state.key); assert.equal(first.headers.get("wix-account-id"), accountId);
  assert.equal(first.headers.has("wix-site-id"), false); assert.equal(first.init.redirect, "error"); assert.equal(first.init.credentials, "omit");
  assert.deepEqual(JSON.parse(first.init.body), { query: { cursorPaging: { limit: 20 } } });
  for (const name of await readdir(directory)) assert.equal((await readFile(path.join(directory, name), "utf8")).includes(state.key), false);
  state.key = "rotated-wix-key";
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.equal((await restarted.status(input)).status, "reconnect-required");
  assert.deepEqual(await restarted.invoke({ ...input, operation: "sites.list" }), sites);
  assert.equal(requests.at(-1).headers.get("authorization"), state.key);
  assert.equal((await restarted.status(input)).status, "connected");
  await restarted.disconnect(input); assert.equal((await service.status(input)).status, "disconnected");
});

test("Wix reads explicit cursor pages and accepts empty accounts without replaying requests", async (t) => {
  const { service, requests, state } = await fixture(t);
  state.response = { sites: [] }; await service.connectApiKey(input);
  state.response = sites;
  assert.deepEqual(await service.invoke({ ...input, operation: "sites.list", input: { limit: 1 } }), sites);
  state.response = { sites: [], metadata: { count: 0, cursors: {} } };
  assert.deepEqual(await service.invoke({ ...input, operation: "sites.list", input: { limit: 50, cursor: sites.metadata.cursors.next } }), state.response);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { cursorPaging: { limit: 50, cursor: "fixture +/cursor==" } } });
  assert.equal(requests.length, 3);
});

test("Wix rejects unknown or invalid inputs before network access and validates returned site/page fields", async (t) => {
  const { service, requests, state } = await fixture(t); await service.connectApiKey(input);
  const before = requests.length;
  for (const values of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: "" }, { cursor: "x\nheader" }, { cursor: "x".repeat(16001) },
    { accountId: siteId }, { url: "https://attacker.invalid" }, { query: { filter: {} } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "sites.list", input: values }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "sites.publish" }), { code: "connector_operation_unknown" });
  assert.equal(requests.length, before);
  for (const response of [{}, { sites: {} }, { sites: [{ id: 123 }] }, { sites: [{ _id: siteId }] }, { sites: [{ id: siteId, published: "yes" }] },
    { sites: [{ id: siteId, displayName: 3 }] }, { sites: [], metadata: { count: 1 } }, { sites: [], metadata: [] },
    { sites: [], metadata: { cursors: { next: 7 } } }, { sites: Array.from({ length: 101 }, () => ({ id: siteId })) }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "sites.list" }), { code: "connector_response_invalid" });
  }
});

test("Wix preserves owner isolation, host policy and account binding", async (t) => {
  const { service, options, configuration, requests, state } = await fixture(t); await service.connectApiKey(input);
  const before = requests.length;
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(service.invoke({ ...input, context: owner, operation: "sites.list" }), { code: "connector_reconnect_required" });
  }
  state.deny = true; await assert.rejects(service.invoke({ ...input, operation: "sites.list" })); state.deny = false;
  const changed = structuredClone(configuration); changed.integrations.wix.settings.accountId = siteId;
  const moved = createConnectionService({ ...options, configuration: changed });
  assert.equal((await moved.status(input)).status, "reconnect-required");
  await assert.rejects(moved.invoke({ ...input, operation: "sites.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, before);
});

test("Wix sanitizes provider failures, rejects invalid verification and preserves grants on cancellation", async (t) => {
  const { service, options, state } = await fixture(t);
  state.response = {};
  await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
  assert.equal((await service.status(input)).status, "disconnected");
  state.response = sites; await service.connectApiKey(input);
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { message: "private-provider-detail" };
    await assert.rejects(service.invoke({ ...input, operation: "sites.list" }), (error) => error.code === code && !error.message.includes("private-provider-detail"));
    assert.equal((await service.status(input)).status, "connected");
  }
  state.stall = true; const controller = new AbortController(); controller.abort();
  await assert.rejects(service.invoke({ ...input, operation: "sites.list", signal: controller.signal }), { code: "connector_cancelled" });
  const timed = createConnectionService({ ...options, providers: [{ ...provider, requestTimeoutMs: 20 }] });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timed.invoke({ ...input, operation: "sites.list" }), { code: "connector_provider_timeout" }); }
  finally { clearTimeout(keepAlive); }
  state.stall = false; state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "sites.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Wix's guide JSON validates without UI-specific transformations", async () => {
  const guide = await readFile(new URL("../docs/wix.md", import.meta.url), "utf8");
  const config = JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/u)[1]);
  assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }), config);
});


test("Wix CRM reads use the configured site, never both identity headers or caller overrides", async t => {
  const { service, state, requests } = await fixture(t, { siteId });
  await service.connectApiKey(input);
  assert.equal(requests[0].headers.get("wix-account-id"), accountId);
  assert.equal(requests[0].headers.has("wix-site-id"), false);
  state.response = { contacts: [{ id: accountId, info: { name: { first: "Fixture" } } }], pagingMetadata: { count: 1, offset: 20, total: 21 } };
  assert.deepEqual(await service.invoke({ ...input, operation: "contacts.list", input: { limit: 20, offset: 20, search: "Fixture" } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/contacts/v4/contacts/query");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { paging: { limit: 20, offset: 20 } }, search: "Fixture" });
  const before = requests.length;
  for (const args of [{ siteId: accountId }, { limit: 101 }, { offset: -1 }, { search: "x".repeat(101) }]) {
    await assert.rejects(service.invoke({ ...input, operation: "contacts.list", input: args }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.response = { contacts: [{ id: 3 }] };
  await assert.rejects(service.invoke({ ...input, operation: "contacts.list" }), { code: "connector_response_invalid" });
  const missing = await fixture(t); await missing.service.connectApiKey(input);
  const missingBefore = missing.requests.length;
  await assert.rejects(missing.service.invoke({ ...input, operation: "contacts.list" }), { code: "connector_input_invalid" });
  assert.equal(missing.requests.length, missingBefore);
});


test("Wix contact creation and revision updates preserve site ownership and deliberate writes", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const contact = { id: accountId, revision: 1, info: { name: { first: "Ada" }, emails: { items: [{ email: "ada@example.test" }] } } };
  state.response = { contact };
  await service.invoke({ ...input, operation: "contacts.create", input: { info: contact.info } });
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { info: contact.info, allowDuplicates: false });
  await service.invoke({ ...input, operation: "contacts.get", input: { contactId: accountId } });
  assert.equal(requests.at(-1).init.method, "GET");
  state.response = { contact: { ...contact, revision: 2 } };
  await service.invoke({ ...input, operation: "contacts.update", input: { contactId: accountId, revision: 1, info: { company: "Grooming" } } });
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { revision: 1, info: { company: "Grooming" }, allowDuplicates: false });
  const before = requests.length;
  for (const args of [{ contactId: accountId, info: { company: "X" } }, { contactId: "../other", revision: 1, info: { company: "X" } }, { contactId: accountId, revision: 1, info: {} }]) {
    await assert.rejects(service.invoke({ ...input, operation: "contacts.update", input: args }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "contacts.create", input: { info: { company: "X" } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.status = 409; state.response = { message: "private-conflict" };
  await assert.rejects(service.invoke({ ...input, operation: "contacts.update", input: { contactId: accountId, revision: 1, info: { company: "Y" } } }), error => !error.message.includes("private-conflict"));
  assert.equal(requests.length, before + 1);
  state.status = 200; state.response = { contact: { ...contact, id: siteId } };
  await assert.rejects(service.invoke({ ...input, operation: "contacts.get", input: { contactId: accountId } }), { code: "connector_response_invalid" });
});


test("Wix booking-service reads and edits retain exact revisions and the site boundary", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const record = { id: accountId, name: "Grooming", revision: "9007199254740993", type: "APPOINTMENT" };
  state.response = { services: [record], pagingMetadata: { count: 1, offset: 20, total: 21 } };
  await service.invoke({ ...input, operation: "bookingServices.list", input: { offset: 20, limit: 10 } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { paging: { offset: 20, limit: 10 } } });
  state.response = { service: record };
  await service.invoke({ ...input, operation: "bookingServices.get", input: { serviceId: accountId } });
  assert.equal(requests.at(-1).init.method, "GET");
  await service.invoke({ ...input, operation: "bookingServices.update", input: { serviceId: accountId, revision: record.revision, name: "Full grooming" } });
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { service: { id: accountId, revision: record.revision, name: "Full grooming" } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId); assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  const before = requests.length;
  for (const args of [{ serviceId: accountId, revision: 1, name: "X" }, { serviceId: accountId, revision: "1" }, { serviceId: "../bad", revision: "1", name: "X" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookingServices.update", input: args }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.response = { service: { ...record, id: siteId } };
  await assert.rejects(service.invoke({ ...input, operation: "bookingServices.get", input: { serviceId: accountId } }), { code: "connector_response_invalid" });
  state.status = 409; state.response = { message: "private-revision-conflict" };
  const conflict = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "bookingServices.update", input: { serviceId: accountId, revision: "1", description: "Change" } }), error => !error.message.includes("private-revision-conflict"));
  assert.equal(requests.length, conflict + 1);
});


test("Wix booking cancellation preserves policy, revisions and explicit charge decisions", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const args = { bookingId: accountId, revision: "9007199254740993" };
  state.response = { booking: { id: accountId, revision: "9007199254740994", status: "CANCELED" } };
  await service.invoke({ ...input, operation: "bookings.cancel", input: args });
  assert.equal(requests.at(-1).url.pathname, `/_api/bookings-service/v2/bookings/${accountId}/cancel`);
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { revision: args.revision, waiveCharges: false, participantNotification: { notifyParticipants: false } });
  await service.invoke({ ...input, operation: "bookings.cancel", input: { ...args, notifyParticipants: true, message: "Please rebook", waiveCharges: true } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { revision: args.revision, waiveCharges: true, participantNotification: { notifyParticipants: true, message: "Please rebook" } });
  const before = requests.length;
  for (const bad of [{ ...args, revision: 1 }, { ...args, revision: "9223372036854775808" }, { ...args, bookingId: "../other" }, { ...args, message: "Hidden" }, { ...args, flowControlSettings: { ignoreCancellationPolicy: true } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookings.cancel", input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.status = 409; state.response = { message: "private-conflict" };
  await assert.rejects(service.invoke({ ...input, operation: "bookings.cancel", input: args }), error => !error.message.includes("private-conflict"));
  assert.equal(requests.length, before + 1);
  state.status = 200;
  for (const booking of [{ id: siteId, revision: "2", status: "CANCELED" }, { id: accountId, revision: "2", status: "CONFIRMED" }]) {
    state.response = { booking };
    await assert.rejects(service.invoke({ ...input, operation: "bookings.cancel", input: args }), { code: "connector_response_invalid" });
  }
});


test("Wix booking queries expose current revisions and reject mismatched ID results", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const booking = { id: accountId, revision: "9007199254740993", status: "CONFIRMED" };
  state.response = { extendedBookings: [{ booking, allowedActions: { cancel: true, reschedule: false } }], pagingMetadata: { count: 1, offset: 20 } };
  await service.invoke({ ...input, operation: "bookings.list", input: { limit: 10, offset: 20 } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { paging: { limit: 10, offset: 20 } }, withBookingAllowedActions: true });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  await service.invoke({ ...input, operation: "bookings.list", input: { bookingId: accountId } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).query.filter, { id: accountId });
  state.response = { extendedBookings: [{ booking: { ...booking, id: siteId } }] };
  await assert.rejects(service.invoke({ ...input, operation: "bookings.list", input: { bookingId: accountId } }), { code: "connector_response_invalid" });
  state.response = { extendedBookings: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "bookings.list", input: { bookingId: accountId } }), state.response);
  state.response = { extendedBookings: [{ booking, allowedActions: { cancel: "yes" } }] };
  await assert.rejects(service.invoke({ ...input, operation: "bookings.list" }), { code: "connector_response_invalid" });
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "bookings.list", input: { bookingId: "bad" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
});


test("Wix appointment availability preserves local times, cursors and selected-slot identity", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const slot = { serviceId: accountId, localStartDate: "2026-10-01T10:00:00", localEndDate: "2026-10-01T11:00:00", bookable: true };
  const args = { serviceId: accountId, timeZone: "Australia/Perth", fromLocalDate: "2026-10-01T00:00:00", toLocalDate: "2026-10-02T00:00:00" };
  state.response = { timeSlots: [slot], timeZone: args.timeZone, cursorPagingMetadata: { cursors: { next: "next-page" } } };
  await service.invoke({ ...input, operation: "availability.list", input: args });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...args, bookable: true, cursorPaging: { limit: 100 } });
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  await service.invoke({ ...input, operation: "availability.list", input: { cursor: "next-page" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { cursorPaging: { limit: 100, cursor: "next-page" } });
  const selected = { serviceId: accountId, timeZone: args.timeZone, localStartDate: slot.localStartDate, localEndDate: slot.localEndDate };
  state.response = { timeSlot: { ...slot, bookable: false }, timeZone: args.timeZone };
  assert.equal((await service.invoke({ ...input, operation: "availability.get", input: selected })).timeSlot.bookable, false);
  assert.equal(requests.at(-1).url.pathname, "/_api/service-availability/v2/time-slots/get");
  state.response.timeSlot.serviceId = siteId;
  await assert.rejects(service.invoke({ ...input, operation: "availability.get", input: selected }), { code: "connector_response_invalid" });
  const before = requests.length;
  for (const bad of [{ ...args, fromLocalDate: "2026-02-30T00:00:00" }, { ...args, timeZone: "bad-zone" }, { ...args, cursor: "next" }, { ...args, toLocalDate: args.fromLocalDate }]) {
    await assert.rejects(service.invoke({ ...input, operation: "availability.list", input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
});


test("Wix creates appointment, class and course bookings without payment or policy overrides", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  state.response = { booking: { id: accountId, revision: "1", status: "CREATED" } };
  const common = { serviceId: accountId, timeZone: "Australia/Perth", formSubmission: { name: "Ada", email: "ada@example.test", custom: ["grooming"] } };
  const appointment = { ...common, kind: "APPOINTMENT", startDate: "2026-10-01T10:00:00", endDate: "2026-10-01T11:00:00", resourceId: siteId, location: { locationType: "OWNER_BUSINESS", id: accountId } };
  await service.invoke({ ...input, operation: "bookings.create", input: appointment });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { booking: { bookedEntity: { slot: { serviceId: accountId, timezone: common.timeZone, startDate: appointment.startDate, endDate: appointment.endDate, resource: { id: siteId }, location: appointment.location } }, totalParticipants: 1 }, formSubmission: common.formSubmission, participantNotification: { notifyParticipants: false }, sendSmsReminder: false });
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  await service.invoke({ ...input, operation: "bookings.create", input: { ...common, kind: "CLASS", eventId: siteId, totalParticipants: 2, notifyParticipants: true, sendSmsReminder: true } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).booking, { bookedEntity: { slot: { serviceId: accountId, timezone: common.timeZone, eventId: siteId } }, totalParticipants: 2 });
  await service.invoke({ ...input, operation: "bookings.create", input: { ...common, kind: "COURSE", scheduleId: siteId } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).booking.bookedEntity, { schedule: { serviceId: accountId, timezone: common.timeZone, scheduleId: siteId } });
  const before = requests.length;
  for (const bad of [{ ...appointment, eventId: siteId }, { ...appointment, resourceId: undefined }, { ...appointment, location: { locationType: "OWNER_BUSINESS" } }, { ...appointment, flowControlSettings: { skipAvailabilityValidation: true } }, { ...appointment, formSubmission: { invalid: Infinity } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookings.create", input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.status = 428; state.response = { message: "private-unavailable" };
  await assert.rejects(service.invoke({ ...input, operation: "bookings.create", input: appointment }), error => !error.message.includes("private-unavailable"));
  assert.equal(requests.length, before + 1);
});


test("Wix form summaries expose native booking targets on the configured site", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const formSummary = { id: accountId, fields: [{ id: siteId, target: "customer_name", label: "Name", type: "STRING", deleted: false, options: [] }] };
  state.response = { formSummary };
  assert.deepEqual(await service.invoke({ ...input, operation: "forms.summary", input: { formId: accountId } }), state.response);
  assert.equal(requests.at(-1).init.method, "GET");
  assert.equal(requests.at(-1).url.pathname, `/form-schema-service/v4/forms/${accountId}/summary`);
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  for (const bad of [{ ...formSummary, id: siteId }, { ...formSummary, fields: [{ id: siteId, target: 4, type: "STRING" }] }]) {
    state.response = { formSummary: bad };
    await assert.rejects(service.invoke({ ...input, operation: "forms.summary", input: { formId: accountId } }), { code: "connector_response_invalid" });
  }
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "forms.summary", input: { formId: "../other" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
});


test("Wix class availability uses event APIs and explicit party-size filtering", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const args = { serviceId: accountId, timeZone: "Australia/Perth", fromLocalDate: "2026-10-01T00:00:00", toLocalDate: "2026-10-02T00:00:00", minBookableCapacity: 2 };
  const slot = { serviceId: accountId, eventInfo: { eventId: siteId }, localStartDate: "2026-10-01T10:00:00", localEndDate: "2026-10-01T11:00:00", bookable: true };
  state.response = { timeSlots: [slot], timeZone: args.timeZone, pagingMetadata: { cursors: { next: "next" } } };
  await service.invoke({ ...input, operation: "classAvailability.list", input: args });
  assert.equal(requests.at(-1).url.pathname, "/_api/service-availability/v2/time-slots/event");
  const { serviceId, ...rest } = args;
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...rest, serviceIds: [serviceId], includeNonBookable: false, cursorPaging: { limit: 100 } });
  await service.invoke({ ...input, operation: "classAvailability.list", input: { cursor: "next" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { cursorPaging: { limit: 100, cursor: "next" } });
  state.response = { timeSlot: slot, timeZone: args.timeZone };
  await service.invoke({ ...input, operation: "classAvailability.get", input: { eventId: siteId, timeZone: args.timeZone } });
  assert.equal(requests.at(-1).init.method, "GET");
  assert.equal(requests.at(-1).url.searchParams.get("timeZone"), args.timeZone);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response.timeSlot = { ...slot, eventInfo: { eventId: accountId } };
  await assert.rejects(service.invoke({ ...input, operation: "classAvailability.get", input: { eventId: siteId, timeZone: args.timeZone } }), { code: "connector_response_invalid" });
});


test("Wix selected-resource availability sends native location and resource filters", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const slot = { serviceId: accountId, localStartDate: "2026-10-01T10:00:00", localEndDate: "2026-10-01T11:00:00", bookable: true };
  const location = { locationType: "BUSINESS", id: siteId };
  const selected = { serviceId: accountId, timeZone: "Australia/Perth", localStartDate: slot.localStartDate, localEndDate: slot.localEndDate, location, resourceTypes: [{ resourceTypeId: accountId, resourceIds: [siteId] }] };
  state.response = { timeSlot: slot, timeZone: selected.timeZone };
  await service.invoke({ ...input, operation: "availability.get", input: selected });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), selected);
  state.response = { timeSlots: [slot], timeZone: selected.timeZone };
  const list = { serviceId: accountId, timeZone: selected.timeZone, fromLocalDate: "2026-10-01T00:00:00", toLocalDate: "2026-10-02T00:00:00", locations: [location], includeResourceTypeIds: [accountId] };
  await service.invoke({ ...input, operation: "availability.list", input: list });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...list, bookable: true, cursorPaging: { limit: 100 } });
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "availability.get", input: { ...selected, location: { locationType: "BUSINESS" } } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "availability.get", input: { ...selected, resourceTypes: [{ resourceTypeId: accountId, resourceIds: ["bad"] }] } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
});


test("Wix order reads preserve native money, scoped filters and cursor pages", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const order = { id: accountId, status: "APPROVED", currency: "AUD", priceSummary: { total: { amount: "123456789.01" } }, lineItems: [] };
  state.response = { orders: [order], metadata: { count: 1, hasNext: true, cursors: { next: "orders-next" } } };
  const page = await service.invoke({ ...input, operation: "orders.list", input: { status: "PENDING", contactId: siteId } });
  assert.equal(page.orders[0].priceSummary.total.amount, "123456789.01");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { search: { cursorPaging: { limit: 20 }, filter: { status: "PENDING", "buyerInfo.contactId": siteId } } });
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  await service.invoke({ ...input, operation: "orders.list", input: { cursor: "orders-next" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { search: { cursorPaging: { limit: 20, cursor: "orders-next" } } });
  state.response = { order };
  await service.invoke({ ...input, operation: "orders.get", input: { orderId: accountId } });
  assert.equal(requests.at(-1).init.method, "GET");
  state.response = { order: { ...order, id: siteId } };
  await assert.rejects(service.invoke({ ...input, operation: "orders.get", input: { orderId: accountId } }), { code: "connector_response_invalid" });
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "orders.list", input: { cursor: "orders-next", status: "PENDING" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
});


test("Wix catalog discovery distinguishes native versions and missing Stores", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  for (const catalogVersion of ["V1_CATALOG", "V3_CATALOG", "STORES_NOT_INSTALLED"]) {
    state.response = { catalogVersion };
    assert.deepEqual(await service.invoke({ ...input, operation: "catalog.version" }), state.response);
  }
  assert.equal(requests.at(-1).url.pathname, "/stores/v3/provision/version");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response = { catalogVersion: "UNKNOWN" };
  await assert.rejects(service.invoke({ ...input, operation: "catalog.version" }), { code: "connector_response_invalid" });
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "catalog.version", input: { siteId: accountId } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
});


test("Wix product reads preserve each catalog version's endpoint, pagination and data", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const product = { id: accountId, name: "Shampoo", variantsInfo: { variants: [{ price: { actualPrice: { amount: "12.34" } } }] } };
  state.response = { products: [{ id: accountId, name: "Shampoo", priceData: { currency: "AUD", price: 12.34 } }], metadata: { items: 1, offset: 20 }, totalResults: 21 };
  await service.invoke({ ...input, operation: "productsV1.list", input: { offset: 20, includeVariants: true } });
  assert.equal(requests.at(-1).url.pathname, "/stores-reader/v1/products/query");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { paging: { limit: 20, offset: 20 } }, includeVariants: true });
  state.response = { products: [{ id: accountId, name: "Shampoo" }], pagingMetadata: { cursors: { next: "products-next" } } };
  const page = await service.invoke({ ...input, operation: "productsV3.list", input: { cursor: "products-next" } });
  assert.deepEqual(page.products[0], { id: accountId, name: "Shampoo" });
  assert.equal(requests.at(-1).url.pathname, "/stores/v3/products/query");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { cursorPaging: { limit: 20, cursor: "products-next" } } });
  state.response = { product };
  for (const version of [1, 3]) {
    await service.invoke({ ...input, operation: `productsV${version}.get`, input: { productId: accountId } });
    assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
    assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  }
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "productsV3.list", input: { offset: 20 } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "productsV1.list", input: { cursor: "next" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.response = { product: { ...product, id: siteId } };
  await assert.rejects(service.invoke({ ...input, operation: "productsV3.get", input: { productId: accountId } }), { code: "connector_response_invalid" });
});


test("Wix V3 product edits preserve omitted fields and reject stale or uncertain writes without retry", async (t) => {
  const { service, requests, state } = await fixture(t, { siteId });
  await service.connectApiKey(input);
  state.response = { product: { id: accountId, revision: "9007199254740994", name: "Renamed", visible: false } };
  const change = { productId: accountId, revision: "9007199254740993", name: "Renamed", visible: false };
  const result = await service.invoke({ ...input, operation: "productsV3.update", input: change });
  assert.equal(result.product.revision, "9007199254740994");
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.equal(requests.at(-1).url.pathname, `/stores/v3/products/${accountId}`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { product: { id: accountId, revision: change.revision, name: "Renamed", visible: false } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  const count = requests.length;
  for (const invalid of [{ productId: accountId, revision: "1" }, { ...change, revision: 1 }, { ...change, revision: "9223372036854775808" }, { ...change, name: "x".repeat(81) }, { ...change, variantsInfo: { variants: [] } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "productsV3.update", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 409; state.response = { message: "Revision conflict" };
  await assert.rejects(service.invoke({ ...input, operation: "productsV3.update", input: change }));
  assert.equal(requests.length, count + 1);
  state.status = 503; state.response = { message: "Unavailable" };
  await assert.rejects(service.invoke({ ...input, operation: "productsV3.update", input: change }));
  assert.equal(requests.length, count + 2);
  state.status = 200; state.response = { product: { id: siteId, name: "Wrong", revision: "2" } };
  await assert.rejects(service.invoke({ ...input, operation: "productsV3.update", input: change }), { code: "connector_response_invalid" });
});


test("Wix V1 updates use the write endpoint and retain zero price and false visibility", async t => {
  const { service, requests, state } = await fixture(t, { siteId }); await service.connectApiKey(input);
  state.response = { product: { id: accountId, name: "Free sample", visible: false, priceData: { price: 0 } } };
  await service.invoke({ ...input, operation: "productsV1.update", input: { productId: accountId, name: "Free sample", visible: false, price: 0 } });
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.equal(requests.at(-1).url.pathname, `/stores/v1/products/${accountId}`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { product: { name: "Free sample", visible: false, priceData: { price: 0 } } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  await service.invoke({ ...input, operation: "productsV1.update", input: { productId: accountId, visible: true } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { product: { visible: true } });
  const before = requests.length;
  for (const change of [{}, { price: -1 }, { price: Infinity }, { price: "12.50" }, { price: 1000000000 }, { revision: "1", name: "Rename" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "productsV1.update", input: { productId: accountId, ...change } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.response = { product: { id: siteId, name: "Wrong" } };
  await assert.rejects(service.invoke({ ...input, operation: "productsV1.update", input: { productId: accountId, visible: false } }), { code: "connector_response_invalid" });
  state.status = 503; state.response = { message: "Unavailable" };
  await assert.rejects(service.invoke({ ...input, operation: "productsV1.update", input: { productId: accountId, price: 12.5 } }));
  assert.equal(requests.length, before + 2);
});


test("Wix business locations preserve site identity, archived filtering and offset pages", async t => {
  const { service, requests, state } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const location = { id: accountId, name: "Studio", timeZone: "Australia/Perth", archived: false, address: { formattedAddress: "Fixture address" } };
  state.response = { locations: [location], pagingMetadata: { count: 1, offset: 20, total: 21 } };
  const page = await service.invoke({ ...input, operation: "locations.list", input: { limit: 20, offset: 20 } });
  assert.equal(page.locations[0].timeZone, "Australia/Perth");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { filter: { archived: false }, paging: { limit: 20, offset: 20 } }, filterAuthorizedLocationEntities: true });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response = { locations: [] };
  assert.deepEqual((await service.invoke({ ...input, operation: "locations.list", input: { archived: true } })).locations, []);
  state.response = { location };
  await service.invoke({ ...input, operation: "locations.get", input: { locationId: accountId } });
  assert.equal(requests.at(-1).url.pathname, `/locations/v1/locations/${accountId}`);
  state.response = { location: { ...location, id: siteId } };
  await assert.rejects(service.invoke({ ...input, operation: "locations.get", input: { locationId: accountId } }), { code: "connector_response_invalid" });
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "locations.list", input: { siteId } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
});


test("Wix CMS collection reads preserve app collection paths and field metadata", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const collection = { id: "AppName/CollectionName", displayName: "Editorial content", fields: [{ key: "title", type: "TEXT" }] };
  state.response = { collections: [collection], pagingMetadata: { count: 1, offset: 20 } };
  const page = await service.invoke({ ...input, operation: "cmsCollections.list", input: { offset: 20, consistentRead: true } });
  assert.deepEqual(page.collections[0].fields, collection.fields);
  assert.equal(requests.at(-1).url.searchParams.get("paging.offset"), "20");
  assert.equal(requests.at(-1).url.searchParams.get("consistentRead"), "true");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response = { collection };
  await service.invoke({ ...input, operation: "cmsCollections.get", input: { collectionId: collection.id } });
  assert.equal(requests.at(-1).url.pathname, "/wix-data/v2/collections/AppName/CollectionName");
  state.response = { collection: { id: "Wrong" } };
  await assert.rejects(service.invoke({ ...input, operation: "cmsCollections.get", input: { collectionId: collection.id } }), { code: "connector_response_invalid" });
  const count = requests.length;
  for (const id of ["", "../other", "App//Collection", "App/../Collection"]) await assert.rejects(service.invoke({ ...input, operation: "cmsCollections.get", input: { collectionId: id } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response = { collections: [] };
  assert.deepEqual((await service.invoke({ ...input, operation: "cmsCollections.list" })).collections, []);
});


test("Wix CMS item pages retain native content and reject cross-collection results", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  state.response = { dataItems: [{ id: "item-one", dataCollectionId: "Articles", data: { title: "Example", published: { $date: "2026-09-13T00:00:00.000Z" } } }], pagingMetadata: { count: 1, offset: 20 } };
  const result = await service.invoke({ ...input, operation: "cmsItems.list", input: { collectionId: "Articles", offset: 20, consistentRead: true } });
  assert.deepEqual(result.dataItems[0].data.published, { $date: "2026-09-13T00:00:00.000Z" });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { dataCollectionId: "Articles", consistentRead: true, query: { paging: { limit: 20, offset: 20 } } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response.dataItems[0].dataCollectionId = "PrivateRecords";
  await assert.rejects(service.invoke({ ...input, operation: "cmsItems.list", input: { collectionId: "Articles" } }), { code: "connector_response_invalid" });
  state.response = { dataItems: [] };
  assert.deepEqual((await service.invoke({ ...input, operation: "cmsItems.list", input: { collectionId: "Articles" } })).dataItems, []);
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "cmsItems.list", input: { collectionId: "Articles", siteId } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
});


test("Wix runtime site selection is bounded by project configuration and host authorization", async t => {
  const { service, state, requests, configuration } = await fixture(t, { siteId, selectableSiteIds: accountId });
  validateIntegrationConfiguration(configuration, { providers: [provider] });
  await service.connectApiKey(input);
  state.response = { collections: [] };
  await service.invoke({ ...input, operation: "cmsCollections.list", input: { siteId: accountId } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), accountId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  await service.invoke({ ...input, operation: "cmsCollections.list" });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "cmsCollections.list", input: { siteId } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "sites.list", input: { siteId: accountId } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.deny = true;
  await assert.rejects(service.invoke({ ...input, operation: "cmsCollections.list", input: { siteId: accountId } }));
  assert.equal(requests.length, before);
  for (const selectableSiteIds of ["", "bad-id", `${accountId},${accountId}`, `${accountId},`]) {
    const bad = structuredClone(configuration); bad.integrations.wix.settings.selectableSiteIds = selectableSiteIds;
    assert.throws(() => validateIntegrationConfiguration(bad, { providers: [provider] }));
  }
});


test("Wix CMS queries preserve native filters, projections and bounded reference expansion", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const query = { collectionId: "Articles", filter: { $and: [{ published: true }, { rating: { $gte: 0 } }] },
    sort: [{ fieldName: "title", order: "ASC" }], fields: ["title", "author"], returnTotalCount: true,
    includeReferences: [{ field: "author", limit: 1 }], limit: 10, offset: 10 };
  const author = { _id: "author-one", name: "Example author" };
  state.response = { dataItems: [{ id: "article-one", dataCollectionId: "Articles", data: { title: "Example", author } }],
    pagingMetadata: { count: 1, offset: 10, total: 11, tooManyToCount: false } };
  const result = await service.invoke({ ...input, operation: "cmsItems.list", input: query });
  assert.deepEqual(result.dataItems[0].data.author, author);
  assert.equal(result.pagingMetadata.total, 11);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { dataCollectionId: "Articles", consistentRead: false,
    returnTotalCount: true, includeReferences: query.includeReferences,
    query: { paging: { limit: 10, offset: 10 }, filter: query.filter, sort: query.sort, fields: query.fields } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  const count = requests.length;
  for (const invalid of [{ filter: [] }, { filter: { value: Infinity } }, { filter: { value: "x".repeat(100001) } },
    { sort: [{ fieldName: "title", order: "DOWN" }] }, { fields: [""] },
    { includeReferences: [{ field: "author", limit: 1001 }] }, { includeReferencedItems: ["author"] }]) {
    await assert.rejects(service.invoke({ ...input, operation: "cmsItems.list", input: { collectionId: "Articles", ...invalid } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response = { dataItems: [], pagingMetadata: { count: 0, tooManyToCount: true } };
  const empty = await service.invoke({ ...input, operation: "cmsItems.list", input: { collectionId: "Articles", filter: {}, returnTotalCount: false } });
  assert.equal(empty.pagingMetadata.total, undefined);
  assert.equal(JSON.parse(requests.at(-1).init.body).returnTotalCount, false);
});


test("Wix CMS item reads and conditional patches retain item identity and never replay writes", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const dataItem = { id: "article-one", dataCollectionId: "Articles", data: { title: "Revised", enabled: false, count: 0, untouched: "kept" } };
  state.response = { dataItem };
  await service.invoke({ ...input, operation: "cmsItems.get", input: { collectionId: "Articles", itemId: dataItem.id, consistentRead: true } });
  assert.equal(requests.at(-1).url.searchParams.get("dataCollectionId"), "Articles");
  assert.equal(requests.at(-1).url.searchParams.get("consistentRead"), "true");
  const fieldModifications = [
    { fieldPath: "title", action: "SET_FIELD", setFieldOptions: { value: "Revised" } },
    { fieldPath: "enabled", action: "SET_FIELD", setFieldOptions: { value: false } },
    { fieldPath: "count", action: "INCREMENT_FIELD", incrementFieldOptions: { value: 0 } },
    { fieldPath: "optional", action: "SET_FIELD", setFieldOptions: { value: null } },
    { fieldPath: "old", action: "REMOVE_FIELD" },
    { fieldPath: "tags", action: "APPEND_TO_ARRAY", appendToArrayOptions: { value: "new" } },
    { fieldPath: "tags", action: "REMOVE_FROM_ARRAY", removeFromArrayOptions: { value: "old" } }
  ];
  const patch = { collectionId: "Articles", itemId: dataItem.id, fieldModifications, conditionFilter: { title: "Original" } };
  const result = await service.invoke({ ...input, operation: "cmsItems.patch", input: patch });
  assert.equal(result.dataItem.data.untouched, "kept");
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { dataCollectionId: "Articles", patch: { dataItemId: dataItem.id, fieldModifications }, condition: { filter: { title: "Original" } } });
  let count = requests.length;
  for (const fieldModifications of [[], [{ fieldPath: "title", action: "SET_FIELD" }],
    [{ fieldPath: "title", action: "REMOVE_FIELD", setFieldOptions: { value: "wrong" } }],
    [{ fieldPath: "count", action: "INCREMENT_FIELD", incrementFieldOptions: { value: "1" } }],
    [{ fieldPath: "title", action: "SET_FIELD", setFieldOptions: { value: Infinity } }]]) {
    await assert.rejects(service.invoke({ ...input, operation: "cmsItems.patch", input: { ...patch, fieldModifications } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  for (const status of [409, 503]) {
    state.status = status; state.response = { message: "private-provider-error" }; count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "cmsItems.patch", input: patch }));
    assert.equal(requests.length, count + 1);
  }
  state.status = 200;
  for (const different of [{ ...dataItem, id: "other" }, { ...dataItem, dataCollectionId: "Private" }]) {
    state.response = { dataItem: different };
    await assert.rejects(service.invoke({ ...input, operation: "cmsItems.get", input: { collectionId: "Articles", itemId: dataItem.id } }), { code: "connector_response_invalid" });
    await assert.rejects(service.invoke({ ...input, operation: "cmsItems.patch", input: patch }), { code: "connector_response_invalid" });
  }
  state.deny = true; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "cmsItems.patch", input: patch }));
  assert.equal(requests.length, count);
});


test("Wix location writes use native bodies, exact revisions and site-scoped single attempts", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const values = { name: "Perth studio", timeZone: "Australia/Perth", description: "Appointments", phone: "+61855550100",
    businessSchedule: { periods: [], specialHourPeriod: [] }, extendedFields: { namespaces: { custom: { retained: true } } }, locationTypes: ["BRANCH"], status: "ACTIVE",
    address: { country: "AU", city: "Perth", postalCode: "6000", geocode: { latitude: -31.95, longitude: 115.86 } } };
  const location = { id: accountId, ...values, revision: "9007199254740993", archived: false };
  state.response = { location };
  await service.invoke({ ...input, operation: "locations.create", input: values });
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/locations/v1/locations");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { location: values });
  const update = { ...values, locationId: accountId, revision: location.revision, description: "" };
  await service.invoke({ ...input, operation: "locations.update", input: update });
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { location: { ...values, id: accountId, revision: location.revision, description: "" } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  let count = requests.length;
  for (const bad of [{ revision: 7 }, { address: {} }, { timeZone: "bad-zone" },
    { address: { geocode: { latitude: 91, longitude: 0 } } }, { archived: true }]) {
    await assert.rejects(service.invoke({ ...input, operation: "locations.update", input: { ...update, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 409; state.response = { message: "private-revision-conflict" };
  await assert.rejects(service.invoke({ ...input, operation: "locations.update", input: update }));
  assert.equal(requests.length, count + 1);
  state.status = 503; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "locations.create", input: values }));
  assert.equal(requests.length, count + 1);
  state.status = 200; state.response = { location: { ...location, id: siteId } };
  await assert.rejects(service.invoke({ ...input, operation: "locations.update", input: update }), { code: "connector_response_invalid" });
});


test("Wix archive and default actions require explicit IDs and validate identity and resulting state", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  for (const [operation, suffix, flag] of [["locations.archive", "archive", "archived"], ["locations.setDefault", "set-default", "default"]]) {
    state.response = { location: { id: accountId, name: "Studio", [flag]: true } };
    await service.invoke({ ...input, operation, input: { locationId: accountId } });
    assert.equal(requests.at(-1).url.pathname, `/locations/v1/locations/${accountId}/${suffix}`);
    assert.equal(requests.at(-1).init.method, "POST");
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), {});
    assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
    state.response.location[flag] = false;
    await assert.rejects(service.invoke({ ...input, operation, input: { locationId: accountId } }), { code: "connector_response_invalid" });
    state.response.location[flag] = true; state.response.location.id = siteId;
    await assert.rejects(service.invoke({ ...input, operation, input: { locationId: accountId } }), { code: "connector_response_invalid" });
  }
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "locations.archive", input: { locationId: "bad" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.status = 400; state.response = { message: "Cannot archive default location" };
  await assert.rejects(service.invoke({ ...input, operation: "locations.archive", input: { locationId: accountId } }));
  assert.equal(requests.length, count + 1);
  state.deny = true; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "locations.setDefault", input: { locationId: accountId } }));
  assert.equal(requests.length, count);
});


test("Wix creates services with explicit payment and appointment prerequisites", async t => {
  const { service: connection, state, requests } = await fixture(t, { siteId }); await connection.connectApiKey(input);
  const service = { type: "APPOINTMENT", name: "Consultation", defaultCapacity: 1,
    onlineBooking: { enabled: true, requireManualApproval: false, allowMultipleRequests: false },
    payment: { rateType: "FIXED", fixed: { price: { value: "50.25", currency: "AUD" } }, options: { inPerson: true, online: false } },
    staffMemberIds: [accountId], schedule: { availabilityConstraints: { sessionDurations: [30] } }, category: { id: accountId } };
  state.response = { service: { ...service, id: accountId, revision: "1" } };
  await connection.invoke({ ...input, operation: "bookingServices.create", input: { service } });
  assert.equal(requests.at(-1).url.pathname, "/_api/bookings/v2/services");
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { service });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  for (const type of ["CLASS", "COURSE"]) {
    const group = { type, name: "Workshop", defaultCapacity: 12, onlineBooking: { enabled: false }, payment: { rateType: "NO_FEE", options: { inPerson: true } } };
    state.response = { service: { ...group, id: accountId, revision: "1" } };
    await connection.invoke({ ...input, operation: "bookingServices.create", input: { service: group } });
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { service: group });
  }
  let count = requests.length;
  for (const changed of [{ defaultCapacity: 2 }, { staffMemberIds: [] }, { schedule: {} }, { id: accountId },
    { payment: { rateType: "NO_FEE", options: {} } },
    { payment: { rateType: "NO_FEE", options: { online: true } } },
    { payment: { rateType: "FIXED", fixed: { price: { value: 50.25, currency: "AUD" } }, options: { inPerson: true } } },
    { onlineBooking: { enabled: true, requireManualApproval: true }, payment: { ...service.payment, options: { inPerson: true, pricingPlan: true } } }]) {
    await assert.rejects(connection.invoke({ ...input, operation: "bookingServices.create", input: { service: { ...service, ...changed } } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 503; state.response = { message: "uncertain-create" };
  await assert.rejects(connection.invoke({ ...input, operation: "bookingServices.create", input: { service } }));
  assert.equal(requests.length, count + 1);
  state.deny = true; count = requests.length;
  await assert.rejects(connection.invoke({ ...input, operation: "bookingServices.create", input: { service } }));
  assert.equal(requests.length, count);
});


test("Wix booking setup discovers categories and staff resource IDs with native cursor pages", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  state.response = { categories: [{ id: accountId, name: "Consultations" }], pagingMetadata: { hasNext: true, cursors: { next: "category-next" } } };
  await service.invoke({ ...input, operation: "bookingCategories.list", input: { cursor: "category-next", limit: 5 } });
  assert.equal(requests.at(-1).url.pathname, "/bookings/v2/categories/query");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { cursorPaging: { cursor: "category-next", limit: 5 }, sort: [{ fieldName: "id", order: "ASC" }] } });
  const member = { id: accountId, name: "Provider", resourceId: siteId, resource: { eventsSchedule: { id: accountId } } };
  state.response = { staffMembers: [member], pagingMetadata: { hasNext: false, cursors: {} } };
  const result = await service.invoke({ ...input, operation: "bookingStaff.list" });
  assert.equal(result.staffMembers[0].resourceId, siteId);
  assert.deepEqual(result.staffMembers[0].resource, member.resource);
  assert.equal(requests.at(-1).url.pathname, "/bookings/v1/staff-members/query");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: { cursorPaging: { limit: 20 }, sort: [{ fieldName: "id", order: "ASC" }], filter: { serviceProvider: true } }, fields: ["RESOURCE_DETAILS"] });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  delete state.response.staffMembers[0].resourceId;
  await assert.rejects(service.invoke({ ...input, operation: "bookingStaff.list" }), { code: "connector_response_invalid" });
  state.response = { staffMembers: [], pagingMetadata: { hasNext: false } };
  assert.deepEqual((await service.invoke({ ...input, operation: "bookingStaff.list" })).staffMembers, []);
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "bookingStaff.list", input: { filter: { serviceProvider: false } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
});


test("Wix service configuration updates preserve payment strings, false settings and exact revisions", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const changes = { serviceId: accountId, revision: "9007199254740993",
    payment: { rateType: "FIXED", fixed: { price: { value: "75.10", currency: "AUD" } }, options: { inPerson: true, online: false } },
    onlineBooking: { enabled: true, requireManualApproval: false, allowMultipleRequests: false }, defaultCapacity: 1,
    staffMemberIds: [siteId], schedule: { availabilityConstraints: { sessionDurations: [45], timeBetweenSessions: 0 } } };
  state.response = { service: { id: accountId, name: "Consultation", type: "APPOINTMENT", revision: "9007199254740994" } };
  await service.invoke({ ...input, operation: "bookingServices.update", input: changes });
  const { serviceId, ...settings } = changes;
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { service: { id: serviceId, ...settings } });
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  let count = requests.length;
  for (const bad of [{ payment: {} }, { onlineBooking: {} }, { schedule: { availabilityConstraints: {} } },
    { staffMemberIds: ["bad-id"] }, { payment: { invalid: Infinity } }, { locations: [] }, { addOnGroups: [] }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookingServices.update", input: { serviceId: accountId, revision: "2", ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 409; state.response = { message: "Stale revision" };
  await assert.rejects(service.invoke({ ...input, operation: "bookingServices.update", input: changes }));
  assert.equal(requests.length, count + 1);
});


test("Wix service locations require an explicit session decision and opt-in notifications", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const location = { type: "BUSINESS", business: { id: siteId } };
  const values = { serviceId: accountId, locations: [location], removedLocationAction: "KEEP_AT_CURRENT_LOCATION" };
  state.response = { service: { id: accountId, type: "CLASS", name: "Class", revision: "2", locations: [location] } };
  await service.invoke({ ...input, operation: "bookingServices.setLocations", input: values });
  assert.equal(requests.at(-1).url.pathname, `/_api/bookings/v2/services/${accountId}/locations`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { locations: [location], removedLocationSessionsAction: { action: "KEEP_AT_CURRENT_LOCATION" }, participantNotification: { notifyParticipants: false } });
  const destination = { type: "CUSTOM", custom: { address: { country: "AU", city: "Perth", formattedAddress: "Fixture address" } } };
  await service.invoke({ ...input, operation: "bookingServices.setLocations", input: { ...values, removedLocationAction: "MOVE_TO_LOCATION", moveToLocation: destination, notifyParticipants: true, notificationMessage: "New venue" } });
  const body = JSON.parse(requests.at(-1).init.body);
  assert.deepEqual(body.removedLocationSessionsAction, { action: "MOVE_TO_LOCATION", moveToLocationOptions: { newLocation: destination } });
  assert.deepEqual(body.participantNotification, { notifyParticipants: true, message: "New venue" });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  let count = requests.length;
  for (const bad of [{ removedLocationAction: undefined }, { removedLocationAction: "MOVE_TO_LOCATION" },
    { moveToLocation: destination }, { notificationMessage: "Do not send implicitly" },
    { locations: [{ type: "BUSINESS" }] }, { locations: [{ type: "CUSTOM", custom: { address: {} } }] }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookingServices.setLocations", input: { ...values, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response.service.id = siteId;
  await assert.rejects(service.invoke({ ...input, operation: "bookingServices.setLocations", input: values }), { code: "connector_response_invalid" });
  state.status = 503; state.response = { message: "Uncertain location change" }; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "bookingServices.setLocations", input: values }));
  assert.equal(requests.length, count + 1);
});

test("Wix forwards duration and add-on availability choices and mutually exclusive booking participants", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const slot = { serviceId: accountId, localStartDate: "2026-10-01T10:00:00", localEndDate: "2026-10-01T11:30:00", bookable: true };
  const args = { serviceId: accountId, timeZone: "Australia/Perth", fromLocalDate: "2026-10-01T00:00:00", toLocalDate: "2026-10-02T00:00:00" };
  const customerChoices = { durationInMinutes: 90, addOnIds: [siteId] };
  state.response = { timeSlots: [slot], timeZone: args.timeZone };
  await service.invoke({ ...input, operation: "availability.list", input: { ...args, customerChoices } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).customerChoices, customerChoices);
  state.response = { timeSlot: slot, timeZone: args.timeZone };
  await service.invoke({ ...input, operation: "availability.get", input: { serviceId: accountId, timeZone: args.timeZone,
    localStartDate: slot.localStartDate, localEndDate: slot.localEndDate, customerChoices: { addOnIds: [siteId] } } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).customerChoices, { addOnIds: [siteId] });
  let count = requests.length;
  for (const bad of [{}, { durationInMinutes: 0 }, { durationInMinutes: 57601 }, { addOnIds: [siteId, siteId] }, { addOnIds: ["bad"] }]) {
    await assert.rejects(service.invoke({ ...input, operation: "availability.list", input: { ...args, customerChoices: bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  const participantsChoices = { serviceChoices: [
    { numberOfParticipants: 2, choices: [{ optionId: siteId, custom: "Child" }] },
    { numberOfParticipants: 1, choices: [{ optionId: siteId, custom: "Adult" }] }
  ] };
  const booking = { serviceId: accountId, kind: "CLASS", eventId: siteId, timeZone: args.timeZone, formSubmission: { name: "Ada" },
    participantsChoices, bookedAddOns: [{ id: siteId, groupId: accountId, quantity: 2 }] };
  state.response = { booking: { id: accountId, revision: "1", status: "CREATED" } };
  await service.invoke({ ...input, operation: "bookings.create", input: booking });
  const sent = JSON.parse(requests.at(-1).init.body);
  assert.deepEqual(sent.booking.participantsChoices, participantsChoices);
  assert.deepEqual(sent.booking.bookedAddOns, booking.bookedAddOns);
  assert.equal(Object.hasOwn(sent.booking, "totalParticipants"), false);
  assert.deepEqual(sent.participantNotification, { notifyParticipants: false });
  const duration = { serviceChoices: [{ numberOfParticipants: 1, choices: [{ optionId: siteId, duration: { minutes: 90 } }] }] };
  await service.invoke({ ...input, operation: "bookings.create", input: { ...booking, participantsChoices: duration, bookedAddOns: [{ id: siteId }] } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).booking.participantsChoices, duration);
  count = requests.length;
  for (const bad of [{ totalParticipants: 3 }, { participantsChoices: { serviceChoices: [] } }, { bookedAddOns: [null] },
    { bookedAddOns: [{ id: siteId, quantity: 0 }] }, { bookedAddOns: [{ id: siteId }, { id: siteId }] },
    { participantsChoices: { serviceChoices: [{ numberOfParticipants: 1, choices: [{ optionId: siteId }] }] } },
    { participantsChoices: { serviceChoices: [{ numberOfParticipants: 1, choices: [{ optionId: siteId, custom: "Child", duration: { minutes: 90 } }] }] } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookings.create", input: { ...booking, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.status = 400; state.response = { message: "Invalid service choice" };
  await assert.rejects(service.invoke({ ...input, operation: "bookings.create", input: booking }));
  assert.equal(requests.length, count + 1);
});

test("Wix add-on discovery preserves group prompts, order and selection limits", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const groups = [{ groupId: accountId, groupName: "Extras", prompt: "Choose one", maxNumberOfAddOns: 1,
    addOns: [{ addOnId: siteId, name: "Extra time", durationInMinutes: 30, price: { value: "12.50", currency: "AUD" } }] }];
  state.response = { addOnGroupsDetails: groups };
  const call = { ...input, operation: "bookingServices.listAddOnGroups", input: { serviceId: accountId } };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).url.pathname, "/_api/bookings/v2/services/add-on-groups/list-add-on-groups-by-service-id");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { serviceId: accountId });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  state.response = { addOnGroupsDetails: [] };
  assert.deepEqual((await service.invoke(call)).addOnGroupsDetails, []);
  state.response = { addOnGroupsDetails: [{ ...groups[0], addOns: [null] }] };
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  const before = requests.length;
  await assert.rejects(service.invoke({ ...call, input: { serviceId: "bad" } }), { code: "connector_input_invalid" });
  state.deny = true;
  await assert.rejects(service.invoke(call), /Host denied/);
  assert.equal(requests.length, before);
});

test("Wix custom-checkout confirmation distinguishes automatic checks from explicit decisions", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const decision = { bookingId: accountId, revision: "9007199254740993" };
  state.response = { booking: { id: accountId, revision: "9007199254740994", status: "CONFIRMED" } };
  await service.invoke({ ...input, operation: "bookings.confirm", input: decision });
  assert.equal(requests.at(-1).url.pathname, `/_api/bookings-service/v2/bookings/${accountId}/confirm`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { revision: decision.revision, participantNotification: { notifyParticipants: false } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  state.response.booking.status = "DECLINED";
  await service.invoke({ ...input, operation: "bookings.decline", input: { ...decision, notifyParticipants: true, message: "Please choose another time." } });
  assert.equal(requests.at(-1).url.pathname, `/_api/bookings-service/v2/bookings/${accountId}/decline`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).participantNotification, { notifyParticipants: true, message: "Please choose another time." });
  const automatic = { bookingId: accountId, paymentStatus: "EXEMPT" };
  for (const status of ["CONFIRMED", "PENDING", "DECLINED"]) {
    state.response.booking.status = status;
    assert.equal((await service.invoke({ ...input, operation: "bookings.confirmOrDecline", input: automatic })).booking.status, status);
    assert.equal(requests.at(-1).url.pathname, `/bookings/v2/confirmation/${accountId}:confirmOrDecline`);
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { paymentStatus: "EXEMPT" });
  }
  let count = requests.length;
  for (const bad of [{ revision: 5 }, { revision: "9223372036854775808" }, { message: "Do not send implicitly" }, { paymentStatus: "PAID" }, { skipAvailabilityValidation: true }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookings.confirm", input: { ...decision, ...bad } }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "bookings.confirmOrDecline", input: { bookingId: accountId } }), { code: "connector_input_invalid" });
  state.deny = true;
  await assert.rejects(service.invoke({ ...input, operation: "bookings.confirm", input: decision }), /Host denied/);
  assert.equal(requests.length, count);
  state.deny = false; state.response.booking.id = siteId;
  await assert.rejects(service.invoke({ ...input, operation: "bookings.decline", input: decision }), { code: "connector_response_invalid" });
  state.response.booking.id = accountId; state.response.booking.status = "CREATED";
  await assert.rejects(service.invoke({ ...input, operation: "bookings.confirmOrDecline", input: automatic }), { code: "connector_response_invalid" });
  state.status = 428; state.response = { message: "Booking cannot be confirmed" }; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "bookings.confirm", input: decision }));
  assert.equal(requests.length, count + 1);
});

test("Wix rescheduling preserves selected appointment slots or class events without policy overrides", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  state.response = { booking: { id: accountId, revision: "9007199254740994", status: "PENDING" } };
  const slot = { serviceId: accountId, scheduleId: siteId, startDate: "2026-10-01T10:00:00", endDate: "2026-10-01T11:00:00",
    timezone: "Australia/Perth", resource: { id: siteId }, location: { locationType: "OWNER_BUSINESS", id: accountId } };
  const args = { bookingId: accountId, revision: "9007199254740993", slot };
  await service.invoke({ ...input, operation: "bookings.reschedule", input: args });
  assert.equal(requests.at(-1).url.pathname, `/_api/bookings-service/v2/bookings/${accountId}/reschedule`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { revision: args.revision, slot, participantNotification: { notifyParticipants: false } });
  await service.invoke({ ...input, operation: "bookings.reschedule", input: { ...args, slot: { eventId: siteId }, notifyParticipants: true, message: "New class time" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { revision: args.revision, slot: { eventId: siteId }, participantNotification: { notifyParticipants: true, message: "New class time" } });
  let count = requests.length;
  for (const bad of [{ slot: {} }, { slot: { eventId: siteId, serviceId: accountId } }, { slot: { ...slot, timezone: "bad" } },
    { slot: { ...slot, endDate: slot.startDate } }, { message: "No implicit notification" }, { flowControlSettings: { ignoreReschedulePolicy: true } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bookings.reschedule", input: { ...args, ...bad } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response.booking.id = siteId;
  await assert.rejects(service.invoke({ ...input, operation: "bookings.reschedule", input: args }), { code: "connector_response_invalid" });
  state.status = 428; state.response = { message: "Slot not available" }; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "bookings.reschedule", input: args }));
  assert.equal(requests.length, count + 1);
});

test("Wix Cart V2 creates catalogue carts and returns HTTPS hosted checkout without collecting payment", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const catalogItems = [{ quantity: 1, catalogReference: { appId: "13d21c63-b5ec-5912-8397-c3a5ddb27a97", catalogItemId: accountId,
    options: { customText: "Fixture booking", enabled: false } } }];
  state.response = { cart: { id: accountId, revision: "1", lineItems: [{ id: siteId, pricing: { totalPrice: { amount: "30.10" } } }] } };
  assert.deepEqual(await service.invoke({ ...input, operation: "carts.create", input: { catalogItems, note: "" } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/ecom/v2/carts");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { cart: { source: { channelType: "WEB" }, note: "" }, catalogItems });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response = { checkoutUrl: `https://shop.example.test/checkout?checkoutId=${accountId}` };
  const urlCall = { ...input, operation: "carts.getCheckoutUrl", input: { cartId: accountId } };
  assert.equal((await service.invoke(urlCall)).checkoutUrl, state.response.checkoutUrl);
  assert.equal(requests.at(-1).url.pathname, `/ecom/v2/carts/${accountId}/get-checkout-url`);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), {});
  let count = requests.length;
  for (const bad of [{ catalogItems: [] }, { catalogItems: [{ ...catalogItems[0], quantity: 0 }] },
    { catalogItems: [{ quantity: 1, catalogReference: { appId: "bad", catalogItemId: accountId } }] },
    { catalogItems, customItems: [{ price: "0" }] }, { catalogItems, paymentStatus: "PAID" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "carts.create", input: bad }), { code: "connector_input_invalid" });
  }
  state.deny = true;
  await assert.rejects(service.invoke(urlCall), /Host denied/);
  assert.equal(requests.length, count);
  state.deny = false;
  for (const checkoutUrl of ["http://shop.example.test", "javascript:alert(1)", "https://secret@shop.example.test", null]) {
    state.response = { checkoutUrl };
    await assert.rejects(service.invoke(urlCall), { code: "connector_response_invalid" });
  }
  state.status = 428; state.response = { message: "Insufficient inventory" }; count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "carts.create", input: { catalogItems } }));
  assert.equal(requests.length, count + 1);
});


test("Wix reads order fulfillments without mixing order identities or losing native tracking details", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const fulfillment = { id: siteId, lineItems: [{ id: accountId, quantity: 2 }], status: "In_Delivery", completed: false,
    trackingInfo: { trackingNumber: "fixture-123", shippingProvider: "ups", trackingLink: "https://tracking.example.test/fixture-123" } };
  state.response = { orderWithFulfillments: { orderId: accountId, fulfillments: [fulfillment] } };
  const call = { ...input, operation: "orderFulfillments.list", input: { orderId: accountId } };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).url.pathname, `/ecom/v1/fulfillments/orders/${accountId}`);
  assert.equal(requests.at(-1).init.method, "GET");
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  state.response.orderWithFulfillments.fulfillments = [];
  assert.deepEqual((await service.invoke(call)).orderWithFulfillments.fulfillments, []);
  state.response.orderWithFulfillments.orderId = siteId;
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  state.response.orderWithFulfillments.orderId = accountId;
  for (const malformed of [null, { ...fulfillment, lineItems: [null] }, { ...fulfillment, lineItems: [{ id: accountId, quantity: -1 }] }]) {
    state.response.orderWithFulfillments.fulfillments = [malformed];
    await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  }
  let count = requests.length;
  await assert.rejects(service.invoke({ ...call, input: { orderId: ".." } }), { code: "connector_input_invalid" });
  state.deny = true;
  await assert.rejects(service.invoke(call), /Host denied/);
  assert.equal(requests.length, count);
  state.deny = false; state.status = 404; state.response = { message: "Order not found" };
  await assert.rejects(service.invoke(call));
  assert.equal(requests.length, count + 1);
});


test("Wix fulfillment writes preserve explicit quantities and partial tracking updates without replay", async t => {
  const { service, state, requests } = await fixture(t, { siteId }); await service.connectApiKey(input);
  const lineItems = [{ id: accountId, quantity: 2 }];
  state.response = { fulfillmentId: siteId, orderWithFulfillments: { orderId: accountId, fulfillments: [{ id: siteId, lineItems }] } };
  const args = { orderId: accountId, lineItems, trackingInfo: { trackingNumber: "fixture-123", shippingProvider: "ups" } };
  const call = { ...input, operation: "orderFulfillments.create", input: args };
  assert.deepEqual(await service.invoke(call), state.response);
  assert.equal(requests.at(-1).url.pathname, `/ecom/v1/fulfillments/orders/${accountId}/create-fulfillment`);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { fulfillment: { lineItems, trackingInfo: args.trackingInfo } });
  assert.equal(requests.at(-1).headers.get("wix-site-id"), siteId);
  assert.equal(requests.at(-1).headers.has("wix-account-id"), false);
  const update = { ...input, operation: "orderFulfillments.update", input: { orderId: accountId, fulfillmentId: siteId,
    trackingInfo: { trackingNumber: "updated" }, completed: false, status: "Ready" } };
  await service.invoke(update);
  assert.equal(requests.at(-1).url.pathname, `/ecom/v1/fulfillments/${siteId}/orders/${accountId}`);
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { fulfillment: { trackingInfo: { trackingNumber: "updated" }, completed: false, status: "Ready" } });
  let count = requests.length;
  for (const bad of [{ lineItems: [] }, { lineItems: [{ id: accountId }] }, { lineItems: [...lineItems, ...lineItems] },
    { trackingInfo: { trackingNumber: "x", shippingProvider: "Custom" } }, { trackingInfo: {} }, { fulfillmentId: siteId }, { status: "SHIPPED" }]) {
    await assert.rejects(service.invoke({ ...call, input: { ...args, ...bad } }), { code: "connector_input_invalid" });
  }
  state.deny = true;
  await assert.rejects(service.invoke(call), /Host denied/);
  assert.equal(requests.length, count);
  state.deny = false; state.response.orderWithFulfillments.orderId = siteId;
  await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  state.response.orderWithFulfillments.orderId = accountId;
  state.response.orderWithFulfillments.fulfillments = [{ id: accountId, lineItems }];
  await assert.rejects(service.invoke(update), { code: "connector_response_invalid" });
  state.response.orderWithFulfillments.fulfillments = [{ id: siteId, lineItems: [{ id: accountId, quantity: 0 }] }];
  await assert.rejects(service.invoke(update), { code: "connector_response_invalid" });
  state.status = 409; state.response = { message: "Tracking number exists" }; count = requests.length;
  await assert.rejects(service.invoke(call));
  assert.equal(requests.length, count + 1);
});
