import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { brevoProvider } from "../src/server/brevo.js";

test("Brevo explicitly sends messages and campaigns, manages contacts and retains DNS and delivery state", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "brevo-repair-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = []; const state = { response: { contacts: [], count: 0 }, status: 200, deny: false, fail: false };
  const identity = { context: { applicationId: "booking-app", subjectId: "owner" }, integrationId: "messaging" };
  const service = createConnectionService({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    messaging: { provider: "brevo", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:BREVO_API_KEY" } }
  } }, providers: [brevoProvider], authorize: async context => { if (state.deny) throw new Error("denied"); return context; },
    resolveReference: async () => "brevo-fixture-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => { requests.push({ url: new URL(url), init }); if (state.fail) throw new Error("uncertain send");
      return state.response === null ? new Response(null, { status: 204 }) : Response.json(state.response, { status: state.status }); }
  });
  const invoke = (operation, input = {}) => service.invoke({ ...identity, operation, input }); await service.connectApiKey(identity);
  const sender = { email: "bookings@example.test", name: "Dog and Groom" };
  const email = { sender, to: [{ email: "customer@example.test" }], subject: "Booking confirmed", textContent: "Tuesday at 10" };
  const dns = { brevo_code: { host_name: "example.test", type: "TXT", value: "brevo-code:fixture", status: false },
    dkim_record: { host_name: "mail._domainkey.example.test", type: "TXT", value: "fixture-dkim", status: false } };
  for (const [operation, method, endpoint, input, response] of [
    ["email.send", "POST", "smtp/email", email, { messageId: "<accepted-1>" }],
    ["email.send", "POST", "smtp/email", { sender, to: email.to, templateId: 2, params: { APPOINTMENT: "Tuesday" } }, { messageId: "<accepted-2>" }],
    ["sms.send", "POST", "transactionalSMS/sms", { sender: "DogGroom", recipient: "+61400000000", type: "transactional", content: "Your appointment is tomorrow" }, { messageId: 12, reference: "accepted", usedCredits: 1, remainingCredits: 9 }],
    ["contacts.create", "POST", "contacts", { email: "customer@example.test", attributes: { FIRSTNAME: "Sam" }, listIds: [3], updateEnabled: false }, { id: 42 }],
    ["contacts.update", "PUT", "contacts/customer%40example.test", { resource: "customer@example.test", emailBlacklisted: true }, null],
    ["contacts.get", "GET", "contacts/customer%40example.test", { resource: "customer@example.test" }, { id: 42, emailBlacklisted: true }],
    ["lists.create", "POST", "contacts/lists", { name: "Consenting customers", folderId: 1 }, { id: 3 }],
    ["lists.addContacts", "POST", "contacts/lists/3/contacts/add", { resource: 3, emails: ["customer@example.test"] }, { contacts: { success: ["customer@example.test"], failure: ["missing@example.test"] } }],
    ["lists.removeContacts", "POST", "contacts/lists/3/contacts/remove", { resource: 3, emails: ["customer@example.test"] }, { contacts: { success: ["customer@example.test"], failure: [] } }],
    ["senders.create", "POST", "senders", sender, { id: 2, dkimError: true, spfError: false }],
    ["domains.create", "POST", "senders/domains", { name: "example.test" }, { id: 4, domain_name: "example.test", message: "Created", dns_records: dns }],
    ["domains.get", "GET", "senders/domains/example.test", { resource: "example.test" }, { domain: "example.test", verified: false, authenticated: false, dns_records: dns }],
    ["domains.authenticate", "PUT", "senders/domains/example.test/authenticate", { resource: "example.test" }, { domain_name: "example.test", message: "Check requested" }],
    ["campaigns.create", "POST", "emailCampaigns", { name: "Spring offers", sender, subject: "Spring", htmlContent: "<p>Offer</p>", recipients: { listIds: [3], exclusionListIds: [4] } }, { id: 7 }],
    ["campaigns.get", "GET", "emailCampaigns/7", { resource: 7 }, { id: 7, status: "draft", statistics: {} }],
    ["campaigns.sendTest", "POST", "emailCampaigns/7/sendTest", { resource: 7, emailTo: ["owner@example.test"] }, null],
    ["campaigns.sendNow", "POST", "emailCampaigns/7/sendNow", { resource: 7 }, null],
    ["events.create", "POST", "events", { event_name: "booking_completed", identifiers: { email_id: "customer@example.test" }, event_properties: { bookingId: "b-1" } }, null]
  ]) { state.response = response; assert.deepEqual(await invoke(operation, input).catch(error => { error.message = `${operation}: ${error.message}`; throw error; }), response);
    const request = requests.at(-1); assert.equal(request.url.pathname, `/v3/${endpoint}`); assert.equal(request.init.method, method);
    if (method !== "GET") { const { resource, ...body } = input;
      if (Object.keys(body).length) assert.deepEqual(JSON.parse(request.init.body), body); else assert.equal(request.init.body, undefined); }
    assert.equal(new Headers(request.init.headers).get("api-key"), "brevo-fixture-key"); assert.equal(request.init.redirect, "error");
  }
  for (const [operation, key, endpoint] of [["folders.list", "folders", "contacts/folders"], ["lists.list", "lists", "contacts/lists"],
    ["senders.list", "senders", "senders"], ["campaigns.list", "campaigns", "emailCampaigns"], ["email.events", "events", "smtp/statistics/events"],
    ["sms.events", "events", "transactionalSMS/statistics/events"]]) {
    state.response = { [key]: operation.includes("events") ? [{ event: "hardBounces", messageId: "<accepted-1>", reason: "No mailbox" }] : [] };
    assert.deepEqual(await invoke(operation), state.response); assert.equal(requests.at(-1).url.pathname, `/v3/${endpoint}`);
  }
  const before = requests.length;
  for (const [operation, input] of [["email.send", { ...email, to: [] }], ["email.send", { sender, to: email.to }],
    ["sms.send", { sender: "Too-long-name", recipient: "bad", type: "transactional", content: "Hi" }],
    ["sms.send", { sender: "Test", recipient: "61400000000", type: "transactional", content: "Hi", templateId: 2 }],
    ["contacts.update", { resource: "customer@example.test" }], ["domains.get", { resource: "https://evil.test/" }],
    ["campaigns.create", { name: "Missing audience", sender, subject: "Test", htmlContent: "Hi", recipients: { listIds: [] } }],
    ["events.create", { event_name: "bad name", identifiers: {} }]
  ]) await assert.rejects(invoke(operation, input));
  state.deny = true; await assert.rejects(invoke("campaigns.sendNow", { resource: 7 })); state.deny = false; assert.equal(requests.length, before);
  state.response = { message: "accepted without ID" }; await assert.rejects(invoke("email.send", email), { code: "connector_response_invalid" });
  for (const status of [400, 403, 429]) { state.status = status; await assert.rejects(invoke("email.send", email)); }
  state.status = 200; state.fail = true; const uncertain = requests.length; await assert.rejects(invoke("email.send", email));
  assert.equal(requests.length, uncertain + 1);
});
