import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { workdayProvider } from "../src/server/workday.js";

const context = { applicationId: "app-one", subjectId: "user-one" };
const args = { context, integrationId: "workday" };
const callback = "https://app.example.test/oauth/workday/callback";
const me = { id: "0123456789abcdef0123456789abcdef", descriptor: "Fixture Worker", workerId: "21005", person: { descriptor: "Fixture Person" } };

async function fixture(t, { prefix = "/ccx", version = "v1", method = "client_secret_post" } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "workday-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configuration = { schemaVersion: 1, registrations: { tenant: { source: "own", clientId: "fixture-client",
    clientSecretRef: "env:WORKDAY_SECRET", callbackUrlRef: "env:WORKDAY_CALLBACK", tokenEndpointAuthMethod: method } }, integrations: {
    workday: { provider: "workday", accountMode: "per-user", scopes: [], authentication: { method: "oauth2", registrationRef: "tenant" }, settings: {
      restApiEndpoint: `https://wd5-services1.myworkday.com${prefix}/api/${version}/acme_corp`,
      tokenEndpoint: "https://wd5-services1.myworkday.com/ccx/oauth2/acme_corp/token",
      authorizationEndpoint: "https://acme.wd5.myworkday.com/acme_corp/authorize"
    } }
  } };
  const state = { time: Date.now(), count: 0, value: undefined, status: 200, tokenPatch: {}, tokenStatus: 200, hang: false };
  const requests = [];
  const options = { configuration, providers: [{ ...workdayProvider, requestTimeoutMs: 60 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (ref) => {
      if (ref === "env:WORKDAY_SECRET") return "private-client-secret";
      assert.equal(ref, "env:WORKDAY_CALLBACK"); return callback;
    },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(9) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init }); const headers = new Headers(init.headers);
      if (url.href === configuration.integrations.workday.settings.tokenEndpoint) {
        assert.equal(init.method, "POST"); const body = new URLSearchParams(init.body);
        if (method === "client_secret_post") {
          assert.equal(body.get("client_id"), "fixture-client"); assert.equal(body.get("client_secret"), "private-client-secret");
          assert.equal(headers.has("authorization"), false);
        } else {
          const authorization = headers.get("authorization"); assert.ok(authorization.startsWith("Basic "));
          assert.equal(decodeURIComponent(Buffer.from(authorization.slice(6), "base64").toString()), "fixture-client:private-client-secret");
          assert.equal(body.has("client_secret"), false);
        }
        assert.equal(body.has("code_verifier"), false); assert.equal(body.has("scope"), false);
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback); assert.equal(body.get("code"), "private-code");
        } else {
          assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), `private-refresh-${state.count}`);
        }
        state.count++;
        return Response.json(state.tokenStatus === 200 ? { access_token: `private-access-${state.count}`, token_type: "Bearer", expires_in: 120,
          refresh_token: `private-refresh-${state.count}`, ...state.tokenPatch } : { error: "invalid_grant", message: "private-provider-error" }, { status: state.tokenStatus });
      }
      assert.equal(url.origin, "https://wd5-services1.myworkday.com"); assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.ok([`${prefix}/api/staffing/v7/acme_corp/workers`, `${prefix}/api/staffing/v7/acme_corp/workers/me`].includes(url.pathname) ||
        url.pathname.startsWith(`${prefix}/api/staffing/v7/acme_corp/supervisoryOrganizations`) ||
        url.pathname.startsWith(`${prefix}/api/absenceManagement/v5/acme_corp/`) ||
        url.pathname.startsWith("/ccx/service/customreport2/acme_corp/"));
      assert.equal(headers.get("authorization"), `Bearer private-access-${state.count}`);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      return Response.json(state.value === undefined ? url.pathname.endsWith("/me") ? me : { data: [me], total: 1 } : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization(args); const url = new URL(authorizationUrl);
    const returned = new URL(callback); returned.searchParams.set("state", url.searchParams.get("state")); returned.searchParams.set("code", "private-code");
    return { url, callbackUrl: returned.href };
  };
  const connect = async () => service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, options, service, requests, state, start, connect };
}

test("Workday confidential consent uses the tenant's distinct authorization host without PKCE or invented scopes", async (t) => {
  for (const method of ["client_secret_post", "client_secret_basic"]) {
    const f = await fixture(t, { method }); const start = await f.start(); const second = await f.start();
    assert.equal(start.url.origin + start.url.pathname, f.options.configuration.integrations.workday.settings.authorizationEndpoint);
    assert.equal(start.url.searchParams.get("response_type"), "code"); assert.equal(start.url.searchParams.get("client_id"), "fixture-client");
    assert.equal(start.url.searchParams.get("redirect_uri"), callback);
    assert.notEqual(start.url.searchParams.get("state"), second.url.searchParams.get("state"));
    for (const key of ["scope", "code_challenge", "code_challenge_method", "client_secret"]) assert.equal(start.url.searchParams.has(key), false);
    const result = await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
    assert.equal(result.status, "connected"); assert.deepEqual(result.grantedScopes, []); assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(f.requests.at(-1).url.pathname, "/ccx/api/staffing/v7/acme_corp/workers/me");
    const restarted = createConnectionService(f.options); assert.equal((await restarted.status(args)).status, "connected");
    assert.deepEqual(await restarted.invoke({ ...args, operation: "workers.me" }), me);
    for (const file of await readdir(f.directory)) {
      const value = await readFile(path.join(f.directory, file), "utf8");
      for (const secret of ["private-code", "private-client-secret", "private-access-1", "private-refresh-1"]) assert.equal(value.includes(secret), false);
    }
  }
});

test("Workday retains the configured API prefix and tenant while selecting Staffing v7", async (t) => {
  for (const prefix of ["", "/ccx"]) for (const version of ["v1", "staffing/v7"]) {
    const f = await fixture(t, { prefix, version }); await f.connect();
    await f.service.invoke({ ...args, operation: "workers.list" });
    assert.equal(f.requests.at(-1).url.pathname, `${prefix}/api/staffing/v7/acme_corp/workers`);
    assert.equal(f.requests.at(-1).url.search, "?limit=20&offset=0");
  }
});

test("Workday reads bounded worker pages and preserves optional worker data and empty results", async (t) => {
  const f = await fixture(t); await f.connect();
  const input = { limit: 100, offset: 40, search: "Fixture & 21005", includeTerminatedWorkers: true, filterByOrgVisibility: false };
  const result = await f.service.invoke({ ...args, operation: "workers.list", input }); assert.deepEqual(result, { data: [me], total: 1 });
  assert.deepEqual(Object.fromEntries(f.requests.at(-1).url.searchParams), { limit: "100", offset: "40", search: "Fixture & 21005", includeTerminatedWorkers: "true", filterByOrgVisibility: "false" });
  f.state.value = { data: [], total: 0 }; assert.deepEqual(await f.service.invoke({ ...args, operation: "workers.list" }), f.state.value);
});

test("Workday rejects invalid paging and caller endpoint or identity overrides before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { search: "" },
    { search: "a".repeat(513) }, { tenant: "other" }, { restApiEndpoint: "https://attacker.test" }, { tokenEndpoint: "https://attacker.test" }, { userId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "workers.list", input }));
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "workers.me", input: { id: "other" } }));
  const denied = createConnectionService({ ...f.options, authorize: async () => { throw new Error("Denied by host"); } });
  await assert.rejects(denied.invoke({ ...args, operation: "workers.me" }), /Denied by host/u);
  assert.equal(f.requests.length, count);
});

test("Workday binds connections and pending attempts to owner, application and all endpoint settings", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "workers.me" }), { code: "connector_reconnect_required" });
  }
  for (const change of [
    (settings) => { settings.authorizationEndpoint = "https://other.wd5.myworkday.com/acme_corp/authorize"; },
    (settings) => { settings.restApiEndpoint = settings.restApiEndpoint.replace("/v1/", "/staffing/v7/"); },
    (settings) => { for (const key of Object.keys(settings)) settings[key] = settings[key].replaceAll("acme_corp", "acme_sandbox"); },
    (settings) => { for (const key of ["restApiEndpoint", "tokenEndpoint"]) settings[key] = settings[key].replace("wd5-services1", "wd5-services2"); }
  ]) {
    const configuration = structuredClone(f.options.configuration); change(configuration.integrations.workday.settings);
    const changed = createConnectionService({ ...f.options, configuration });
    assert.equal((await changed.status(args)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...args, operation: "workers.me" }), { code: "connector_reconnect_required" });
    const start = await f.start(); await assert.rejects(changed.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  }
  assert.equal(f.requests.length, count);
});

test("Workday refreshes expiring grants, retains rotation and reports absent or revoked refresh access", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 121_000;
  await f.service.invoke({ ...args, operation: "workers.me" }); assert.equal(f.state.count, 2);
  f.state.time += 121_000; await f.service.invoke({ ...args, operation: "workers.me" }); assert.equal(f.state.count, 3);
  f.state.time += 121_000; f.state.tokenStatus = 400;
  await assert.rejects(f.service.invoke({ ...args, operation: "workers.me" }), { code: "connector_reconnect_required" });
  const short = await fixture(t); short.state.tokenPatch.refresh_token = undefined; await short.connect(); short.state.time += 121_000;
  await assert.rejects(short.service.invoke({ ...args, operation: "workers.me" }), { code: "connector_reconnect_required" }); assert.equal(short.requests.length, 2);
  const unknown = await fixture(t); unknown.state.tokenPatch.expires_in = undefined; await unknown.connect(); unknown.state.time += 86_400_000;
  await unknown.service.invoke({ ...args, operation: "workers.me" }); assert.equal(unknown.state.count, 1);
  unknown.state.status = 401; await assert.rejects(unknown.service.invoke({ ...args, operation: "workers.me" }), { code: "connector_reconnect_required" });
});

test("Workday consumes denied, cancelled, expired and replayed attempts without destroying earlier access", async (t) => {
  const f = await fixture(t); await f.connect();
  const denied = await f.start(); const url = new URL(denied.callbackUrl); url.searchParams.delete("code"); url.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: url.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.callbackUrl }), { code: "connector_attempt_invalid" });
  const cancelled = await f.start(); await f.service.cancelAuthorization({ ...args, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  const expired = await f.start(); f.state.time += 601_000;
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: expired.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected"); assert.equal(f.requests.length, 2);
});

test("Workday rejects malformed worker and page responses before marking or reporting success", async (t) => {
  for (const value of [null, {}, [], { id: "bad", descriptor: "Worker" }, { id: me.id }, { ...me, workerId: 42 }]) {
    const f = await fixture(t); f.state.value = value;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal((await f.service.status(args)).status, "disconnected");
  }
  const f = await fixture(t); await f.connect();
  for (const value of [null, {}, [], { data: [] }, { data: [], total: -1 }, { data: [{}], total: 1 }, { data: null, total: 0 },
    { data: [], total: 0, errors: [] }, { data: [], total: 0, error: "private" }, { data: Array(101).fill(me), total: 101 }, "<html>private-error</html>"]) {
    f.state.value = value; await assert.rejects(f.service.invoke({ ...args, operation: "workers.list" }), { code: "connector_response_invalid" });
  }
});

test("Workday sanitizes provider failures, aborts pending reads and disconnects locally", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    f.state.status = status; f.state.value = { error: "private-provider-error" };
    await assert.rejects(f.service.invoke({ ...args, operation: "workers.me" }), (error) => error.code === code && !error.message.includes("private"));
  }
  f.state.hang = true; const controller = new AbortController();
  const pending = f.service.invoke({ ...args, operation: "workers.me", signal: controller.signal }); setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "workers.me" }), { code: "connector_provider_timeout" });
  f.state.hang = false; await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
});

test("Workday guide and CLI share endpoint, owner, confidential-client and reference validation", async () => {
  const guide = await readFile(new URL("../docs/workday.md", import.meta.url), "utf8");
  const config = JSON.parse([...guide.matchAll(/```json\n([\s\S]*?)\n```/gu)][0][1]);
  const parse = (value) => parseIntegrationConfiguration(JSON.stringify(value), { providers: [workdayProvider] });
  assert.deepEqual(parse(config), config);
  for (const [key, values] of Object.entries({
    restApiEndpoint: ["", "http://wd5-services1.myworkday.com/ccx/api/v1/acme_corp", "https://127.0.0.1/ccx/api/v1/acme_corp", "https://wd5-services1.myworkday.com.attacker.test/ccx/api/v1/acme_corp", config.integrations.workday.settings.restApiEndpoint + "?x=1", "https://wd5-services1.myworkday.com:443/ccx/api/v1/acme_corp", "https://wd5-services1.myworkday.com/ccx/api/v1/../acme_corp"],
    tokenEndpoint: ["", "https://other.myworkday.com/ccx/oauth2/acme_corp/token", "https://wd5-services1.myworkday.com/ccx/oauth2/other/token", config.integrations.workday.settings.tokenEndpoint + "#bad"],
    authorizationEndpoint: ["", "https://attacker.test/acme_corp/authorize", "https://acme.wd5.myworkday.com/other/authorize", config.integrations.workday.settings.authorizationEndpoint + "?redirect_uri=bad"]
  })) for (const value of values) {
    const invalid = structuredClone(config); invalid.integrations.workday.settings[key] = value;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors[`integrations.workday.settings.${key}`]));
  }
  for (const [key, value] of [["clientSecretRef", "private-secret"], ["callbackUrlRef", callback], ["tokenEndpointAuthMethod", "none"], ["grantType", "client_credentials"]]) {
    const invalid = structuredClone(config); invalid.registrations["workday-tenant"][key] = value; assert.throws(() => parse(invalid));
  }
  for (const accountMode of ["shared", "assistant"]) { const invalid = structuredClone(config); invalid.integrations.workday.accountMode = accountMode; assert.throws(() => parse(invalid)); }
  const scoped = structuredClone(config); scoped.integrations.workday.scopes = ["Staffing"]; assert.throws(() => parse(scoped));
});

test("Workday organization reads retain tenant, pagination and reporting relationships under the user's grant", async (t) => {
  const f = await fixture(t); await f.connect();
  const organization = { id: "Organization_Reference_ID=engineering", descriptor: "Engineering", name: "Engineering", managers: [{ id: me.id }] };
  f.state.value = { data: [organization], total: 12 };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "organizations.list", input: { limit: 2, offset: 4, includeInactive: false } }), f.state.value);
  let url = f.requests.at(-1).url;
  assert.equal(url.pathname, "/ccx/api/staffing/v7/acme_corp/supervisoryOrganizations");
  assert.equal(url.searchParams.get("includeInactive"), "false"); assert.equal(url.searchParams.get("offset"), "4");
  f.state.value = organization;
  assert.deepEqual(await f.service.invoke({ ...args, operation: "organizations.get", input: { id: organization.id } }), organization);
  assert.equal(f.requests.at(-1).url.pathname, "/ccx/api/staffing/v7/acme_corp/supervisoryOrganizations/Organization_Reference_ID%3Dengineering");
  for (const part of ["members", "orgChart"]) {
    const record = part === "members" ? { id: me.id, descriptor: "Engineer", worker: me, businessTitle: "Engineer" } :
      { ...organization, superior: { id: "parent", descriptor: "Company" }, subordinates: [] };
    f.state.value = { data: [record], total: 1 };
    assert.deepEqual(await f.service.invoke({ ...args, operation: `organizations.${part}`, input: { id: organization.id, limit: 5, offset: 0 } }), f.state.value);
    assert.ok(f.requests.at(-1).url.pathname.endsWith(`/${part}`));
    assert.equal(f.requests.at(-1).url.searchParams.get("limit"), "5");
  }
  const count = f.requests.length;
  for (const id of ["../other", "me", "https://attacker.test", ""]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "organizations.get", input: { id } }));
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list", input: { limit: 101 } }));
  assert.equal(f.requests.length, count);
  f.state.status = 403;
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_permission_denied" });
  f.state.status = 200; f.state.value = { data: [{}], total: 1 };
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_response_invalid" });
});

test("Workday absence reads preserve balances, units and repeated request filters without changing users", async (t) => {
  const f = await fixture(t); await f.connect();
  const status = "0391102bd1b542538d996936c8fa2fa7";
  const submitted = "dd817fe688db4ac7bf84e3ef79f72948";
  f.state.value = { data: [{ quantity: 12.5, unit: { descriptor: "Hours" }, absencePlan: { id: status, descriptor: "Vacation" }, worker: me }], total: 1 };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "timeOff.balances", input: { worker: me.id, effective: "2026-09-13", limit: 5, offset: 10 } }), f.state.value);
  let url = f.requests.at(-1).url;
  assert.equal(url.pathname, "/ccx/api/absenceManagement/v5/acme_corp/balances");
  assert.equal(url.searchParams.get("worker"), me.id); assert.equal(url.searchParams.get("effective"), "2026-09-13");
  assert.equal(url.searchParams.get("offset"), "10");
  f.state.value = { data: [{ quantity: 4, unit: { descriptor: "Hours" }, status: { id: status, descriptor: "Approved" }, date: "2026-09-14", worker: me }], total: 1 };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "timeOff.details", input: { worker: me.id, fromDate: "2026-09-01", toDate: "2026-09-30", status: [status, submitted], timeOffType: [status] } }), f.state.value);
  url = f.requests.at(-1).url;
  assert.equal(url.pathname, `/ccx/api/absenceManagement/v5/acme_corp/workers/${me.id}/timeOffDetails`);
  assert.deepEqual(url.searchParams.getAll("status"), [status, submitted]); assert.equal(url.searchParams.has("worker"), false);
  f.state.value = { data: [{ id: status, descriptor: "Approved" }], total: 1 };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "timeOff.statuses" }), f.state.value);
  assert.ok(f.requests.at(-1).url.pathname.endsWith("/values/timeOff/status/"));
  const count = f.requests.length;
  for (const input of [{}, { worker: "../other" }, { worker: me.id, fromDate: "2026-02-30" }, { worker: me.id, fromDate: "2026-10-01", toDate: "2026-09-01" }, { worker: me.id, status: [] }, { worker: me.id, status: ["Approved"] }, { worker: me.id, status: Array(21).fill(status) }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "timeOff.details", input }));
  }
  assert.equal(f.requests.length, count);
  for (const operation of ["timeOff.balances", "timeOff.details"]) {
    f.state.status = 403;
    await assert.rejects(f.service.invoke({ ...args, operation, input: { worker: me.id } }), { code: "connector_permission_denied" });
    f.state.status = 200; f.state.value = { data: [], total: 0 };
    assert.deepEqual(await f.service.invoke({ ...args, operation, input: { worker: me.id } }), f.state.value);
    f.state.value = { data: [{ quantity: "unknown" }], total: 1 };
    await assert.rejects(f.service.invoke({ ...args, operation, input: { worker: me.id } }), { code: "connector_response_invalid" });
  }
});

test("Workday custom reports keep the configured tenant and preserve tenant-defined JSON fields", async (t) => {
  const f = await fixture(t); await f.connect();
  const input = { owner: "report.owner", report: "Team_Headcount", prompts: [
    { name: "Organization!WID", value: me.id }, { name: "Include_Subordinate_Organizations", value: "1" }
  ] };
  f.state.value = { Report_Entry: [{ Department: "Engineering", Headcount: "8", Custom_Field: { text: "tenant-specific" } }], ResultCountEntry: [{ ResultCount: "1" }] };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "reports.read", input }), f.state.value);
  const url = f.requests.at(-1).url;
  assert.equal(url.origin, "https://wd5-services1.myworkday.com");
  assert.equal(url.pathname, "/ccx/service/customreport2/acme_corp/report.owner/Team_Headcount");
  assert.equal(url.searchParams.get("Organization!WID"), me.id); assert.equal(url.searchParams.get("format"), "json");
  const count = f.requests.length;
  for (const patch of [{ owner: ".." }, { report: "../other" }, { report: "%2fother" }, { tenant: "other" }, { url: "https://attacker.test" },
    { prompts: [{ name: "format", value: "csv" }] }, { prompts: [{ name: "A", value: "1" }, { name: "A", value: "2" }] }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "reports.read", input: { ...input, ...patch } }));
  }
  assert.equal(f.requests.length, count);
  for (const value of [{}, { Report_Entry: null }, { Report_Entry: [null] }, { error: "private", Report_Entry: [] }]) {
    f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "reports.read", input }), { code: "connector_response_invalid" });
  }
  f.state.value = { Report_Entry: [] };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "reports.read", input }), f.state.value);
  f.state.status = 403;
  await assert.rejects(f.service.invoke({ ...args, operation: "reports.read", input }), { code: "connector_permission_denied" });
  f.state.status = 500; const before = f.requests.length;
  await assert.rejects(f.service.invoke({ ...args, operation: "reports.read", input }), { code: "connector_provider_failed" });
  assert.equal(f.requests.length, before + 1);
});
