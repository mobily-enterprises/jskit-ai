import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { decodeJwt } from "jose";
import { BACKCHANNEL_LOGOUT_EVENT } from "../src/server/lib/backchannelLogout.js";
import { startMockIssuer } from "../test-support/mockIssuer.js";
import { APP_ORIGIN, createRelyingParty, requestAt, signInAtIssuer } from "../test-support/harness.js";

const VERIFY_FAILED = { statusCode: 401, message: "Your sign-in could not be verified. Start again." };
const ATTEMPT_MISMATCH = { statusCode: 400, message: "This sign-in took too long or started in another browser. Start again." };

// Re-signs the issuer's ID token with changed claims, as a hostile token endpoint would.
function tamperingFetch(issuer, change) {
  return async (url, options) => {
    const response = await fetch(url, options);
    if (!String(url).endsWith("/token")) return response;
    const body = await response.json();
    body.id_token = await issuer.sign({ ...decodeJwt(body.id_token), ...change });
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  };
}

async function relyingParty(t, options = {}) {
  const issuer = await startMockIssuer(options.account ? { account: options.account } : {});
  const rp = await createRelyingParty({ issuer, ...(options.change ? { fetchImpl: tamperingFetch(issuer, options.change) } : {}) });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  return { issuer, rp };
}

test("RP 6: a callback with the wrong state is rejected", async (t) => {
  const { rp } = await relyingParty(t);
  const { input, request } = await signInAtIssuer(rp);
  await assert.rejects(rp.service.oauthComplete({ ...input, state: "not-the-state" }, request), ATTEMPT_MISMATCH);
  await assert.rejects(rp.service.oauthComplete({ ...input, state: undefined }, request), ATTEMPT_MISMATCH);
  await assert.rejects(rp.service.oauthComplete(input, requestAt()), ATTEMPT_MISMATCH, "no attempt cookie in this browser");
  const other = await rp.service.oauthStart({ provider: "oidc" }, requestAt());
  await assert.rejects(rp.service.oauthComplete(input, requestAt(APP_ORIGIN, { jskit_oidc_attempt: other.attempt })), ATTEMPT_MISMATCH);
  // Change one fully significant character of the authentication tag; trailing
  // base64url characters carry padding bits and can decode to the same tag.
  const sealed = request.cookies.jskit_oidc_attempt;
  const at = sealed.lastIndexOf(".") + 1;
  const forged = `${sealed.slice(0, at)}${sealed[at] === "A" ? "B" : "A"}${sealed.slice(at + 1)}`;
  await assert.rejects(rp.service.oauthComplete(input, requestAt(APP_ORIGIN, { jskit_oidc_attempt: forged })), ATTEMPT_MISMATCH);
});

test("RP 6: an ID token with the wrong nonce is rejected", async (t) => {
  const { rp } = await relyingParty(t, { change: { nonce: "another-nonce" } });
  const { input, request } = await signInAtIssuer(rp);
  await assert.rejects(rp.service.oauthComplete(input, request), VERIFY_FAILED);
  assert.equal((await rp.knex("auth_oidc_sessions").count({ count: "*" }))[0].count, 0);
});

test("RP 7: an authorization response from another issuer (RFC 9207 iss) is rejected", async (t) => {
  const { rp } = await relyingParty(t);
  const { input, request } = await signInAtIssuer(rp);
  assert.ok(input.iss, "the issuer sends iss");
  await assert.rejects(rp.service.oauthComplete({ ...input, iss: "https://attacker.example" }, request), VERIFY_FAILED);
  await assert.rejects(rp.service.oauthComplete({ ...input, iss: undefined }, request), VERIFY_FAILED);
});

test("an email the issuer says is unconfirmed never reaches the app", async (t) => {
  const { rp } = await relyingParty(t, { account: { sub: "usr_test_eve", email: "ada@example.test", name: "Eve", emailVerified: false } });
  const { input, request } = await signInAtIssuer(rp);
  await assert.rejects(rp.service.oauthComplete(input, request), {
    statusCode: 401,
    message: "Your account provider has not confirmed your email address yet. Confirm it there, then sign in again."
  });
  assert.equal((await rp.knex("auth_oidc_sessions").count({ count: "*" }))[0].count, 0);
});

test("RP 8: an ID token issued to another app is rejected", async (t) => {
  const { rp } = await relyingParty(t, { change: { aud: "another-app" } });
  const { input, request } = await signInAtIssuer(rp);
  await assert.rejects(rp.service.oauthComplete(input, request), VERIFY_FAILED);
});

test("RP 8: an ID token from another issuer is rejected", async (t) => {
  const { rp } = await relyingParty(t, { change: { iss: "https://attacker.example" } });
  const { input, request } = await signInAtIssuer(rp);
  await assert.rejects(rp.service.oauthComplete(input, request), VERIFY_FAILED);
});

test("RP 17: back-channel logout ends the person's sessions and refuses bad tokens", async (t) => {
  const { issuer, rp } = await relyingParty(t);
  const { input, request } = await signInAtIssuer(rp);
  const { session } = await rp.service.oauthComplete(input, request);
  const cookies = { jskit_oidc_session: session.token };
  const clientId = (await rp.knex("auth_oidc_clients").first("client_id")).client_id;
  const logoutToken = (claims = {}) => issuer.sign({
    iss: issuer.issuer,
    aud: clientId,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    sub: issuer.account.sub,
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
    ...claims
  }, { typ: "logout+jwt" });

  const refused = [
    ["another audience", await logoutToken({ aud: "another-app" })],
    ["another issuer", await logoutToken({ iss: "https://attacker.example" })],
    ["a nonce", await logoutToken({ nonce: "n" })],
    ["no events claim", await logoutToken({ events: undefined })],
    ["the wrong event", await logoutToken({ events: { "https://example.test/other": {} } })],
    ["no subject or session", await logoutToken({ sub: undefined })],
    ["no token id", await logoutToken({ jti: undefined })],
    ["an old token", await logoutToken({ iat: Math.floor(Date.now() / 1000) - 3600 })],
    ["garbage", "not-a-jwt"]
  ];
  for (const [reason, token] of refused) {
    await assert.rejects(rp.backchannel.handle(token), { name: "BackchannelLogoutError" }, reason);
  }
  assert.equal((await rp.service.authenticateRequest(requestAt(APP_ORIGIN, cookies))).authenticated, true);

  const valid = await logoutToken();
  assert.deepEqual(await rp.backchannel.handle(valid), { ended: 1 });
  assert.equal((await rp.service.authenticateRequest(requestAt(APP_ORIGIN, cookies))).authenticated, false);
  await assert.rejects(rp.backchannel.handle(valid), { message: "logout_token was already used." });
});

test("RP 17: a logout token naming only the issuer session ends that session", async (t) => {
  const { issuer, rp } = await relyingParty(t);
  const { input, request } = await signInAtIssuer(rp);
  const { session } = await rp.service.oauthComplete(input, request);
  // Issuers add sid only for clients that ask for it; this one stands for such an issuer.
  await rp.knex("auth_oidc_sessions").update({ sid: "issuer-session-1" });
  const stored = await rp.knex("auth_oidc_sessions").first("sid", "client_id");
  const token = await issuer.sign({
    iss: issuer.issuer,
    aud: stored.client_id,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    sid: stored.sid,
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} }
  }, { typ: "logout+jwt" });
  assert.deepEqual(await rp.backchannel.handle(token), { ended: 1 });
  assert.equal((await rp.service.authenticateRequest(requestAt(APP_ORIGIN, { jskit_oidc_session: session.token }))).authenticated, false);
});

test("production sessions use a host-only __Host- cookie", async (t) => {
  const issuer = await startMockIssuer();
  const rp = await createRelyingParty({
    issuer,
    env: { NODE_ENV: "production", AUTH_OIDC_SESSION_SECRET: "fixture-oidc-session-secret-0123456789" }
  });
  t.after(async () => {
    await rp.close();
    await issuer.close();
  });
  const written = [];
  const reply = { setCookie: (name, value, options) => written.push({ name, options }) };
  rp.service.writeSessionCookies(reply, { token: "opaque-session-token", expires_in: 60 });
  assert.equal(written.length, 1);
  assert.equal(written[0].name, "__Host-jskit_oidc_session");
  assert.equal(written[0].options.secure, true);
  assert.equal(written[0].options.path, "/");
  assert.equal(written[0].options.domain, undefined);
  assert.equal(rp.service.hasSessionCookie({ cookies: { jskit_oidc_session: "x" } }), false);
  assert.equal(rp.service.hasSessionCookie({ cookies: { "__Host-jskit_oidc_session": "x" } }), true);
});
