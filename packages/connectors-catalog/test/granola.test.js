import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { granolaProvider, registerGranolaClient } from "../src/server/granola.js";

const noteId = "not_12345678901234";
const folderId = "fol_12345678901234";
const summary = { id: noteId, object: "note", title: null, owner: { name: null, email: "fixture@example.test" }, created_at: "2026-09-08T12:00:00Z", updated_at: "2026-09-08T13:00:00Z" };
const folder = { id: folderId, object: "folder", name: "Fixture folder", parent_folder_id: null };
const transcript = [{ speaker: { source: "microphone", diarization_label: "Speaker A" }, text: "Fixture text", start_time: "2026-09-08T12:00:00Z", end_time: "2026-09-08T12:00:01Z" }];
const note = { ...summary, summary_text: "Fixture summary", summary_markdown: null, private_notes_text: null, private_notes_markdown: null, transcript: null };
const context = { applicationId: "app-one", subjectId: "owner-one" };
const args = { context, integrationId: "meetings" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "granola-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { key: "grn_private-fixture-key", status: 200, value: undefined, hang: false };
  const requests = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { meetings: {
      provider: "granola", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:GRANOLA_KEY" },
      settings: { apiUrl: "https://invalid.test" }
    } } },
    providers: [{ ...granolaProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    resolveReference: async () => state.key,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(9) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      assert.equal(url.origin, "https://public-api.granola.ai"); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${state.key}`);
      assert.equal(url.searchParams.has("api_key"), false);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      const value = url.pathname === "/v1/notes" ? { notes: [summary], hasMore: true, cursor: "next+=cursor" } :
        url.pathname === "/v1/folders" ? { folders: [folder], hasMore: false, cursor: null } :
          url.pathname.endsWith("/transcript") ? { transcript, hasMore: true, cursor: "transcript-next" } :
            { ...note, transcript: url.searchParams.has("include") ? transcript : null };
      return Response.json(state.value === undefined ? value : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  return { service, options, directory, state, requests, connect: () => service.connectApiKey(args) };
}

test("Granola verifies a key, encrypts connection files and reads current bindings after restart", async (t) => {
  const f = await fixture(t); assert.equal((await f.connect()).status, "connected");
  assert.equal(f.requests[0].url.pathname, "/v1/notes"); assert.equal(f.requests[0].url.searchParams.get("page_size"), "10");
  for (const name of await readdir(f.directory)) assert.equal((await readFile(path.join(f.directory, name), "utf8")).includes(f.state.key), false);
  const restarted = createConnectionService(f.options); assert.equal((await restarted.status(args)).status, "connected");
  f.state.key = "grn_rotated-key";
  assert.deepEqual(await restarted.invoke({ ...args, operation: "notes.get", input: { note_id: noteId } }), note);
  assert.equal(f.requests.at(-1).url.search, "");
  await restarted.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
  assert.equal(f.requests.length, 2);
});

test("Granola reads explicit filter and cursor pages and preserves null fields and anonymous speakers", async (t) => {
  const f = await fixture(t); await f.connect();
  const list = await f.service.invoke({ ...args, operation: "notes.list", input: {
    created_after: "2026-09-01", created_before: "2026-09-09T12:00:00.001Z", updated_after: "2026-09-08T00:00:00Z", folder_id: folderId, cursor: "next+=cursor", page_size: 2
  } });
  assert.equal(list.notes[0].title, null); assert.equal(list.cursor, "next+=cursor");
  assert.equal(f.requests.at(-1).url.searchParams.get("cursor"), "next+=cursor"); assert.equal(f.requests.at(-1).url.searchParams.get("folder_id"), folderId);
  assert.deepEqual((await f.service.invoke({ ...args, operation: "folders.list", input: { page_size: 1 } })).folders, [folder]);
  assert.deepEqual((await f.service.invoke({ ...args, operation: "notes.get", input: { note_id: noteId, include: "transcript" } })).transcript, transcript);
  const page = await f.service.invoke({ ...args, operation: "transcripts.list", input: { note_id: noteId, page_size: 100, cursor: "transcript-next" } });
  assert.equal(page.transcript[0].speaker.attribution, undefined); assert.equal(page.transcript[0].speaker.diarization_label, "Speaker A");
  assert.equal(f.requests.at(-1).url.pathname, `/v1/notes/${noteId}/transcript`); assert.equal(f.requests.length, 5);
});

test("Granola rejects invalid IDs, dates, page bounds, arbitrary destinations and writes before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  for (const input of [{ page_size: 31 }, { page_size: 0 }, { page_size: 1.5 }, { created_after: "2026-02-30" }, { created_after: "2026-09-01T25:00:00Z" },
    { created_after: "2026-09-01T12:00:00+08:00" }, { updated_after: "tomorrow" }, { folder_id: "../secret" }, { cursor: " " }, { cursor: "x".repeat(8193) }, { url: "https://invalid.test" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "notes.list", input }), { code: "connector_input_invalid" });
  }
  for (const input of [{ note_id: "../secret" }, { note_id: "550e8400-e29b-41d4-a716-446655440000" }, { note_id: noteId, include: "all" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "notes.get", input }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "transcripts.list", input: { note_id: noteId, page_size: 101 } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...args, operation: "notes.create" }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Granola accepts empty pages but rejects missing cursors, malformed summaries and mismatched note identities", async (t) => {
  const f = await fixture(t); f.state.value = { notes: [], hasMore: false, cursor: null }; await f.connect();
  for (const value of [null, "invalid JSON", {}, { notes: [], hasMore: true, cursor: null }, { notes: [null], hasMore: false, cursor: null },
    { notes: [summary, summary], hasMore: true, cursor: "next" }, { notes: [], hasMore: "false", cursor: null }, { notes: [], hasMore: false }]) {
    f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "notes.list", input: { page_size: 1 } }), { code: "connector_response_invalid" });
  }
  f.state.value = { ...note, id: "not_abcdefghijklmn" };
  await assert.rejects(f.service.invoke({ ...args, operation: "notes.get", input: { note_id: noteId } }), { code: "connector_response_invalid" });
  f.state.value = { transcript: [{ text: "Missing speaker" }], hasMore: false, cursor: null };
  await assert.rejects(f.service.invoke({ ...args, operation: "transcripts.list", input: { note_id: noteId } }), { code: "connector_response_invalid" });
  f.state.value = { folders: [{ ...folder, parent_folder_id: "bad" }], hasMore: false, cursor: null };
  await assert.rejects(f.service.invoke({ ...args, operation: "folders.list" }), { code: "connector_response_invalid" });
  f.state.status = 204; await assert.rejects(f.service.invoke({ ...args, operation: "notes.list" }), { code: "connector_response_invalid" });
});

test("Granola distinguishes unavailable notes and oversized inline transcripts without exposing provider text or retrying", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, code] of [[403, "connector_permission_denied"], [404, "connector_resource_not_found"], [413, "connector_response_too_large"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    f.state.status = status; f.state.value = { error: { code: "TRANSCRIPT_TOO_LARGE", message: "sensitive provider text" } };
    const before = f.requests.length;
    await assert.rejects(f.service.invoke({ ...args, operation: "notes.get", input: { note_id: noteId, include: "transcript" } }), (error) => error.code === code && !error.message.includes("sensitive"));
    assert.equal(f.requests.length, before + 1);
  }
  f.state.status = 200; f.state.value = undefined;
  assert.deepEqual((await f.service.invoke({ ...args, operation: "transcripts.list", input: { note_id: noteId } })).transcript, transcript);
  f.state.status = 401; await assert.rejects(f.service.invoke({ ...args, operation: "notes.list" }), { code: "connector_reconnect_required" });
});

test("Granola isolates owners, honors host policy and preserves a saved connection after failed replacement verification", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "notes.list" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...f.options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...args, operation: "notes.list" }), { code: "connector_access_denied" });
  for (const key of ["plain-key", "grn_", "grn_secret\nvalue"]) {
    f.state.key = key; await assert.rejects(f.connect(), { code: "connector_binding_missing" });
  }
  assert.equal(f.requests.length, 1); assert.equal((await f.service.status(args)).status, "reconnect-required");
  f.state.key = "grn_replacement"; f.state.status = 401;
  await assert.rejects(f.connect(), { code: "connector_reconnect_required" });
  f.state.key = "grn_private-fixture-key"; f.state.status = 200;
  assert.equal((await f.service.status(args)).status, "connected");
  await f.service.invoke({ ...args, operation: "notes.list" });
});

test("Granola cancellation and timeout reach the provider without replay", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.hang = true;
  const abort = new AbortController(); const pending = f.service.invoke({ ...args, operation: "notes.list", signal: abort.signal });
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "notes.list" }), { code: "connector_provider_timeout" });
  assert.equal(f.requests.length, 3);
});

test("Granola guide validates the shared reference-only configuration and does not offer API-key mode as per-user OAuth", async () => {
  const guide = await readFile(new URL("../docs/granola.md", import.meta.url), "utf8"); const json = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  assert.equal(parseIntegrationConfiguration(json, { providers: [granolaProvider] }).integrations.meetings.provider, "granola");
  for (const change of [{ accountMode: "per-user" }, { authentication: { method: "api-key", secretRef: "grn_raw-secret" } },
    { scopes: ["all-workspace-notes"] }]) {
    const invalid = JSON.parse(json); Object.assign(invalid.integrations.meetings, change);
    assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [granolaProvider] }));
  }
});


test("Granola MCP OAuth verifies tools, refreshes after restart and cannot call API-key operations", async (t) => {
  const f = await fixture(t);
  const callback = "http://127.0.0.1:4930/granola/callback";
  const calls = []; let time = Date.now();
  const scopes = ["openid", "profile", "email", "offline_access"];
  const options = { ...f.options, now: () => time,
    configuration: { schemaVersion: 1, registrations: { granola: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:GRANOLA_SECRET", callbackUrlRef: "env:GRANOLA_CALLBACK" } }, integrations: {
      meetings: { provider: "granola", accountMode: "assistant", scopes, authentication: { method: "oauth2", registrationRef: "granola" } }
    } }, resolveReference: async (ref) => ref === "env:GRANOLA_SECRET" ? "fixture-secret" : callback,
    fetchImpl: async (address, init) => {
      const url = String(address); calls.push({ url, init });
      if (url === "https://mcp-auth.granola.ai/oauth2/token") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_secret"), "fixture-secret");
        assert.equal(body.get("resource"), "https://mcp.granola.ai/mcp");
        const refresh = body.get("grant_type") === "refresh_token";
        if (refresh) assert.equal(body.get("refresh_token"), "fixture-refresh");
        else { assert(body.get("code_verifier")); assert.equal(body.get("redirect_uri"), callback); }
        return Response.json({ access_token: refresh ? "refreshed-access" : "fixture-access", refresh_token: "fixture-refresh",
          token_type: "Bearer", expires_in: 60, scope: scopes.join(" ") });
      }
      assert.equal(url, "https://mcp.granola.ai/mcp");
      assert.match(new Headers(init.headers).get("authorization"), /^Bearer (fixture-access|refreshed-access)$/u);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      const message = JSON.parse(init.body); calls.at(-1).message = message;
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } :
        message.method === "tools/list" ? { tools: [] } : { content: [{ type: "text", text: "Fixture note" }] };
      return Response.json({ jsonrpc: "2.0", id: message.id, result });
    }
  };
  const service = createConnectionService(options);
  const start = await service.beginAuthorization(args); const url = new URL(start.authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://mcp-auth.granola.ai/oauth2/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const completion = { ...args, callbackUrl: `${callback}?state=${url.searchParams.get("state")}&code=fixture` };
  assert.equal((await service.completeAuthorization(completion)).status, "connected");
  assert.equal(calls.some((call) => call.message?.method === "tools/call"), false);
  const before = calls.length;
  await assert.rejects(service.invoke({ ...args, operation: "notes.list" }), { code: "connector_mode_unavailable" });
  assert.equal(calls.length, before);
  await assert.rejects(service.completeAuthorization(completion));
  time += 61000;
  const restarted = createConnectionService(options);
  assert.deepEqual(await restarted.invoke({ ...args, operation: "tools.list" }), { tools: [] });
  assert.equal(calls.filter((call) => call.url.endsWith("/token")).length, 2);
  assert.deepEqual(await restarted.invoke({ ...args, operation: "tools.call", input: { name: "get_account_info", arguments: {} } }),
    { content: [{ type: "text", text: "Fixture note" }] });
  await restarted.disconnect(args); assert.equal((await restarted.status(args)).status, "disconnected");
  const key = await fixture(t); await key.connect(); const keyRequests = key.requests.length;
  await assert.rejects(key.service.invoke({ ...args, operation: "tools.list" }), { code: "connector_mode_unavailable" });
  assert.equal(key.requests.length, keyRequests);
});

test("Granola registers the host callback through the existing MCP registration contract", async () => {
  const requests = [];
  const result = await registerGranolaClient({ clientName: "Fixture host", callbackUrl: "https://app.example/integrations/granola/callback" }, {
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({ ...JSON.parse(init.body), client_id: "client", client_secret: "secret" });
    }
  });
  assert.deepEqual(result, { clientId: "client", clientSecret: "secret" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://mcp-auth.granola.ai/oauth2/register");
  assert.deepEqual(requests[0].body.redirect_uris, ["https://app.example/integrations/granola/callback"]);
  assert.equal(requests[0].body.token_endpoint_auth_method, "client_secret_post");
});

test("Granola API keys cannot store OAuth identity scopes", () => {
  const configuration = { schemaVersion: 1, registrations: {}, integrations: { meetings: {
    provider: "granola", accountMode: "shared", scopes: ["openid"], authentication: { method: "api-key", secretRef: "env:GRANOLA_KEY" }
  } } };
  assert.throws(() => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [granolaProvider] }), error => Boolean(error.fieldErrors?.["integrations.meetings.scopes"]));
});
