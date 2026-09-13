import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { tallyProvider } from "../src/server/tally.js";

test("Tally submission retrieval preserves answers and explicit paging with account credentials", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "tally-workflows-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  let response = { items: [], total: 0, hasMore: false }, status = 200;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { forms: {
      provider: "tally", accountMode: "shared", displayName: "Forms", scopes: [],
      authentication: { method: "api-key", secretRef: "env:TALLY_API_KEY" }
    } } }, providers: [tallyProvider], authorize: async (owner) => owner,
    resolveReference: async () => "fixture-tally-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, options) => { requests.push({ url: new URL(url), options }); return Response.json(response, { status }); }
  });
  const identity = { context: { applicationId: "app", subjectId: "owner" }, integrationId: "forms" };
  await service.connectApiKey(identity);
  const formCall = (operation, input) => service.invoke({ ...identity, operation, input });
  const form = { id: "AbC123", name: "Bookings", status: "DRAFT" };
  response = form;
  const blocks = [{ uuid: "f949b8e1-07a8-4ca5-899f-43a725751b80", type: "FORM_TITLE", groupUuid: "51f20dba-f8b3-49f3-80f8-d17e4a4a429f", groupType: "FORM_TITLE", payload: { title: "Bookings" } }];
  assert.deepEqual(await formCall("forms.create", { blocks, workspaceId: "workspace-1" }), form);
  assert.equal(requests.at(-1).options.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { workspaceId: "workspace-1", status: "DRAFT", blocks });
  assert.deepEqual(await formCall("forms.update", { formId: form.id, status: "PUBLISHED" }), form);
  assert.equal(requests.at(-1).options.method, "PATCH");
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { status: "PUBLISHED" });
  await formCall("forms.update", { formId: form.id, name: "Renamed" });
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { name: "Renamed" });
  response = { ...form, blocks };
  assert.deepEqual(await formCall("forms.get", { formId: form.id }), response);
  const beforeInvalid = requests.length;
  for (const [operation, input] of [["forms.create", {}], ["forms.create", { blocks: [null] }],
    ["forms.create", { blocks, status: "TRASH" }], ["forms.update", { formId: form.id }],
    ["forms.get", { formId: "../anything" }]]) {
    await assert.rejects(formCall(operation, input), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, beforeInvalid);
  status = 500;
  await assert.rejects(formCall("forms.create", { blocks }), { code: "connector_provider_failed" });
  assert.equal(requests.length, beforeInvalid + 1);
  status = 200;
  const invoke = (input) => service.invoke({ ...identity, operation: "submissions.list", input });
  response = { page: 2, limit: 20, hasMore: true, questions: [{ id: "q1", title: "Dogs?" }],
    submissions: [{ id: "sub1", formId: "AbC123", isCompleted: true, responses: [{ questionId: "q1", answer: 0 }, { questionId: "q2", answer: false }] }] };
  assert.deepEqual(await invoke({ formId: "AbC123", page: 2, limit: 20, filter: "all", afterId: "previous-id" }), response);
  assert.equal(requests.at(-1).url.href, "https://api.tally.so/forms/AbC123/submissions?page=2&limit=20&filter=all&afterId=previous-id");
  assert.equal(new Headers(requests.at(-1).options.headers).get("authorization"), "Bearer fixture-tally-key");
  assert.equal(new Headers(requests.at(-1).options.headers).get("tally-version"), "2025-02-01");
  const count = requests.length;
  for (const input of [{ formId: "../forms" }, { formId: "https://other.test" }, { formId: "AbC123", page: 0 },
    { formId: "AbC123", limit: 501 }, { formId: "AbC123", filter: "anything" }, { formId: "AbC123", headers: {} }]) {
    await assert.rejects(invoke(input), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  response = { page: 1, limit: 50, hasMore: false, questions: [], submissions: [] };
  assert.deepEqual(await invoke({ formId: "AbC123" }), response);
  assert.equal(requests.at(-1).url.searchParams.get("filter"), "completed");
  response = { ...response, submissions: {} };
  await assert.rejects(invoke({ formId: "AbC123" }), { code: "connector_response_invalid" });
  for (const [failure, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    status = failure;
    const before = requests.length;
    await assert.rejects(invoke({ formId: "AbC123" }), { code });
    assert.equal(requests.length, before + 1);
  }
});
