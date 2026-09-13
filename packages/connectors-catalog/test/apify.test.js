import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { apifyProvider } from "../src/server/apify.js";

const context = { applicationId: "scraping-app", subjectId: "workspace" };
test("Apify submits a bounded run, observes terminal states, aborts and retrieves paged storage results", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "apify-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  let runStatus = "RUNNING";
  let fail = false;
  let status = 200;
  let deny = false;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { scraper: {
      provider: "apify", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:APIFY_TOKEN" }
    } } }, providers: [apifyProvider], authorize: async owner => { if (deny) throw new Error("forbidden"); return owner; },
    resolveReference: async () => "fixture-token",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({
      keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current"
    }) }), fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      if (fail) throw new Error("unknown submission outcome");
      if (status !== 200) return Response.json({ error: { type: "fixture" } }, { status });
      const pathname = new URL(url).pathname;
      if (pathname === "/v2/actors") return Response.json({ data: { items: [], offset: 0, total: 0 } });
      if (pathname === "/v2/actors/owner~actor") return Response.json({ data: { id: "actor-id", name: "actor" } });
      if (pathname.includes("/datasets/")) return Response.json([{ title: "Fixture result" }]);
      if (pathname.endsWith("/binary")) return new Response(new Uint8Array([0, 255, 1]), { headers: { "content-type": "application/octet-stream" } });
      if (pathname.endsWith("/oversized")) return new Response(new Uint8Array(8 * 1024 * 1024 + 1));
      if (pathname.includes("/key-value-stores/")) return Response.json({ result: "Stored output" });
      return Response.json({ data: { id: "run-fixture", status: runStatus,
        defaultDatasetId: "dataset-fixture", defaultKeyValueStoreId: "store-fixture", statusMessage: runStatus } });
    }
  });
  await service.connectApiKey({ context, integrationId: "scraper" });
  const invoke = (operation, input) => service.invoke({ context, integrationId: "scraper", operation, input });
  await invoke("actors.get", { actorId: "owner~actor" });
  const start = { actorId: "owner~actor", input: { query: "example" }, timeout: 120, maxTotalChargeUsd: 1 };
  const run = await invoke("runs.start", start);
  assert.equal(run.data.status, "RUNNING");
  assert.equal(requests.at(-1).url.pathname, "/v2/actors/owner~actor/runs");
  assert.equal(requests.at(-1).url.searchParams.get("maxTotalChargeUsd"), "1");
  assert.equal(requests.at(-1).url.searchParams.get("restartOnError"), "false");
  assert.equal(requests.at(-1).url.searchParams.get("waitForFinish"), "0");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), start.input);
  for (const state of ["SUCCEEDED", "FAILED", "TIMED-OUT"]) {
    runStatus = state;
    assert.equal((await invoke("runs.get", { runId: run.data.id })).data.status, state);
  }
  runStatus = "ABORTING";
  assert.equal((await invoke("runs.abort", { runId: run.data.id })).data.status, "ABORTING");
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.searchParams.get("gracefully"), "true");
  runStatus = "ABORTED";
  assert.equal((await invoke("runs.get", { runId: run.data.id })).data.status, "ABORTED");
  const page = await invoke("datasets.items", { datasetId: run.data.defaultDatasetId, limit: 1 });
  assert.equal(page[0].title, "Fixture result");
  await invoke("datasets.items", { datasetId: run.data.defaultDatasetId, limit: 1, offset: 1 });
  assert.equal(requests.at(-1).url.searchParams.get("offset"), "1");
  const stored = await invoke("stores.record", { storeId: run.data.defaultKeyValueStoreId, key: "OUTPUT/report" });
  assert.deepEqual(JSON.parse(Buffer.from(stored.bodyBase64, "base64").toString()), { result: "Stored output" });
  assert.equal(stored.contentType, "application/json");
  assert.ok(requests.at(-1).url.pathname.endsWith("/OUTPUT%2Freport"));
  assert.equal(new Headers(requests.at(-1).init.headers).get("authorization"), "Bearer fixture-token");
  const binary = await invoke("stores.record", { storeId: "store-fixture", key: "binary" });
  assert.deepEqual([...Buffer.from(binary.bodyBase64, "base64")], [0, 255, 1]);
  await assert.rejects(invoke("stores.record", { storeId: "store-fixture", key: "oversized" }), { code: "connector_response_too_large" });
  const before = requests.length;
  for (const invalid of [{ ...start, actorId: "../keys" }, { ...start, timeout: 0 },
    { ...start, maxTotalChargeUsd: undefined }, { ...start, input: [] }]) await assert.rejects(invoke("runs.start", invalid));
  deny = true;
  await assert.rejects(invoke("runs.start", start));
  deny = false;
  await assert.rejects(service.invoke({ context: { ...context, applicationId: "other" }, integrationId: "scraper",
    operation: "runs.start", input: start }));
  assert.equal(requests.length, before);
  for (const errorStatus of [403, 429]) {
    status = errorStatus;
    await assert.rejects(invoke("runs.start", start));
  }
  status = 200;
  fail = true;
  const beforeFailure = requests.length;
  await assert.rejects(invoke("runs.start", start));
  assert.equal(requests.length, beforeFailure + 1);
});
