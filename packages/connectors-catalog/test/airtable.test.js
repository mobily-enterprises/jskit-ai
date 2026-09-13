import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { airtableProvider } from "../src/server/airtable.js";

const context = { applicationId: "records-app", subjectId: "workspace" };
const baseId = "appFixture";
const tableId = "tblFixture";
const recordId = "recFixture";

test("Airtable discovers schema, changes tables/fields and completes a paged record lifecycle", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "airtable-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  let fail = false;
  let deny = false;
  let status = 200;
  let malformed = false;
  let token = "fixture-token";
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { data: {
      provider: "airtable", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:AIRTABLE_TOKEN" }
    } } }, providers: [airtableProvider], authorize: async owner => {
      if (deny) throw new Error("forbidden"); return owner;
    }, resolveReference: async () => token,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({
      keys: { current: new Uint8Array(32).fill(9) }, activeKeyId: "current"
    }) }), fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (fail) throw new Error("uncertain write");
      if (status !== 200) return Response.json({ error: { type: "fixture" } }, { status });
      if (malformed) return Response.json({});
      const pathname = new URL(url).pathname;
      if (pathname === "/v0/meta/bases") return Response.json(init.method === "POST" ? { id: baseId, tables: [{ id: tableId }] } : { bases: [{ id: baseId }] });
      if (pathname.startsWith("/v0/meta/")) return Response.json(init.method === "GET" ?
        { tables: [{ id: tableId, name: "Tasks", fields: [{ id: "fldName", type: "singleLineText", name: "Name" }] }] } :
        { id: pathname.includes("/fields") ? "fldName" : tableId, name: "Tasks" });
      if (pathname.endsWith("/listRecords")) return Response.json({ records: [{ id: recordId, fields: { Name: "Task" } }], offset: "opaque+/cursor" });
      if (init.method === "DELETE") return Response.json({ id: recordId, deleted: true });
      return Response.json({ id: recordId, fields: JSON.parse(init.body).fields });
    }
  });
  const invoke = (operation, input) => service.invoke({ context, integrationId: "data", operation, input });
  await service.connectApiKey({ context, integrationId: "data" });
  assert.equal(requests.length, 1);
  const newBase = await invoke("bases.create", { name: "Tasks", workspaceId: "wspFixture",
    tables: [{ name: "Tasks", fields: [{ name: "Name", type: "singleLineText" }] }] });
  assert.equal(newBase.id, baseId);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(JSON.parse(requests.at(-1).init.body).workspaceId, "wspFixture");
  const tables = await invoke("tables.list", { baseId });
  assert.equal(tables.tables[0].fields[0].type, "singleLineText");
  await invoke("tables.create", { baseId, name: "Tasks", fields: [{ name: "Name", type: "singleLineText" }] });
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(new URL(requests.at(-1).url).pathname, `/v0/meta/bases/${baseId}/tables`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).fields, [{ name: "Name", type: "singleLineText" }]);
  await invoke("tables.update", { baseId, tableId, name: "Renamed" });
  assert.equal(requests.at(-1).init.method, "PATCH");
  await invoke("fields.create", { baseId, tableId, field: { name: "Notes", type: "multilineText" } });
  assert.equal(new URL(requests.at(-1).url).pathname, `/v0/meta/bases/${baseId}/tables/${tableId}/fields`);
  await invoke("fields.update", { baseId, tableId, fieldId: "fldName", name: "Title" });
  assert.equal(requests.at(-1).init.method, "PATCH");
  const records = await invoke("records.list", { baseId, tableId, filterByFormula: '{Name}="a & b"' });
  await invoke("records.list", { baseId, tableId, offset: records.offset });
  assert.equal(JSON.parse(requests.at(-1).init.body).offset, "opaque+/cursor");
  const created = await invoke("records.create", { baseId, tableId: "Tasks / urgent", fields: { Name: "Task", Done: false } });
  assert.ok(requests.at(-1).url.endsWith("Tasks%20%2F%20urgent"));
  assert.deepEqual(created.fields, { Name: "Task", Done: false });
  assert.equal(JSON.parse(requests.at(-1).init.body).typecast, false);
  await invoke("records.update", { baseId, tableId, recordId: created.id, fields: { Done: true } });
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).fields, { Done: true });
  await invoke("records.delete", { baseId, tableId, recordId });
  assert.equal(requests.at(-1).init.method, "DELETE");
  assert.equal(new Headers(requests.at(-1).init.headers).get("authorization"), "Bearer fixture-token");
  const before = requests.length;
  for (const input of [{ baseId: "../keys", tableId, fields: { Name: "bad" } },
    { baseId, tableId: "..", fields: { Name: "bad" } }, { baseId, tableId, fields: {} },
    { baseId, tableId, fields: [] }]) await assert.rejects(invoke("records.create", input));
  await assert.rejects(invoke("records.list", { baseId, tableId, pageSize: 101 }));
  await assert.rejects(invoke("bases.create", { name: "Empty", workspaceId: "wspFixture", tables: [] }));
  await assert.rejects(invoke("tables.create", { baseId, name: "Duplicates", fields: [
    { name: "Name", type: "singleLineText" }, { name: "name", type: "singleLineText" }
  ] }));
  deny = true;
  await assert.rejects(invoke("records.delete", { baseId, tableId, recordId }));
  deny = false;
  await assert.rejects(service.invoke({ context: { ...context, applicationId: "other" }, integrationId: "data",
    operation: "records.delete", input: { baseId, tableId, recordId } }));
  assert.equal(requests.length, before);
  for (const errorStatus of [403, 422, 429]) {
    status = errorStatus;
    await assert.rejects(invoke("records.create", { baseId, tableId, fields: { Name: "Task" } }));
  }
  status = 200;
  fail = true;
  const beforeFailure = requests.length;
  await assert.rejects(invoke("records.create", { baseId, tableId, fields: { Name: "Task" } }));
  assert.equal(requests.length, beforeFailure + 1);
  fail = false;
  malformed = true;
  await assert.rejects(invoke("tables.list", { baseId }), { code: "connector_response_invalid" });
  malformed = false;
  token = "rotated-fixture-token";
  await invoke("records.list", { baseId, tableId });
  assert.equal(new Headers(requests.at(-1).init.headers).get("authorization"), "Bearer rotated-fixture-token");
  status = 401;
  await assert.rejects(invoke("records.list", { baseId, tableId }), { code: "connector_reconnect_required" });
  assert.equal((await service.status({ context, integrationId: "data" })).status, "reconnect-required");
  status = 200;
  await service.connectApiKey({ context, integrationId: "data" });
  assert.equal((await service.status({ context, integrationId: "data" })).status, "connected");
  await service.disconnect({ context, integrationId: "data" });
  const afterDisconnect = requests.length;
  assert.equal((await service.status({ context, integrationId: "data" })).status, "disconnected");
  await assert.rejects(invoke("records.list", { baseId, tableId }));
  assert.equal(requests.length, afterDisconnect);
  await service.connectApiKey({ context, integrationId: "data" });
  assert.equal((await service.status({ context, integrationId: "data" })).status, "connected");
});
