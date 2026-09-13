import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { apolloIoProvider } from "../src/server/apollo-io.js";

test("Apollo prospects, explicit enrichment and CRM changes run through the application-owned connection", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "apollo-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { response: { accounts: [] }, status: 200, fail: false, deny: false, key: "fixture-apollo-key" };
  const context = { applicationId: "sales-app", subjectId: "workspace" };
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { sales: {
      provider: "apollo-io", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:APOLLO_API_KEY" }
    } } }, providers: [apolloIoProvider], authorize: async owner => { if (state.deny) throw new Error("forbidden"); return owner; },
    resolveReference: async () => state.key,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({
      keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current"
    }) }), fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      if (state.fail) throw new Error("uncertain outcome");
      return Response.json(state.response, { status: state.status });
    }
  });
  const identity = { context, integrationId: "sales" };
  const invoke = (operation, input) => service.invoke({ ...identity, operation, input });
  await service.connectApiKey(identity);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/api/v1/accounts/search");
  state.response = { people: [{ id: "person-1", first_name: "Fixture" }], total_entries: 1 };
  assert.equal((await invoke("people.search", { person_titles: ["Designer", "Founder"], page: 2 })).people[0].id, "person-1");
  assert.deepEqual(requests.at(-1).url.searchParams.getAll("person_titles[]"), ["Designer", "Founder"]);
  assert.equal(requests.at(-1).url.searchParams.get("page"), "2");
  assert.equal(requests.at(-1).init.body, undefined);
  const beforeCharge = requests.length;
  for (const [operation, input] of [
    ["organizations.search", { q_organization_name: "Fixture" }],
    ["organizations.enrich", { domain: "fixture.example", allowCreditConsumption: false }],
    ["people.enrich", { id: "person-1" }]
  ]) await assert.rejects(invoke(operation, input));
  assert.equal(requests.length, beforeCharge);
  state.response = { organizations: [{ id: "org-1" }], pagination: { page: 1 } };
  await invoke("organizations.search", { q_organization_name: "Fixture & Co", allowCreditConsumption: true });
  assert.equal(requests.at(-1).url.pathname, "/api/v1/mixed_companies/search");
  assert.equal(requests.at(-1).url.searchParams.get("q_organization_name"), "Fixture & Co");
  assert.equal(requests.at(-1).url.searchParams.has("allowCreditConsumption"), false);
  state.response = { person: { id: "person-1", email: "fixture@example.test" }, match_confidence: "high" };
  await invoke("people.enrich", { id: "person-1", allowCreditConsumption: true });
  for (const field of ["reveal_personal_emails", "reveal_phone_number", "run_waterfall_email", "run_waterfall_phone"])
    assert.equal(requests.at(-1).url.searchParams.get(field), "false");
  state.response = { person: null, match_confidence: "none" };
  assert.equal((await invoke("people.enrich", { id: "missing", allowCreditConsumption: true })).person, null);
  state.response = { organization: { id: "org-1", domain: "fixture.example" } };
  await invoke("organizations.enrich", { domain: "fixture.example", allowCreditConsumption: true });
  assert.equal(requests.at(-1).init.method, "GET");

  for (const [operation, input, method, endpoint, response] of [
    ["contacts.search", { q_keywords: "Fixture" }, "POST", "contacts/search", { contacts: [] }],
    ["contacts.create", { first_name: "Fixture", email: "fixture@example.test", run_dedupe: false }, "POST", "contacts", { contact: { id: "contact-1" } }],
    ["contacts.update", { id: "contact-1", title: "Founder", label_names: ["Customers"] }, "PATCH", "contacts/contact-1", { contact: { id: "contact-1" } }],
    ["accounts.create", { name: "Fixture", domain: "fixture.example" }, "POST", "accounts", { account: { id: "account-1" } }],
    ["accounts.update", { id: "account-1", phone: "+61 800 000 000" }, "PATCH", "accounts/account-1", { account: { id: "account-1" } }],
    ["deals.create", { name: "Renewal", account_id: "account-1", amount: "1200.50", closed_date: "2026-12-31" }, "POST", "opportunities", { opportunity: { id: "deal-1" } }],
    ["deals.update", { id: "deal-1", opportunity_stage_id: "stage-1" }, "PATCH", "opportunities/deal-1", { opportunity: { id: "deal-1" } }],
    ["deals.list", { page: 2 }, "GET", "opportunities/search", { opportunities: [{ id: "deal-1" }] }],
    ["dealStages.list", {}, "GET", "opportunity_stages", { opportunity_stages: [{ id: "stage-1" }] }],
    ["users.list", { page: 2 }, "GET", "users/search", { users: [{ id: "user-1" }] }]
  ]) {
    state.response = response;
    assert.deepEqual(await invoke(operation, input), response);
    const request = requests.at(-1);
    assert.equal(request.url.pathname, `/api/v1/${endpoint}`);
    assert.equal(request.init.method, method);
    assert.equal(new Headers(request.init.headers).get("x-api-key"), state.key);
    assert.equal(request.init.redirect, "error");
    if (method === "PATCH") { const { id, ...body } = input; assert.deepEqual(JSON.parse(request.init.body), body); }
  }
  state.response = { contact: { id: "existing-contact" } };
  await invoke("contacts.create", { first_name: "Fixture", run_dedupe: true });
  assert.equal(JSON.parse(requests.at(-1).init.body).run_dedupe, true);
  const beforeInvalid = requests.length;
  for (const [operation, input] of [
    ["people.search", { person_titles: Array(101).fill("Designer") }],
    ["contacts.create", { first_name: "Fixture" }], ["contacts.update", { id: "contact-1" }],
    ["accounts.update", { id: "../secrets", name: "Fixture" }], ["accounts.create", {}],
    ["deals.create", { name: "Renewal", amount: "$1,200" }],
    ["deals.update", { id: "deal-1", closed_date: "2026-02-30" }],
    ["organizations.enrich", { domain: "https://fixture.example", allowCreditConsumption: true }],
    ["people.enrich", { id: "person-1", allowCreditConsumption: true, reveal_phone_number: true }]
  ]) await assert.rejects(invoke(operation, input));
  state.deny = true;
  await assert.rejects(invoke("contacts.create", { first_name: "Fixture", run_dedupe: false }));
  state.deny = false;
  await assert.rejects(service.invoke({ ...identity, context: { ...context, applicationId: "other" }, operation: "people.search" }));
  assert.equal(requests.length, beforeInvalid);
  state.response = { person: {} };
  await assert.rejects(invoke("people.enrich", { id: "person-1", allowCreditConsumption: true }), { code: "connector_response_invalid" });
  state.response = { error: { message: state.key } };
  for (const status of [403, 422, 429]) {
    state.status = status;
    await assert.rejects(invoke("people.search", {}), error => !JSON.stringify(error).includes(state.key));
  }
  state.status = 200;
  state.fail = true;
  const beforeUncertain = requests.length;
  await assert.rejects(invoke("contacts.create", { first_name: "Fixture", run_dedupe: false }));
  assert.equal(requests.length, beforeUncertain + 1);
  state.fail = false;
  state.response = { accounts: [] };
  state.key = "rotated-key";
  await invoke("accounts.search", {});
  assert.equal(new Headers(requests.at(-1).init.headers).get("x-api-key"), "rotated-key");
  state.status = 401;
  await assert.rejects(invoke("accounts.search", {}), { code: "connector_reconnect_required" });
  state.status = 200;
  await service.connectApiKey(identity);
  await service.disconnect(identity);
  const disconnectedRequests = requests.length;
  await assert.rejects(invoke("people.search", {}));
  assert.equal(requests.length, disconnectedRequests);
});
