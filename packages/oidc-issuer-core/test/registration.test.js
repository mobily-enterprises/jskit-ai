import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { registerApp } from "./support/browser.js";
import { startHub } from "./support/hub.js";

let hub;

before(async () => {
  hub = await startHub();
});

after(async () => {
  await hub?.stop();
});

test("12. registration without the token, or with a wrong one, is 401", async () => {
  assert.equal((await registerApp(hub.url, { token: "" })).response.status, 401);
  assert.equal((await registerApp(hub.url, { token: "wrong-token-wrong-token-wrong" })).response.status, 401);
});

test("12. each forbidden metadata field is rejected", async () => {
  for (const field of ["logo_uri", "jwks_uri", "sector_identifier_uri", "request_uris", "software_statement", "client_uri", "policy_uri", "tos_uri"]) {
    const value = field === "request_uris" ? ["https://shop.example.test/r"] : "https://shop.example.test/x";
    const { response, body } = await registerApp(hub.url, { extra: { [field]: value } });
    assert.equal(response.status, 400, field);
    assert.equal(body.error, "invalid_client_metadata", field);
  }
});

test("12. a multi-origin, non-https or cross-origin back-channel registration is rejected", async () => {
  const cases = [
    { redirect_uris: ["https://shop.example.test/cb", "https://other.example.test/cb"] },
    { redirect_uris: ["http://shop.example.test/cb"], post_logout_redirect_uris: ["http://shop.example.test/"], backchannel_logout_uri: "http://shop.example.test/bc" },
    { redirect_uris: ["https://shop.example.test/cb"], post_logout_redirect_uris: ["https://shop.example.test/"], backchannel_logout_uri: "https://evil.example.test/bc" },
    { redirect_uris: ["https://shop.example.test/cb#frag"] },
    { redirect_uris: ["https://user:pw@shop.example.test/cb"] }
  ];
  for (const extra of cases) {
    const { response, body } = await registerApp(hub.url, { origin: "https://shop.example.test", extra });
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.equal(body.error, "invalid_client_metadata");
  }
});

test("a long name, a different auth method or an implicit flow is rejected", async () => {
  const cases = [
    { client_name: "x".repeat(81) },
    { token_endpoint_auth_method: "none" },
    { response_types: ["code id_token"] }
  ];
  for (const extra of cases) {
    assert.equal((await registerApp(hub.url, { extra })).response.status, 400, JSON.stringify(extra));
  }
});

test("a registered app can read and update itself but cannot move to another address", async () => {
  const { body: client } = await registerApp(hub.url, { origin: "http://localhost:4200", name: "Invoices" });
  const headers = { authorization: `Bearer ${client.registration_access_token}`, "content-type": "application/json" };
  const read = await fetch(client.registration_client_uri, { headers });
  assert.equal(read.status, 200);
  const update = (redirect) => fetch(client.registration_client_uri, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      client_name: "Invoices 2",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code"],
      response_types: ["code"]
    })
  });
  const moved = await update("https://elsewhere.example.test/cb");
  assert.equal(moved.status, 400);
  const renamed = await update("http://localhost:4200/auth/callback");
  assert.equal(renamed.status, 200, await renamed.clone().text());
  const row = await hub.knex("oidc_issuer_clients").where({ client_id: client.client_id }).first();
  assert.equal(row.client_name, "Invoices 2");
});
