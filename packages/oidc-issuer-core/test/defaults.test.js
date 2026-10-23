import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  authorizationUrl,
  createAccount,
  createBrowser,
  redeemCode,
  registerApp,
  signInThroughHub,
  verifyIdToken
} from "./support/browser.js";
import { startHub } from "./support/hub.js";

const EMAIL = "ada@example.test";
const PASSWORD = "correct horse battery staple";
let hub;
let client;

before(async () => {
  hub = await startHub();
  client = (await registerApp(hub.url)).body;
  await createAccount(createBrowser(), hub.url, { email: EMAIL, password: PASSWORD });
});

after(async () => {
  await hub?.stop();
});

test("a loopback app signs in end to end and receives a verified ID token", async () => {
  const browser = createBrowser();
  const { callbackUrl, pkce } = await signInThroughHub(browser, hub.url, client, { email: EMAIL, password: PASSWORD });
  assert.equal(new URL(callbackUrl).searchParams.get("iss"), hub.url, "authorization responses carry iss (RFC 9207)");
  const { response, body } = await redeemCode(hub.url, client, callbackUrl, pkce);
  assert.equal(response.status, 200);
  const { payload, protectedHeader } = await verifyIdToken(hub.url, client, body.id_token);
  assert.equal(protectedHeader.alg, "ES256");
  assert.match(payload.sub, /^usr_/u);
  assert.equal(payload.email, EMAIL);
  assert.equal(payload.nonce, "nonce-1");
});

test("1. the development interaction screens are unreachable", async () => {
  for (const path of ["/interaction/abc", "/interaction/abc/login", "/oidc/interaction/abc"]) {
    const response = await fetch(`${hub.url}${path}`, { redirect: "manual" });
    assert.equal(response.status, 404, path);
  }
});

test("2. an authorization request without code_challenge is rejected", async () => {
  const { url } = authorizationUrl(hub.url, client, { omitPkce: true });
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location") || "";
  assert.match(location, /error=invalid_request/u);
  assert.match(decodeURIComponent(location), /PKCE/u);
});

test("3. a code issued before a hub restart is still redeemable", async () => {
  const browser = createBrowser();
  const { callbackUrl, pkce } = await signInThroughHub(browser, hub.url, client, { email: EMAIL, password: PASSWORD });
  hub = await hub.restart();
  const { response, body } = await redeemCode(hub.url, client, callbackUrl, pkce);
  assert.equal(response.status, 200);
  assert.ok(body.id_token);
});

test("4. the issuer comes from APP_PUBLIC_URL, not from a spoofed X-Forwarded-Host", async () => {
  const response = await fetch(`${hub.url}/.well-known/openid-configuration`, {
    headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", host: "evil.example" }
  });
  const discovery = await response.json();
  assert.equal(discovery.issuer, hub.url);
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "registration_endpoint"]) {
    assert.ok(discovery[key].startsWith(`${hub.url}/oidc/`), `${key} = ${discovery[key]}`);
  }
  assert.deepEqual(discovery.response_types_supported, ["code"]);
  assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
  assert.equal(discovery.authorization_response_iss_parameter_supported, true);
  assert.equal(discovery.backchannel_logout_supported, true);
});

test("9. a redirect URI differing by a trailing slash or a query is rejected", async () => {
  for (const redirectUri of [`${client.redirect_uris[0]}/`, `${client.redirect_uris[0]}?next=1`]) {
    const { url } = authorizationUrl(hub.url, client, { redirectUri });
    const response = await fetch(url, { redirect: "manual" });
    assert.equal(response.status, 400, redirectUri);
    assert.match(await response.text(), /redirect_uri/u);
  }
});

test("10. apps receive no refresh token, even when they ask for offline access", async () => {
  const browser = createBrowser();
  const { callbackUrl, pkce } = await signInThroughHub(browser, hub.url, client, { email: EMAIL, password: PASSWORD });
  const { body } = await redeemCode(hub.url, client, callbackUrl, pkce);
  assert.equal(body.refresh_token, undefined);
  const offline = await registerApp(hub.url, { extra: { grant_types: ["authorization_code", "refresh_token"] } });
  assert.equal(offline.response.status, 400);
});

test("18. an unknown email and a wrong password get the same message", async () => {
  const browser = createBrowser();
  const unknown = await browser.api(`${hub.url}/hub/api/sign-in`, { body: { email: "nobody@example.test", password: PASSWORD } });
  const wrong = await browser.api(`${hub.url}/hub/api/sign-in`, { body: { email: EMAIL, password: "not the password" } });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await unknown.json(), await wrong.json());
});

test("state-changing hub calls need the hub's own request header", async () => {
  const response = await fetch(`${hub.url}/hub/api/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  assert.equal(response.status, 403);
});

test("11. a production hub denies framing of sign-in, admin and protocol pages", async () => {
  const production = await startHub({
    env: {
      NODE_ENV: "production",
      APP_PUBLIC_URL: "https://accounts.example.test",
      OIDC_HUB_EMAIL_FROM: "hub@example.test",
      RESEND_API_KEY: "re_test_not_real"
    }
  });
  try {
    for (const path of ["/auth/sign-in", "/admin/apps", "/hub/api/session", "/oidc/auth"]) {
      const response = await fetch(`http://127.0.0.1:${production.port}${path}`, { redirect: "manual" });
      assert.equal(response.headers.get("x-frame-options"), "DENY", path);
      assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'", path);
    }
  } finally {
    await production.stop();
  }
});
