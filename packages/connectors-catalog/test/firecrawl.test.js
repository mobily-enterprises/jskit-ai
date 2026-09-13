import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { firecrawlProvider } from "../src/server/firecrawl.js";

test("Firecrawl searches and imports bounded crawl pages without leaking the key or replaying paid work", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "firecrawl-repair-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = []; let status = 200; let fail = false; let malformed = false; let deny = false; let key = "fixture-key";
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { firecrawl: { provider: "firecrawl", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:FIRECRAWL_API_KEY" } } } },
    providers: [firecrawlProvider], authorize: async owner => { if (deny) throw new Error("denied"); return owner; },
    resolveReference: async () => key,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => {
      const parsed = new URL(url); requests.push({ url: parsed, init });
      assert.equal(parsed.origin, "https://api.firecrawl.dev");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${key}`);
      assert.equal(init.redirect, "error");
      if (fail) throw new Error("unknown outcome");
      if (status !== 200) return Response.json({ success: false }, { status });
      if (malformed) return Response.json({ success: true });
      const body = init.body ? JSON.parse(init.body) : {};
      if (parsed.pathname.endsWith("credit-usage")) return Response.json({ success: true, data: { remainingCredits: 0 } });
      if (parsed.pathname.endsWith("/search")) return Response.json({ success: true, data: { web: [{ url: "https://example.com", markdown: "Search content" }] } });
      if (parsed.pathname.endsWith("/map")) return Response.json({ success: true, links: [{ url: "https://example.com/docs" }] });
      if (parsed.pathname.endsWith("/scrape")) return Response.json({ success: true, data: typeof body.formats[0] === "object" ? { json: { title: "Docs" } } : { markdown: "# Docs" } });
      if (parsed.pathname.endsWith("/errors")) return Response.json({ errors: [{ url: "https://example.com/missing", error: "404" }], robotsBlocked: [] });
      if (init.method === "DELETE") return Response.json({ status: "cancelled" });
      if (init.method === "POST") return Response.json({ success: true, id: "job-one" });
      return Response.json({ status: "completed", total: 2, completed: 2, data: [{ markdown: parsed.search ? "Page two" : "Page one" }], next: parsed.search ? null : "https://api.firecrawl.dev/v2/crawl/job-one?skip=1" });
    }
  });
  const owner = { context: { applicationId: "docs-app", subjectId: "workspace" }, integrationId: "firecrawl" };
  const invoke = (operation, input) => service.invoke({ ...owner, operation, input });
  await service.connectApiKey(owner);
  assert.equal((await invoke("pages.scrape", { url: "https://example.com" })).data.markdown, "# Docs");
  assert.equal((await invoke("pages.search", { query: "docs", includeContent: true })).data.web[0].markdown, "Search content");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: "docs", limit: 5, sources: ["web"], scrapeOptions: { formats: ["markdown"] } });
  assert.equal((await invoke("sites.map", { url: "https://example.com", limit: 20 })).links.length, 1);
  assert.equal((await invoke("pages.extract", { url: "https://example.com", schema: { type: "object", properties: { title: { type: "string" } } } })).data.json.title, "Docs");
  const job = await invoke("crawls.start", { url: "https://example.com", limit: 20 });
  assert.equal(job.id, "job-one");
  assert.equal(JSON.parse(requests.at(-1).init.body).allowExternalLinks, false);
  const first = await invoke("crawls.get", { id: job.id });
  const second = await invoke("crawls.get", { id: job.id, next: first.next });
  assert.equal(second.data[0].markdown, "Page two"); assert.equal(second.next, null);
  assert.equal((await invoke("crawls.errors", { id: job.id })).errors[0].error, "404");
  assert.equal((await invoke("crawls.cancel", { id: job.id })).status, "cancelled");
  const before = requests.length;
  for (const next of ["https://evil.example/v2/crawl/job-one", "https://api.firecrawl.dev/v2/crawl/another", "https://key@api.firecrawl.dev/v2/crawl/job-one"]) await assert.rejects(invoke("crawls.get", { id: job.id, next }), { code: "connector_input_invalid" });
  for (const input of [{ url: "https://example.com" }, { url: "file:///secret", limit: 1 }, { url: "https://user:pass@example.com", limit: 1 }, { url: "https://example.com", limit: 1001 }]) await assert.rejects(invoke("crawls.start", input), { code: "connector_input_invalid" });
  deny = true; await assert.rejects(invoke("pages.search", { query: "docs" })); deny = false;
  assert.equal(requests.length, before);
  malformed = true; await assert.rejects(invoke("crawls.get", { id: job.id }), { code: "connector_response_invalid" }); malformed = false;
  for (const [httpStatus, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) { status = httpStatus; await assert.rejects(invoke("crawls.start", { url: "https://example.com", limit: 1 }), { code }); }
  status = 200; fail = true; const failedBefore = requests.length; await assert.rejects(invoke("crawls.start", { url: "https://example.com", limit: 1 })); assert.equal(requests.length, failedBefore + 1); fail = false;
  key = "rotated-key"; await service.connectApiKey(owner);
  await service.disconnect(owner); const disconnected = requests.length;
  await assert.rejects(invoke("pages.search", { query: "docs" })); assert.equal(requests.length, disconnected);
  await service.connectApiKey(owner); assert.equal((await invoke("credits.read")).data.remainingCredits, 0);
});
