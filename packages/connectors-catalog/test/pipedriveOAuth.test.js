import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipedriveProvider } from "../src/server/pipedrive.js";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";

async function fixture(t, fetchImpl) {
  const directory = await mkdtemp(join(tmpdir(), "pipedrive-oauth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  let now = Date.now();
  const callback = "https://app.example/integrations/pipedrive/callback";
  const configuration = { schemaVersion: 1, registrations: { crm: { source: "own", clientId: "client-id",
    tokenEndpointAuthMethod: "client_secret_basic", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } },
    integrations: { crm: { provider: "pipedrive", accountMode: "per-user", scopes: [],
      authentication: { method: "oauth2", registrationRef: "crm" } } } };
  const service = () => createConnectionService({ configuration, providers: [pipedriveProvider],
    store: createFileConnectionStore({ directory, protection }), authorize: async (owner) => owner,
    now: () => now, resolveReference: async (ref) => ref === "env:SECRET" ? "private-secret" : callback, fetchImpl });
  const input = (subjectId) => ({ context: { applicationId: "app", subjectId }, integrationId: "crm" });
  async function connect(subjectId) {
    const runtime = service();
    const start = await runtime.beginAuthorization(input(subjectId));
    const url = new URL(start.authorizationUrl);
    assert.equal(url.origin + url.pathname, "https://oauth.pipedrive.com/oauth/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), callback);
    assert.equal(url.searchParams.has("code_challenge"), false);
    return { runtime, completion: { ...input(subjectId), callbackUrl: `${callback}?code=${subjectId}&state=${url.searchParams.get("state")}` } };
  }
  return { service, input, connect, callback, advance: () => { now += 61_000; } };
}

test("Pipedrive keeps each company's OAuth route and rotated tokens across restarts", async (t) => {
  const requests = [];
  const rotations = { alice: 0, bob: 0 };
  const f = await fixture(t, async (address, init) => {
    const url = new URL(address);
    const headers = new Headers(init.headers);
    if (url.origin === "https://oauth.pipedrive.com") {
      assert.equal(url.pathname, "/oauth/token");
      assert.match(headers.get("content-type"), /^application\/x-www-form-urlencoded/);
      assert.equal(headers.get("authorization"), `Basic ${Buffer.from("client-id:private-secret").toString("base64")}`);
      const body = new URLSearchParams(init.body);
      const subject = body.get("code") || body.get("refresh_token").split(":")[0];
      assert.equal(body.has("client_secret"), false);
      assert.equal(body.has("code_verifier"), false);
      if (body.get("grant_type") === "authorization_code") assert.equal(body.get("redirect_uri"), f.callback);
      else assert.equal(body.get("refresh_token"), `${subject}:${rotations[subject]}`);
      rotations[subject]++;
      return Response.json({ token_type: "bearer", access_token: `${subject}:${rotations[subject]}`,
        refresh_token: `${subject}:${rotations[subject]}`, expires_in: 60, scope: "base",
        api_domain: `https://${subject}.pipedrive.com` });
    }
    const subject = url.hostname.split(".")[0];
    assert.ok(Object.hasOwn(rotations, subject));
    assert.equal(url.pathname, "/api/v1/users/me");
    assert.equal(headers.get("authorization"), `Bearer ${subject}:${rotations[subject]}`);
    assert.equal(headers.has("x-api-token"), false);
    requests.push(subject);
    return Response.json({ success: true, data: { id: subject === "alice" ? 1 : 2 } });
  });
  for (const subject of ["alice", "bob"]) {
    const { runtime, completion } = await f.connect(subject);
    const result = await runtime.completeAuthorization(completion);
    assert.equal(result.status, "connected");
    assert.equal(result.providerData, undefined);
    await assert.rejects(runtime.completeAuthorization(completion));
  }
  for (let i = 0; i < 2; i++) {
    f.advance();
    for (const subject of ["alice", "bob"]) {
      await f.service().invoke({ ...f.input(subject), operation: "profile.read", input: {} });
    }
  }
  assert.deepEqual(rotations, { alice: 3, bob: 3 });
  assert.deepEqual(requests, ["alice", "bob", "alice", "bob", "alice", "bob"]);
  await assert.rejects(f.service().invoke({ ...f.input("eve"), operation: "profile.read", input: {} }));
});

test("Pipedrive rejects missing or foreign company addresses before sending bearer credentials", async (t) => {
  for (const api_domain of [undefined, "https://evil.example", "https://alice.pipedrive.com.evil.example", "https://alice.pipedrive.com/path", "http://alice.pipedrive.com", "https://user@alice.pipedrive.com", "https://alice.pipedrive.com:443"]) {
    let requests = 0;
    const f = await fixture(t, async (address) => {
      assert.equal(String(address), "https://oauth.pipedrive.com/oauth/token");
      requests++;
      return Response.json({ token_type: "bearer", access_token: "private-token", refresh_token: "refresh", api_domain });
    });
    const { runtime, completion } = await f.connect("alice");
    await assert.rejects(runtime.completeAuthorization(completion), { code: "connector_response_invalid" });
    await assert.rejects(runtime.completeAuthorization(completion));
    await assert.rejects(runtime.invoke({ ...f.input("alice"), operation: "profile.read", input: {} }));
    assert.equal(requests, 1);
  }
});

test("Pipedrive requires reconnection if refresh changes the company destination", async (t) => {
  let exchanges = 0;
  let apiRequests = 0;
  const f = await fixture(t, async (address) => {
    if (String(address) === "https://oauth.pipedrive.com/oauth/token") {
      exchanges++;
      return Response.json({ token_type: "bearer", access_token: "private-token", refresh_token: "refresh", expires_in: 60,
        api_domain: `https://${exchanges === 1 ? "alice" : "other"}.pipedrive.com` });
    }
    apiRequests++;
    return Response.json({ success: true, data: { id: 1 } });
  });
  const { runtime, completion } = await f.connect("alice");
  await runtime.completeAuthorization(completion);
  f.advance();
  await assert.rejects(f.service().invoke({ ...f.input("alice"), operation: "profile.read", input: {} }), { code: "connector_reconnect_required" });
  assert.equal(apiRequests, 1);
  assert.equal((await f.service().status(f.input("alice"))).status, "reconnect-required");
});

test("Pipedrive CRM calls cannot escape the company bound to each OAuth grant", async t => {
  const seen = [];
  const f = await fixture(t, async (address, init) => {
    const url = new URL(address);
    if (url.origin === "https://oauth.pipedrive.com") {
      const subject = new URLSearchParams(init.body).get("code");
      return Response.json({ token_type: "bearer", access_token: subject, refresh_token: subject, expires_in: 3600, api_domain: `https://${subject}.pipedrive.com` });
    }
    const subject = url.hostname.split(".")[0];
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${subject}`);
    if (url.pathname === "/api/v1/users/me") return Response.json({ success: true, data: { id: 1 } });
    seen.push({ subject, path: url.pathname, body: init.body });
    return Response.json({ success: true, data: { id: 2, title: "New lead" } });
  });
  for (const subject of ["alice", "bob"]) {
    const { runtime, completion } = await f.connect(subject); await runtime.completeAuthorization(completion);
    await f.service().invoke({ ...f.input(subject), operation: "deals.create", input: { title: "New lead" } });
  }
  assert.deepEqual(seen.map(x => [x.subject, x.path]), [["alice", "/api/v2/deals"], ["bob", "/api/v2/deals"]]);
  await assert.rejects(f.service().invoke({ ...f.input("eve"), operation: "deals.get", input: { id: 2 } }), { code: "connector_reconnect_required" });
  assert.equal(seen.length, 2);
});
