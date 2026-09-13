import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { microsoftWordProvider } from "../src/server/microsoft-word.js";
import { microsoftPowerPointProvider } from "../src/server/microsoft-powerpoint.js";
import { microsoftOutlookProvider } from "../src/server/microsoft-outlook.js";
import { microsoftOneDriveProvider } from "../src/server/microsoft-onedrive.js";
import { microsoftExcelProvider } from "../src/server/microsoft-excel.js";
import { microsoftTeamsProvider } from "../src/server/microsoft-teams.js";
import { microsoftOneNoteProvider } from "../src/server/microsoft-onenote.js";
import { microsoftSharePointProvider } from "../src/server/microsoft-sharepoint.js";

const owner = { applicationId: "app-one", subjectId: "user-one" };
const callback = "https://application.example/connectors/callback";
const cases = [
  { provider: microsoftOutlookProvider, scope: "Mail.Read", authority: "common", input: {}, pathname: "/v1.0/me/mailFolders", item: { id: "inbox", displayName: "Inbox", unreadItemCount: 2 } },
  { provider: microsoftOneDriveProvider, scope: "Files.Read", authority: "common", input: {}, pathname: "/v1.0/me/drive/root/children", item: { id: "file-id", name: "Budget.xlsx", file: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } } },
  { provider: microsoftExcelProvider, scope: "Files.Read", authority: "common", input: {}, pathname: "/v1.0/me/drive/root/children", item: { id: "drive!item-1", name: "Budget.xlsx", file: {} } },
  { provider: microsoftTeamsProvider, scope: "Team.ReadBasic.All", scopes: ["Team.ReadBasic.All", "Channel.ReadBasic.All", "User.Read"], authority: "organizations", input: {}, pathname: "/v1.0/me/joinedTeams", item: { id: "team-id", displayName: "Engineering" } },
  { provider: microsoftOneNoteProvider, scope: "Notes.Read", authority: "common", input: {}, pathname: "/v1.0/me/onenote/notebooks", item: { id: "notebook-id", displayName: "Notes" } },
  { provider: microsoftSharePointProvider, scope: "Sites.Read.All", scopes: ["Sites.Read.All", "User.Read"], authority: "organizations", input: { search: "Team & projects" }, pathname: "/v1.0/sites", item: { id: "site-id", name: "Team", webUrl: "https://example.sharepoint.com/sites/team" } },
  { provider: microsoftWordProvider, scope: "Files.Read", authority: "common", input: {}, pathname: "/v1.0/me/drive/root/children", item: { id: "document-id", name: "Notes.DOCX", file: {} } },
  { provider: microsoftPowerPointProvider, scope: "Files.Read", authority: "common", input: {}, pathname: "/v1.0/me/drive/root/children", item: { id: "presentation-id", name: "Review.PPTX", file: {} } }
];

async function fixture(t, entry) {
  const directory = await mkdtemp(path.join(tmpdir(), "microsoft-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { time: Date.now(), scope: (entry.scopes || [entry.scope]).join(" "), status: 200, tokenStatus: 200, tokenCount: 0, response: { value: [entry.item] } };
  const options = {
    configuration: {
      schemaVersion: 1,
      integrations: { service: { provider: entry.provider.id, accountMode: "per-user", ...(entry.tenantId ? { settings: { tenantId: entry.tenantId } } : {}), scopes: [...(entry.scopes || [entry.scope]), "offline_access"], authentication: { method: "oauth2", registrationRef: "microsoft" } } },
      registrations: { microsoft: { source: "own", clientId: "test-client-id", clientSecretRef: "env:MS_SECRET", callbackUrlRef: "env:MS_CALLBACK" } }
    },
    providers: [entry.provider], authorize: async (context) => context, now: () => state.time,
    resolveReference: async (ref) => ref === "env:MS_CALLBACK" ? callback : "test-client-secret",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      requests.push({ url, init });
      if (url.hostname === "login.microsoftonline.com") {
        assert.equal(url.href, `https://login.microsoftonline.com/${entry.authority}/oauth2/v2.0/token`);
        if (state.tokenStatus !== 200) return Response.json({ error: "invalid_grant", error_description: "test-client-secret" }, { status: state.tokenStatus });
        state.tokenCount += 1;
        return Response.json({ access_token: `test-access-${state.tokenCount}`, refresh_token: `test-refresh-${state.tokenCount}`, token_type: "Bearer", expires_in: 60, scope: state.scope });
      }
      assert.equal(url.origin, "https://graph.microsoft.com");
      return [202, 204].includes(state.status) ? new Response(null, { status: state.status }) : typeof state.response === "string" ? new Response(state.response, { status: state.status, headers: { "Content-Type": "text/html" } }) : Response.json(state.response, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const input = { context: owner, integrationId: "service" };
  async function start() {
    const result = await service.beginAuthorization({ ...input, verificationInput: entry.input });
    const url = new URL(result.authorizationUrl);
    return { url, callbackUrl: `${callback}?code=authorization-code&state=${url.searchParams.get("state")}` };
  }
  return { service, options, input, start, requests, state, directory };
}

for (const entry of cases) {
  test(`${entry.provider.id}: delegates the correct permission and account audience, verifies access and persists privately`, async (t) => {
    assert.deepEqual(entry.provider.verificationFields.filter((field) => field.required).map((field) => field.name), Object.keys(entry.input));
    const { service, options, input, start, requests, directory } = await fixture(t, entry);
    const { url, callbackUrl } = await start();
    assert.equal(url.origin, "https://login.microsoftonline.com");
    assert.equal(url.pathname, `/${entry.authority}/oauth2/v2.0/authorize`);
    assert.equal(url.searchParams.get("scope"), `${(entry.scopes || [entry.scope]).join(" ")} offline_access`);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("response_mode"), "query");
    assert.equal(url.searchParams.has("client_secret"), false);
    const result = await service.completeAuthorization({ ...input, callbackUrl });
    assert.equal(result.status, "connected");
    assert.deepEqual(result.grantedScopes, entry.scopes || [entry.scope]);
    const grant = new URLSearchParams(requests[0].init.body);
    assert.equal(grant.get("grant_type"), "authorization_code");
    assert.equal(grant.get("client_id"), "test-client-id");
    assert.equal(grant.get("client_secret"), "test-client-secret");
    assert.ok(grant.get("code_verifier"));
    assert.equal(requests[1].url.pathname, entry.pathname);
    assert.equal(requests[1].init.method, "GET");
    assert.equal(requests[1].init.redirect, "error");
    assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer test-access-1");
    for (const filename of await readdir(directory)) {
      const text = await readFile(path.join(directory, filename), "utf8");
      for (const secret of ["test-client-secret", "test-access-1", "test-refresh-1"]) assert.equal(text.includes(secret), false);
    }
    const restarted = createConnectionService(options);
    assert.equal((await restarted.status(input)).status, "connected");
    const invocation = { ...input, operation: entry.provider.checkOperation, input: entry.input };
    assert.deepEqual(await restarted.invoke(invocation), { value: [entry.item] });
    for (const context of [{ ...owner, applicationId: "app-two" }, { ...owner, subjectId: "user-two" }]) {
      await assert.rejects(restarted.invoke({ ...invocation, context }), { code: "connector_reconnect_required" });
    }
    await restarted.disconnect(input);
    await assert.rejects(restarted.invoke(invocation), { code: "connector_reconnect_required" });
  });

  test(`${entry.provider.id}: cancellation, missing consent and malformed responses never create a usable connection`, async (t) => {
    const { service, input, start, requests, state } = await fixture(t, entry);
    const cancelled = await start();
    await service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
    assert.equal(requests.length, 0);
    state.scope = "offline_access";
    const missing = await start();
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: missing.callbackUrl }), { code: "connector_scope_missing" });
    assert.equal(requests.length, 1);
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: missing.callbackUrl }), { code: "connector_attempt_invalid" });
    state.scope = entry.scope;
    state.response = { error: { message: "test-client-secret" } };
    const malformed = await start();
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: malformed.callbackUrl }), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`${entry.provider.id}: refresh rotation survives restart and permission/rate failures do not expose credentials`, async (t) => {
    const { service, options, input, start, requests, state } = await fixture(t, entry);
    await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
    const invocation = { ...input, operation: entry.provider.checkOperation, input: entry.input };
    state.time += 40_000;
    await service.invoke(invocation);
    assert.equal(new URLSearchParams(requests[2].init.body).get("refresh_token"), "test-refresh-1");
    assert.equal(new Headers(requests[3].init.headers).get("authorization"), "Bearer test-access-2");
    const restarted = createConnectionService(options);
    state.time += 40_000;
    await restarted.invoke(invocation);
    assert.equal(new URLSearchParams(requests[4].init.body).get("refresh_token"), "test-refresh-2");
    const before = requests.length;
    await assert.rejects(restarted.invoke({ ...invocation, input: { ...entry.input, arbitrary: true } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, before);
    for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [401, "connector_reconnect_required"]]) {
      state.status = status;
      state.response = { error: { message: "test-client-secret" } };
      await assert.rejects(restarted.invoke(invocation), (error) => {
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes("test-client-secret"), false);
        return true;
      });
    }
    assert.equal((await restarted.status(input)).status, "reconnect-required");
  });

  test(`${entry.provider.id}: paging keeps the opaque link and blocks another origin, user or resource`, async (t) => {
    const { service, input, start, requests, state } = await fixture(t, entry);
    const nextLink = `https://graph.microsoft.com${entry.pathname}?$skiptoken=opaque%2Btoken%3D&$top=2`;
    state.response = { value: [entry.item], "@odata.nextLink": nextLink };
    await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
    const invocation = { ...input, operation: entry.provider.checkOperation, input: entry.input };
    assert.equal((await service.invoke(invocation))["@odata.nextLink"], nextLink);
    state.response = { value: [] };
    assert.deepEqual(await service.invoke({ ...invocation, input: { ...entry.input, nextLink } }), { value: [] });
    assert.equal(requests.at(-1).url.href, nextLink);
    const before = requests.length;
    for (const malicious of [
      "https://attacker.example/steal", "http://graph.microsoft.com/v1.0/me",
      "https://graph.microsoft.com/v1.0/users/other/mailFolders", "https://graph.microsoft.com/v1.0/me/messages",
      `https://user@graph.microsoft.com${entry.pathname}`, `${nextLink}#fragment`, "not a URL"
    ]) {
      await assert.rejects(service.invoke({ ...invocation, input: { ...entry.input, nextLink: malicious } }), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, before);
  });
}

test("resource verification requires site search; worksheet operations validate workbook IDs", async (t) => {
  for (const entry of [cases[5]]) {
    const { service, input, requests } = await fixture(t, entry);
    await assert.rejects(service.beginAuthorization(input), (error) => Boolean(error.fieldErrors));
    assert.equal(requests.length, 0);
  }
  for (const itemId of ["../other", "a/b", "https://example.com/workbook.xlsx", "..", "file?search=oops"]) {
    assert.throws(() => microsoftExcelProvider.operations["worksheets.list"].request({ itemId }), (error) => Boolean(error.fieldErrors));
  }
});

test("Microsoft fragments use bounded page sizes, basic mail fields and Teams' supported request shape", () => {
  const inbox = new URL(microsoftOutlookProvider.operations["inbox.list"].request({ pageSize: 10 }).url);
  assert.equal(inbox.pathname, "/v1.0/me/mailFolders/inbox/messages");
  assert.equal(inbox.searchParams.get("$top"), "10");
  assert.equal(inbox.searchParams.get("$select"), "id,subject,from,receivedDateTime,isRead");
  assert.equal(new URL(microsoftTeamsProvider.operations["teams.list"].request({}).url).search, "");
  assert.throws(() => microsoftTeamsProvider.operations["teams.list"].request({ pageSize: 10 }), (error) => Boolean(error.fieldErrors));
  assert.equal(new URL(microsoftSharePointProvider.operations["sites.search"].request({ search: "A & B" }).url).searchParams.get("search"), "A & B");
  for (const provider of [microsoftOutlookProvider, microsoftOneDriveProvider]) {
    assert.equal(new URL(provider.operations[provider.checkOperation].request({}).url).searchParams.get("$top"), "25");
    for (const pageSize of [0, 101]) assert.throws(() => provider.operations[provider.checkOperation].request({ pageSize }), (error) => Boolean(error.fieldErrors));
  }
  assert.equal(new URL(microsoftOutlookProvider.operations["folders.list"].request({}).url).searchParams.get("includeHiddenFolders"), "false");
});

const directoryId = "11111111-2222-3333-4444-555555555555";

test("Microsoft tenant configuration validates audiences before constructing any provider URL", async (t) => {
  for (const entry of cases) {
    const { options, requests } = await fixture(t, entry);
    const parse = (tenantId) => {
      const config = structuredClone(options.configuration);
      if (tenantId !== undefined) config.integrations.service.settings = { tenantId };
      return parseIntegrationConfiguration(JSON.stringify(config), { providers: [entry.provider] }).integrations.service;
    };
    assert.equal(parse().settings.tenantId, entry.authority);
    const allowed = entry.authority === "organizations" ? ["organizations", directoryId] : ["common", "organizations", "consumers", directoryId];
    for (const tenantId of allowed) assert.equal(parse(tenantId).settings.tenantId, tenantId);
    const invalid = ["", "../common", "https://attacker.example", "directory.example.com", "common?x=1", "organizations/other", "bad-guid"];
    if (entry.authority === "organizations") invalid.push("common", "consumers");
    for (const tenantId of invalid) assert.throws(() => parse(tenantId));
    assert.equal(requests.length, 0);
  }
});

for (const [base, tenantId] of [[cases[6], directoryId], [cases[7], "consumers"]]) {
  test(`${base.provider.id}: selected tenant owns both authorization and refresh endpoints`, async (t) => {
    const entry = { ...base, tenantId, authority: tenantId };
    const { service, options, input, start, requests, state } = await fixture(t, entry);
    const begun = await start();
    assert.equal(begun.url.pathname, `/${tenantId}/oauth2/v2.0/authorize`);
    await service.completeAuthorization({ ...input, callbackUrl: begun.callbackUrl });
    state.time += 40_000;
    await createConnectionService(options).invoke({ ...input, operation: "items.list" });
    const tokenRequests = requests.filter(({ url }) => url.hostname === "login.microsoftonline.com");
    assert.equal(tokenRequests.length, 2);
    assert.equal(new URLSearchParams(tokenRequests[1].init.body).get("refresh_token"), "test-refresh-1");
    assert(tokenRequests.every(({ url }) => url.pathname === `/${tenantId}/oauth2/v2.0/token`));
  });
}

test("Microsoft tenant changes invalidate pending consent and stored grants before network access", async (t) => {
  for (const entry of cases) {
    const { service, options, input, start, requests } = await fixture(t, entry);
    await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
    const pending = await start();
    const configuration = structuredClone(options.configuration);
    configuration.integrations.service.settings = { tenantId: directoryId };
    const changed = createConnectionService({ ...options, configuration });
    const before = requests.length;
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: entry.provider.checkOperation, input: entry.input }), { code: "connector_reconnect_required" });
    await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
    assert.equal(requests.length, before);
  }
});

for (const entry of cases.slice(6)) {
  test(`${entry.provider.id}: filters file pages, preserves empty-page cursors and browses folders and metadata`, async (t) => {
    const { service, input, start, requests, state } = await fixture(t, entry);
    const folder = { id: "folder-id", name: "Quarterly reports", folder: { childCount: 2 } };
    const unrelated = { id: "image-id", name: "Photo.jpg", file: {} };
    const nextLink = `https://graph.microsoft.com${entry.pathname}?$skiptoken=next%2Bpage`;
    state.response = { value: [unrelated], "@odata.nextLink": nextLink };
    await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
    const list = { ...input, operation: "items.list" };
    assert.deepEqual(await service.invoke(list), { value: [], "@odata.nextLink": nextLink });
    state.response = { value: [entry.item, folder, unrelated] };
    assert.deepEqual(await service.invoke({ ...list, input: { nextLink } }), { value: [entry.item, folder] });
    assert.equal(requests.at(-1).url.href, nextLink);
    await service.invoke({ ...list, input: { folderId: folder.id, pageSize: 5 } });
    assert.equal(requests.at(-1).url.pathname, "/v1.0/me/drive/items/folder-id/children");
    assert.equal(requests.at(-1).url.searchParams.get("$top"), "5");
    const before = requests.length;
    for (const bad of [{ folderId: folder.id, nextLink }, { pageSize: 0 }, { pageSize: 101 }, { folderId: "../other" }]) {
      await assert.rejects(service.invoke({ ...list, input: bad }), { code: "connector_input_invalid" });
    }
    for (const itemId of [undefined, "../other", "file?x=1", "https://example.com/file.docx"]) {
      await assert.rejects(service.invoke({ ...input, operation: "items.get", input: { itemId } }), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, before);
    state.response = entry.item;
    assert.deepEqual(await service.invoke({ ...input, operation: "items.get", input: { itemId: entry.item.id } }), entry.item);
    assert.equal(requests.at(-1).url.pathname, `/v1.0/me/drive/items/${entry.item.id}`);
    assert.equal(requests.at(-1).url.searchParams.get("$select"), "id,name,size,webUrl,file,folder,parentReference,lastModifiedDateTime,eTag");
    assert.equal(requests.at(-1).init.method, "GET");
    for (const unsupported of [unrelated, folder]) {
      state.response = unsupported;
      await assert.rejects(service.invoke({ ...input, operation: "items.get", input: { itemId: unsupported.id } }), { code: "connector_document_type_invalid" });
    }
  });

  test(`${entry.provider.id}: rejects malformed metadata and file facets without leaking provider fields`, async (t) => {
    const { service, input, start, state } = await fixture(t, entry);
    await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
    for (const malformed of [null, { id: "file" }, { ...entry.item, name: "" }, { ...entry.item, file: true }, { ...entry.item, folder: [] }]) {
      for (const operation of ["items.list", "items.get"]) {
        state.response = operation === "items.list" ? { value: [malformed] } : malformed;
        await assert.rejects(service.invoke({ ...input, operation, input: operation === "items.list" ? {} : { itemId: entry.item.id } }), { code: "connector_response_invalid" });
      }
    }
    state.response = { value: [entry.item], "@odata.nextLink": 123 };
    await assert.rejects(service.invoke({ ...input, operation: "items.list" }), { code: "connector_response_invalid" });
  });
}


test("microsoft-excel: read-only connection browses folders while worksheets require separate consent", async (t) => {
  const entry = cases[2];
  const read = await fixture(t, entry);
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await read.service.invoke({ ...read.input, operation: "items.list", input: { folderId: "folder-1", pageSize: 5 } });
  assert.equal(read.requests.at(-1).url.pathname, "/v1.0/me/drive/items/folder-1/children");
  assert.equal(read.requests.at(-1).url.searchParams.get("$top"), "5");
  const before = read.requests.length;
  await assert.rejects(read.service.invoke({ ...read.input, operation: "worksheets.list", input: { itemId: entry.item.id } }), { code: "connector_scope_missing" });
  assert.equal(read.requests.length, before);
  const workbook = await fixture(t, { ...entry, scopes: ["Files.Read", "Files.ReadWrite"] });
  await workbook.service.completeAuthorization({ ...workbook.input, callbackUrl: (await workbook.start()).callbackUrl });
  workbook.state.response = { value: [{ id: "sheet-1", name: "Sheet1", position: 0 }] };
  const invocation = { ...workbook.input, operation: "worksheets.list", input: { itemId: entry.item.id } };
  assert.deepEqual(await workbook.service.invoke(invocation), workbook.state.response);
  const pathname = "/v1.0/me/drive/items/drive!item-1/workbook/worksheets";
  assert.equal(workbook.requests.at(-1).url.pathname, pathname);
  const nextLink = `https://graph.microsoft.com${pathname}?$skiptoken=next%2Bpage`;
  await workbook.service.invoke({ ...invocation, input: { ...invocation.input, nextLink } });
  assert.equal(workbook.requests.at(-1).url.href, nextLink);
  await assert.rejects(workbook.service.invoke({ ...invocation, input: { itemId: "other-workbook", nextLink } }), { code: "connector_input_invalid" });
});

test("microsoft-excel: bounded cell reads, values/formulas and explicit persistent sessions", async (t) => {
  const entry = cases[2];
  const workbook = await fixture(t, { ...entry, scopes: ["Files.Read", "Files.ReadWrite"] });
  await workbook.service.completeAuthorization({ ...workbook.input, callbackUrl: (await workbook.start()).callbackUrl });
  const invoke = (operation, input) => workbook.service.invoke({ ...workbook.input, operation, input });
  workbook.state.response = { id: "session-1", persistChanges: true };
  assert.deepEqual(await invoke("sessions.create", { itemId: entry.item.id, persistChanges: true }), workbook.state.response);
  assert.deepEqual(JSON.parse(workbook.requests.at(-1).init.body), { persistChanges: true });
  const range = { itemId: entry.item.id, worksheetId: "Sheet 1", address: "A1:B1", sessionId: "session-1" };
  workbook.state.response = { address: "'Sheet 1'!A1:B1", values: [[2, 3]] };
  assert.deepEqual(await invoke("ranges.get", range), workbook.state.response);
  assert.equal(new Headers(workbook.requests.at(-1).init.headers).get("workbook-session-id"), "session-1");
  assert.match(decodeURIComponent(workbook.requests.at(-1).url.pathname), /worksheets\/Sheet 1\/range\(address='A1:B1'\)$/u);
  await invoke("ranges.update", { ...range, values: [[2, 3]] });
  assert.equal(workbook.requests.at(-1).init.method, "PATCH");
  assert.deepEqual(JSON.parse(workbook.requests.at(-1).init.body), { values: [[2, 3]] });
  await invoke("ranges.update", { ...range, formulas: [["=SUM(C1:C3)", null]] });
  assert.deepEqual(JSON.parse(workbook.requests.at(-1).init.body), { formulas: [["=SUM(C1:C3)", null]] });
  for (const invalid of [{ address: "A:A" }, { address: "A1:XFD1048576" }, { address: "XFE1" }, { address: "B2:A1" },
    { values: [[1]] }, { formulas: [["=1", "=2"]] }, { sessionId: "bad\r\nheader" }, { worksheetId: "../other" }]) {
    const before = workbook.requests.length;
    await assert.rejects(invoke("ranges.update", { ...range, values: [[2, 3]], ...invalid }), { code: "connector_input_invalid" });
    assert.equal(workbook.requests.length, before);
  }
  workbook.state.status = 429;
  const before = workbook.requests.length;
  await assert.rejects(invoke("ranges.update", { ...range, values: [[2, 3]] }));
  assert.equal(workbook.requests.length, before + 1);
  workbook.state.status = 200;
  workbook.state.response = {};
  await assert.rejects(invoke("ranges.get", range), { code: "connector_response_invalid" });
  workbook.state.status = 204;
  await invoke("sessions.close", { itemId: entry.item.id, sessionId: "session-1" });
  assert.ok(workbook.requests.at(-1).url.pathname.endsWith("/closeSession"));
  const read = await fixture(t, entry);
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "ranges.update", input: { ...range, values: [[2, 3]] } }), { code: "connector_scope_missing" });
});


test("microsoft-onedrive: nested browsing, private download links and bounded binary uploads", async (t) => {
  const entry = cases[1];
  const f = await fixture(t, { ...entry, scopes: ["Files.Read", "Files.ReadWrite"] });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  await invoke("items.list", { folderId: "folder-2" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1.0/me/drive/items/folder-2/children");
  f.state.response = { id: "file-2", name: "Report.txt", file: {}, "@microsoft.graph.downloadUrl": "https://storage.1drv.com/private-short-lived" };
  assert.deepEqual(await invoke("items.get", { itemId: "file-2" }), f.state.response);
  assert.ok(f.requests.at(-1).url.searchParams.get("$select").includes("@microsoft.graph.downloadUrl"));
  const data = Buffer.from([0, 255, 32, 65]);
  await invoke("files.upload", { parentId: "folder-2", name: "Report 1.bin", bodyBase64: data.toString("base64") });
  assert.equal(f.requests.at(-1).init.method, "PUT");
  assert.deepEqual(Buffer.from(f.requests.at(-1).init.body), data);
  assert.equal(f.requests.at(-1).url.searchParams.get("@microsoft.graph.conflictBehavior"), "fail");
  assert.ok(f.requests.at(-1).url.pathname.endsWith(":/Report%201.bin:/content"));
  for (const extra of [{ name: "../other" }, { bodyBase64: "wrong%%%" }, { parentId: "../../other" }, { conflictBehavior: "delete" }]) {
    const before = f.requests.length;
    await assert.rejects(invoke("files.upload", { parentId: "folder-2", name: "report.bin", bodyBase64: data.toString("base64"), ...extra }), { code: "connector_input_invalid" });
    assert.equal(f.requests.length, before);
  }
  f.state.response = { id: "file-2", name: "Report", "@microsoft.graph.downloadUrl": "javascript:alert(1)" };
  await assert.rejects(invoke("items.get", { itemId: "file-2" }), { code: "connector_response_invalid" });
  f.state.status = 409;
  const before = f.requests.length;
  await assert.rejects(invoke("files.upload", { parentId: "folder-2", name: "report.bin", bodyBase64: data.toString("base64") }));
  assert.equal(f.requests.length, before + 1);
  const read = await fixture(t, entry);
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "files.upload", input: { parentId: "folder-2", name: "report.bin", bodyBase64: "AA==" } }), { code: "connector_scope_missing" });
});


test("microsoft-onenote: traverses pages, reads HTML and creates/appends escaped text", async (t) => {
  const entry = cases[4];
  const f = await fixture(t, { ...entry, scopes: ["Notes.Read", "Notes.Create", "Notes.ReadWrite"] });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  f.state.response = { value: [{ id: "section:1", displayName: "Notes" }] };
  await invoke("sections.list", { notebookId: "notebook:1" });
  assert.ok(f.requests.at(-1).url.pathname.endsWith("/notebooks/notebook%3A1/sections"));
  f.state.response = { value: [{ id: "page:1", title: "Note" }] };
  await invoke("pages.list", { sectionId: "section:1", pageSize: 5 });
  assert.equal(f.requests.at(-1).url.searchParams.get("$top"), "5");
  f.state.response = "<html><body><p id='p1'>Existing note</p></body></html>";
  assert.deepEqual(await invoke("pages.content", { pageId: "page:1" }), { html: f.state.response });
  assert.equal(f.requests.at(-1).url.searchParams.get("includeIDs"), "true");
  f.state.response = { id: "new-page" };
  await invoke("pages.create", { sectionId: "section:1", title: "Budget <2026>", text: "A & B <script>" });
  assert.equal(new Headers(f.requests.at(-1).init.headers).get("content-type"), "text/html");
  assert.ok(f.requests.at(-1).init.body.includes("Budget &lt;2026&gt;"));
  assert.ok(f.requests.at(-1).init.body.includes("A &amp; B &lt;script&gt;"));
  f.state.status = 204;
  await invoke("pages.append", { pageId: "page:1", text: "Update <img>" });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), [{ target: "body", action: "append", content: "<p>Update &lt;img&gt;</p>" }]);
  const before = f.requests.length;
  await assert.rejects(invoke("pages.append", { pageId: "../../other", text: "No" }), { code: "connector_input_invalid" });
  assert.equal(f.requests.length, before);
  f.state.status = 200; f.state.response = "x".repeat(1048577);
  await assert.rejects(invoke("pages.content", { pageId: "page:1" }), { code: "connector_response_too_large" });
  f.state.status = 429; f.state.response = {};
  const count = f.requests.length;
  await assert.rejects(invoke("pages.append", { pageId: "page:1", text: "No replay" }));
  assert.equal(f.requests.length, count + 1);
  const read = await fixture(t, entry);
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "pages.create", input: { sectionId: "section:1", title: "No", text: "No" } }), { code: "connector_scope_missing" });
});


test("microsoft-outlook: body and file reads, approved send/move/read actions and calendar appointments", async (t) => {
  const entry = cases[0];
  const f = await fixture(t, { ...entry, scopes: ["Mail.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite"] });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  f.state.response = { id: "msg=1", body: { contentType: "text", content: "Receipt" } };
  await invoke("messages.get", { messageId: "msg=1" });
  assert.equal(new Headers(f.requests.at(-1).init.headers).get("prefer"), 'outlook.body-content-type="text"');
  f.state.response = { value: [{ id: "file=1", name: "receipt.txt" }] };
  await invoke("attachments.list", { messageId: "msg=1" });
  f.state.response = { id: "file=1", "@odata.type": "#microsoft.graph.fileAttachment", contentBytes: "SGk=" };
  assert.equal((await invoke("attachments.get", { messageId: "msg=1", attachmentId: "file=1" })).contentBytes, "SGk=");
  f.state.response = { id: "msg=1", isRead: true };
  await invoke("messages.setRead", { messageId: "msg=1", isRead: true });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { isRead: true });
  await invoke("messages.move", { messageId: "msg=1", destinationId: "archive" });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { destinationId: "archive" });
  f.state.status = 202;
  assert.deepEqual(await invoke("messages.send", { subject: "Receipt", text: "Thank you", to: ["customer@example.com"] }), { accepted: true });
  const sent = JSON.parse(f.requests.at(-1).init.body);
  assert.deepEqual(sent.message.toRecipients, [{ emailAddress: { address: "customer@example.com" } }]);
  assert.equal(sent.message.body.contentType, "Text"); assert.equal(sent.saveToSentItems, true); assert.equal(sent.message.from, undefined);
  f.state.status = 200; f.state.response = { value: [{ id: "calendar=1" }] };
  await invoke("calendars.list", {});
  await invoke("events.list", { calendarId: "calendar=1", pageSize: 5 });
  f.state.response = { id: "event=1" };
  const event = { calendarId: "calendar=1", subject: "Grooming", start: "2026-09-20T10:00:00Z", end: "2026-09-20T11:00:00Z" };
  await invoke("events.create", event);
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body).start, { dateTime: "2026-09-20T10:00:00", timeZone: "UTC" });
  assert.equal(JSON.parse(f.requests.at(-1).init.body).attendees, undefined);
  const before = f.requests.length;
  await assert.rejects(invoke("events.create", { ...event, end: event.start }), { code: "connector_input_invalid" });
  await assert.rejects(invoke("messages.send", { subject: "No", text: "No", to: ["bad\r\naddress"] }), { code: "connector_input_invalid" });
  await assert.rejects(invoke("messages.get", { messageId: "../../other" }), { code: "connector_input_invalid" });
  assert.equal(f.requests.length, before);
  f.state.status = 429;
  await assert.rejects(invoke("messages.send", { subject: "No replay", text: "No", to: ["customer@example.com"] }));
  assert.equal(f.requests.length, before + 1);
  const read = await fixture(t, entry);
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "messages.send", input: { subject: "No", text: "No", to: ["customer@example.com"] } }), { code: "connector_scope_missing" });
});

test("microsoft-sharepoint: navigates libraries, transfers files and edits list fields with ETag", async (t) => {
  const entry = cases[5];
  const f = await fixture(t, { ...entry, scopes: ["Sites.Read.All", "User.Read", "Sites.ReadWrite.All"] });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  const siteId = "tenant.sharepoint.com,site-guid,web-guid";
  f.state.response = { value: [{ id: "drive-1", name: "Documents" }] };
  await invoke("libraries.list", { siteId });
  assert.ok(decodeURIComponent(f.requests.at(-1).url.pathname).endsWith(`/sites/${siteId}/drives`));
  await invoke("files.list", { driveId: "drive-1", folderId: "folder-1" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1.0/drives/drive-1/items/folder-1/children");
  f.state.response = { id: "file-1", name: "Report.txt", "@microsoft.graph.downloadUrl": "https://tenant.sharepoint.com/private-link" };
  await invoke("files.get", { driveId: "drive-1", itemId: "file-1" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1.0/drives/drive-1/items/file-1");
  await invoke("files.upload", { driveId: "drive-1", parentId: "folder-1", name: "Report.txt", bodyBase64: "SGk=" });
  assert.equal(f.requests.at(-1).init.method, "PUT");
  assert.equal(Buffer.from(f.requests.at(-1).init.body).toString(), "Hi");
  f.state.response = { value: [{ id: "list-1" }] };
  await invoke("lists.list", { siteId });
  await invoke("listItems.list", { siteId, listId: "list-1" });
  assert.equal(f.requests.at(-1).url.searchParams.get("$expand"), "fields");
  f.state.response = { id: "item-1" };
  await invoke("listItems.create", { siteId, listId: "list-1", fields: { Title: "Report", Count: 3 } });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { fields: { Title: "Report", Count: 3 } });
  f.state.response = { Title: "Updated" };
  const update = { siteId, listId: "list-1", itemId: "item-1", fields: { Title: "Updated" }, eTag: '"version-1"' };
  await invoke("listItems.update", update);
  assert.equal(new Headers(f.requests.at(-1).init.headers).get("if-match"), '"version-1"');
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { Title: "Updated" });
  const before = f.requests.length;
  for (const patch of [{ eTag: "*" }, { siteId: "https://other.test" }, { fields: {} }, { fields: { Nested: { value: 1 } } }]) {
    await assert.rejects(invoke("listItems.update", { ...update, ...patch }), { code: "connector_input_invalid" });
  }
  assert.equal(f.requests.length, before);
  f.state.status = 412;
  await assert.rejects(invoke("listItems.update", update));
  assert.equal(f.requests.length, before + 1);
  const read = await fixture(t, entry);
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "listItems.update", input: update }), { code: "connector_scope_missing" });
  assert.equal(microsoftSharePointProvider.operations["sites.create"], undefined);
});

test("microsoft-teams: channels, replies and existing chats use separate read/send grants", async (t) => {
  const entry = cases[3];
  const f = await fixture(t, { ...entry, scopes: [...entry.scopes, "ChannelMessage.Read.All", "ChannelMessage.Send", "Chat.ReadWrite"] });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  const channel = { teamId: "team-1", channelId: "19:channel@thread.tacv2" };
  f.state.response = { value: [{ id: channel.channelId }] };
  await invoke("channels.list", { teamId: channel.teamId });
  await invoke("messages.list", { ...channel, pageSize: 10 });
  assert.ok(decodeURIComponent(f.requests.at(-1).url.pathname).endsWith(`/teams/team-1/channels/${channel.channelId}/messages`));
  assert.equal(f.requests.at(-1).url.searchParams.get("$top"), "10");
  await invoke("replies.list", { ...channel, messageId: "12345" });
  assert.ok(f.requests.at(-1).url.pathname.endsWith("/messages/12345/replies"));
  f.state.response = { id: "12346" };
  await invoke("messages.send", { ...channel, text: "Approved update" });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { body: { contentType: "text", content: "Approved update" } });
  await invoke("replies.send", { ...channel, messageId: "12345", text: "Reply" });
  assert.ok(f.requests.at(-1).url.pathname.endsWith("/messages/12345/replies"));
  f.state.response = { value: [{ id: "19:chat@thread.v2" }] };
  await invoke("chats.list", {});
  await invoke("chatMessages.list", { chatId: "19:chat@thread.v2" });
  f.state.response = { id: "12347" };
  await invoke("chatMessages.send", { chatId: "19:chat@thread.v2", text: "Approved chat" });
  assert.ok(decodeURIComponent(f.requests.at(-1).url.pathname).endsWith("/chats/19:chat@thread.v2/messages"));
  const before = f.requests.length;
  await assert.rejects(invoke("messages.send", { ...channel, channelId: "../../other", text: "No" }), { code: "connector_input_invalid" });
  assert.equal(f.requests.length, before);
  f.state.status = 429;
  await assert.rejects(invoke("messages.send", { ...channel, text: "No replay" }));
  assert.equal(f.requests.length, before + 1);
  const basic = await fixture(t, entry);
  await basic.service.completeAuthorization({ ...basic.input, callbackUrl: (await basic.start()).callbackUrl });
  for (const operation of ["messages.list", "messages.send"]) await assert.rejects(basic.service.invoke({ ...basic.input, operation, input: { ...channel, ...(operation.endsWith("send") ? { text: "No" } : {}) } }), { code: "connector_scope_missing" });
  assert.equal(microsoftTeamsProvider.operations["teams.create"], undefined);
});
