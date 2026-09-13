import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { hubspotProvider } from "../src/server/hubspot.js";

for (const perUser of [false, true]) test(`HubSpot OAuth ${perUser ? "per-user" : "shared rotating"} grants preserve protocol and ownership`, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "hubspot-oauth-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const callback = "https://example.test/integrations/hubspot/callback";
  const context = { applicationId: "app", subjectId: "owner" };
  const input = { context, integrationId: "hubspot" };
  let time = Date.now(), exchanges = 0;
  let tokenScope = "oauth crm.objects.contacts.read", apiStatus = 200;
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: { hubspot: { source: "own", clientId: "client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK", tokenEndpointAuthMethod: "client_secret_post" } }, integrations: {
      hubspot: { provider: "hubspot", accountMode: perUser ? "per-user" : "shared", scopes: ["oauth", "crm.objects.contacts.read"], authentication: { method: "oauth2", registrationRef: "hubspot" } },
      personal: { provider: "hubspot", accountMode: "shared", scopes: ["oauth", "crm.objects.contacts.read"], authentication: { method: "api-key", secretRef: "env:TOKEN" } }
    } }, providers: [hubspotProvider], authorize: async owner => owner,
    store: createFileConnectionStore({ directory, protection }), now: () => time,
    resolveReference: async ref => ref === "env:CALLBACK" ? callback : ref === "env:TOKEN" ? "personal" : "secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)), headers = new Headers(init.headers);
      if (url.pathname === "/oauth/2026-09/token") {
        assert.equal(url.origin, "https://api.hubspot.com");
        assert.equal(headers.get("accept"), "application/json");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_secret"), "secret");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback);
          assert.equal(body.has("code_verifier"), false);
        } else {
          assert.equal(body.get("refresh_token"), `refresh-${exchanges}`);
          assert.equal(body.has("redirect_uri"), false);
        }
        exchanges++;
        return Response.json({ access_token: `access-${exchanges}`, refresh_token: `refresh-${exchanges}`, token_type: "Bearer", expires_in: 60, scopes: tokenScope.split(" ") });
      }
      assert.equal(url.origin, "https://api.hubapi.com");
      assert.equal(url.pathname, "/crm/objects/2026-09/contacts");
      assert.ok(headers.get("authorization") === `Bearer access-${exchanges}` || headers.get("authorization") === "Bearer personal");
      if (apiStatus !== 200) return Response.json({ message: "private provider detail" }, { status: apiStatus });
      return Response.json({ results: [{ id: "123" }] });
    }
  };
  const service = createConnectionService(options);
  for (const outcome of ["cancel", "denied"]) {
    const attempt = new URL((await service.beginAuthorization(input)).authorizationUrl);
    const denied = new URL(callback);
    denied.searchParams.set("state", attempt.searchParams.get("state"));
    if (outcome === "cancel") {
      await service.cancelAuthorization({ ...input, state: attempt.searchParams.get("state") });
      denied.searchParams.set("code", "unused");
    } else denied.searchParams.set("error", "access_denied");
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: denied.href }), {
      code: outcome === "cancel" ? "connector_attempt_invalid" : "connector_consent_denied"
    });
  }
  assert.equal(exchanges, 0);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://app.hubspot.com/oauth/authorize");
  assert.equal(url.searchParams.has("code_challenge_method"), false);
  assert.equal(url.searchParams.get("scope"), "oauth crm.objects.contacts.read");
  const returned = new URL(callback);
  returned.searchParams.set("code", "code");
  returned.searchParams.set("state", url.searchParams.get("state"));
  assert.equal((await service.completeAuthorization({ ...input, callbackUrl: returned.href })).status, "connected");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: returned.href }), { code: "connector_attempt_invalid" });
  time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "contacts.list" }), service.invoke({ ...input, operation: "contacts.list" })]);
  assert.equal(exchanges, 2);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  time += 40_000;
  await restarted.invoke({ ...input, operation: "contacts.list" });
  assert.equal(exchanges, 3);
  assert.equal((await restarted.connectApiKey({ context, integrationId: "personal" })).status, "connected");
  const otherApp = { context: { ...context, applicationId: "another-app" }, integrationId: "hubspot" };
  assert.equal((await restarted.status(otherApp)).status, "disconnected");
  if (perUser) {
    const otherUser = { context: { ...context, subjectId: "another-user" }, integrationId: "hubspot" };
    assert.equal((await restarted.status(otherUser)).status, "disconnected");
    await assert.rejects(restarted.invoke({ ...otherUser, operation: "contacts.list" }));
    assert.equal((await restarted.status(input)).status, "connected");
  }
  tokenScope = "oauth";
  time += 40_000;
  await assert.rejects(restarted.invoke({ ...input, operation: "contacts.list" }), { code: "connector_scope_missing" });
  await restarted.disconnect(input);
  assert.equal((await restarted.status(input)).status, "disconnected");
});

test("HubSpot rejects malformed permission grants and preserves OAuth errors", async () => {
  for (const scopes of [undefined, "oauth", [42], ["bad scope"]]) {
    await assert.rejects(hubspotProvider.normalizeTokenResponse(Response.json({ access_token: "secret", scopes })), { code: "connector_response_invalid" });
  }
  const failure = Response.json({ error: "invalid_grant" }, { status: 400 });
  assert.equal(await hubspotProvider.normalizeTokenResponse(failure), failure);
});
