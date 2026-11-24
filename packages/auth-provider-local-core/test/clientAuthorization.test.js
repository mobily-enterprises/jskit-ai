import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClientAuthorizationError } from "@jskit-ai/auth-core/server/clientAuthorizationError";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { resolveLocalAuthConfig } from "../src/server/lib/config.js";
import { localServiceOptions } from "../test-support/localService.js";

// Local auth as the OAuth authorization server of the clients config.auth.clients names: a person allows a client,
// which then works as them by its bearer token alone, until the connection ends.

const PASSWORD = "correct horse battery staple";
const HELPER = Object.freeze({ name: "Helper", redirectUris: ["https://helper.example/callback"] });
const KEEPER = Object.freeze({ name: "Keeper", redirectUris: ["https://keeper.example/cb"], secret: "k".repeat(40) });
const CLIENTS = Object.freeze({ helper: HELPER, keeper: KEEPER });

async function started(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-clients-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  const service = createLocalAuthService({ ...localServiceOptions({ clients: CLIENTS }), backend });
  const signUp = async (email) => {
    const { session } = await service.register({ email, password: PASSWORD });
    // A fresh request object each time, as each HTTP request is.
    return () => ({ headers: {}, cookies: { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token } });
  };
  return { backend, service, signUp };
}

const newVerifier = () => randomBytes(32).toString("base64url");
const challengeOf = (verifier) => createHash("sha256").update(verifier).digest("base64url");
const bearer = (token) => ({ authCredentials: "bearer", headers: { authorization: `Bearer ${token}` } });

function authorizationQuery({ client = "helper", redirect = HELPER.redirectUris[0], verifier = newVerifier(), ...rest } = {}) {
  return {
    response_type: "code",
    client_id: client,
    redirect_uri: redirect,
    code_challenge: challengeOf(verifier),
    code_challenge_method: "S256",
    state: "st-1",
    ...rest
  };
}

/** A person allows the client: the code it is sent back with, and the verifier it proves it with. */
async function allow(service, browser, options = {}) {
  const verifier = options.verifier || newVerifier();
  const consent = await service.startClientAuthorization(authorizationQuery({ ...options, verifier }), browser());
  assert.equal(consent.kind, "consent");
  const decided = await service.decideClientAuthorization({ ticket: consent.ticket, allow: true }, browser());
  assert.equal(decided.kind, "redirect");
  const back = new URL(decided.to);
  return { code: back.searchParams.get("code"), back, verifier, consent };
}

const exchange = (service, { code, verifier }, extra = {}) => service.exchangeClientToken({
  grant_type: "authorization_code", client_id: "helper", code, redirect_uri: HELPER.redirectUris[0], code_verifier: verifier, ...extra
});

const refusal = (error, status = 400) => (thrown) => thrown instanceof ClientAuthorizationError && thrown.error === error && thrown.status === status;

test("a person connects a client, which then works as them by its bearer token alone, until the connection is revoked", async (t) => {
  const { service, signUp } = await started(t);
  const ada = await signUp("ada@example.com");
  const allowed = await allow(service, ada);
  assert.deepEqual(allowed.consent.client, { id: "helper", name: "Helper" });
  assert.equal(allowed.consent.person.email, "ada@example.com");
  assert.equal(allowed.consent.returnsTo, "https://helper.example");
  assert.equal(`${allowed.back.origin}${allowed.back.pathname}`, "https://helper.example/callback");
  assert.equal(allowed.back.searchParams.get("state"), "st-1");
  assert.equal(allowed.back.searchParams.get("iss"), "http://localhost:5173");

  const tokens = await exchange(service, allowed);
  assert.deepEqual(Object.keys(tokens).sort(), ["access_token", "expires_in", "refresh_token", "token_type"]);
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 900);

  const asClient = await service.authenticateRequest(bearer(tokens.access_token));
  assert.equal(asClient.authenticated, true);
  assert.equal(asClient.actor.email, "ada@example.com");
  assert.equal(asClient.credentials, "bearer");
  assert.equal(asClient.sessionPurpose, "client.helper");

  // The client's tokens are no browser session, and a browser's cookies sign nobody in on a bearer route.
  const asCookies = { headers: {}, cookies: { jskit_local_access_token: tokens.access_token, jskit_local_refresh_token: tokens.refresh_token } };
  assert.equal((await service.authenticateRequest(asCookies)).authenticated, false);
  assert.equal((await service.authenticateRequest({ ...ada(), authCredentials: "bearer" })).authenticated, false);
  assert.equal((await service.authenticateRequest({ ...ada(), headers: { authorization: `Bearer ${tokens.access_token}` } })).actor.email,
    "ada@example.com", "a cookie route reads the cookies, never the header");
  assert.equal((await service.authenticateRequest(bearer(`${tokens.access_token}x`))).authenticated, false);

  const refreshed = await service.exchangeClientToken({ grant_type: "refresh_token", client_id: "helper", refresh_token: tokens.refresh_token });
  assert.equal(refreshed.refresh_token, tokens.refresh_token);
  assert.equal((await service.authenticateRequest(bearer(refreshed.access_token))).actor.email, "ada@example.com");
  await assert.rejects(
    service.exchangeClientToken({ grant_type: "refresh_token", client_id: "keeper", client_secret: KEEPER.secret, refresh_token: tokens.refresh_token }),
    refusal("invalid_grant"), "another client cannot refresh it"
  );

  await service.revokeClientToken({ client_id: "helper", token: tokens.refresh_token });
  assert.equal((await service.authenticateRequest(bearer(refreshed.access_token))).authenticated, false, "the next call is refused");
  await assert.rejects(service.exchangeClientToken({ grant_type: "refresh_token", client_id: "helper", refresh_token: tokens.refresh_token }),
    refusal("invalid_grant"));
  assert.equal((await service.authenticateRequest(ada())).authenticated, true, "the person's own session goes on");
});

test("a code makes one connection, for its own client, redirect URI and verifier, within a minute", async (t) => {
  const { service, signUp } = await started(t);
  const ada = await signUp("ada@example.com");
  const allowed = await allow(service, ada);
  await assert.rejects(exchange(service, { ...allowed, verifier: newVerifier() }), refusal("invalid_grant"));
  await assert.rejects(exchange(service, allowed, { redirect_uri: "https://helper.example/other" }), refusal("invalid_grant"));
  await assert.rejects(exchange(service, allowed, { client_id: "keeper", client_secret: KEEPER.secret }), refusal("invalid_grant"));
  const tokens = await exchange(service, allowed);
  await assert.rejects(exchange(service, allowed), refusal("invalid_grant"), "a code is used once");
  assert.equal((await service.authenticateRequest(bearer(tokens.access_token))).authenticated, false,
    "a code used twice ends the connection it made");

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const late = await allow(service, ada);
  t.mock.timers.tick(61_000);
  await assert.rejects(exchange(service, late), refusal("invalid_grant"), "a code lives 60 seconds");
});

test("an authorization request goes back to its client only when the client and that redirect URI are known", async (t) => {
  const { service, signUp } = await started(t);
  const ada = await signUp("ada@example.com");
  const start = (options) => service.startClientAuthorization(authorizationQuery(options), ada());
  assert.deepEqual(await start({ client: "nobody" }), { kind: "refused", reason: "unknownClient" });
  assert.deepEqual(await start({ redirect: "https://evil.example/callback" }), { kind: "refused", reason: "unknownRedirect" });

  const errorOf = async (options) => {
    const outcome = await start(options);
    assert.equal(outcome.kind, "redirect");
    const back = new URL(outcome.to);
    assert.equal(back.searchParams.get("state"), "st-1");
    assert.equal(back.searchParams.get("code"), null);
    return back.searchParams.get("error");
  };
  assert.equal(await errorOf({ response_type: "token" }), "unsupported_response_type");
  assert.equal(await errorOf({ code_challenge: "" }), "invalid_request");
  assert.equal(await errorOf({ code_challenge_method: "plain" }), "invalid_request");
  assert.equal(await errorOf({ resource: "https://elsewhere.example/api/mcp" }), "invalid_target");
  assert.equal((await start({ resource: "http://localhost:5173/api/mcp" })).kind, "consent");

  assert.deepEqual(await service.startClientAuthorization(authorizationQuery(), { headers: {}, cookies: {} }), { kind: "sign-in" });

  const consent = await start({});
  const denied = new URL((await service.decideClientAuthorization({ ticket: consent.ticket, allow: false }, ada())).to);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("code"), null);
});

test("the consent page's answer counts only from the session that saw it, while the page is fresh", async (t) => {
  const { service, signUp } = await started(t);
  const ada = await signUp("ada@example.com");
  const bob = await signUp("bob@example.com");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const consent = await service.startClientAuthorization(authorizationQuery(), ada());
  assert.deepEqual(await service.decideClientAuthorization({ ticket: consent.ticket, allow: true }, bob()), { kind: "refused", reason: "otherSession" });
  assert.deepEqual(await service.decideClientAuthorization({ ticket: `${consent.ticket}x`, allow: true }, ada()), { kind: "refused", reason: "expiredConsent" });
  t.mock.timers.tick(601_000);
  assert.deepEqual(await service.decideClientAuthorization({ ticket: consent.ticket, allow: true }, ada()), { kind: "refused", reason: "expiredConsent" });
});

test("a client with a secret must give it, and signing out of other sessions ends every connection", async (t) => {
  const { service, signUp } = await started(t);
  const ada = await signUp("ada@example.com");
  const allowed = await allow(service, ada, { client: "keeper", redirect: KEEPER.redirectUris[0] });
  const form = { grant_type: "authorization_code", client_id: "keeper", code: allowed.code, redirect_uri: KEEPER.redirectUris[0], code_verifier: allowed.verifier };
  await assert.rejects(service.exchangeClientToken(form), refusal("invalid_client", 401));
  await assert.rejects(service.exchangeClientToken({ ...form, client_secret: "x".repeat(40) }), refusal("invalid_client", 401));
  const tokens = await service.exchangeClientToken({ ...form, client_secret: KEEPER.secret });
  await assert.rejects(service.revokeClientToken({ client_id: "keeper", token: tokens.refresh_token }), refusal("invalid_client", 401));
  await assert.rejects(service.exchangeClientToken({ grant_type: "password", client_id: "helper" }), refusal("unsupported_grant_type"));

  await service.signOutOtherSessions(ada());
  assert.equal((await service.authenticateRequest(bearer(tokens.access_token))).authenticated, false);
});

test("clients are checked at startup, and the server describes itself only while it has some", async (t) => {
  const resolve = (clients, env = {}) => resolveLocalAuthConfig({
    appRoot: os.tmpdir(),
    env: { APP_ENV: "test", AUTH_LOCAL_SESSION_SECRET: "test-session-secret", APP_PUBLIC_URL: "http://localhost:5173", ...env },
    fileBackend: false,
    emailRecovery: false,
    clients
  });
  assert.deepEqual(resolve(undefined).clients, []);
  const cases = [
    [{ "Bad Id": HELPER }, /client id is 1 to 25 lowercase/u],
    [{ helper: { ...HELPER, name: "" } }, /helper\.name/u],
    [{ helper: { ...HELPER, redirectUris: [] } }, /helper\.redirectUris must list/u],
    [{ helper: { ...HELPER, redirectUris: ["http://helper.example/cb"] } }, /must use https/u],
    [{ helper: { ...HELPER, redirectUris: ["https://helper.example/cb#x"] } }, /has a fragment/u],
    [{ helper: { ...HELPER, secret: "" } }, /secret must be at least 32 characters/u],
    [["helper"], /maps each client id/u]
  ];
  for (const [clients, message] of cases) assert.throws(() => resolve(clients), message, JSON.stringify(clients));
  assert.equal(resolve({ local: { name: "Local", redirectUris: ["http://127.0.0.1:4000/cb"] } }).clients[0].id, "local");
  assert.throws(() => resolve(CLIENTS, { APP_PUBLIC_URL: "" }), /APP_PUBLIC_URL is required when config.auth.clients/u);

  const { backend } = await started(t);
  const service = (clients) => createLocalAuthService({ ...localServiceOptions({ clients }), backend });
  assert.equal(service(undefined).clientAuthorizationMetadata(), null);
  const metadata = service(CLIENTS).clientAuthorizationMetadata();
  assert.equal(metadata.issuer, "http://localhost:5173");
  assert.equal(metadata.authorization_endpoint, "http://localhost:5173/oauth/authorize");
  assert.equal(metadata.token_endpoint, "http://localhost:5173/api/oauth/token");
  assert.equal(metadata.revocation_endpoint, "http://localhost:5173/api/oauth/revoke");
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported.sort(), ["client_secret_post", "none"]);
  assert.equal(metadata.registration_endpoint, undefined, "clients come from config, none registers itself");
});
