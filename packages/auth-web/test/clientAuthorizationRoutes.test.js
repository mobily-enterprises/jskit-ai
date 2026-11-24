import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalAuthService, createLocalFileBackend } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";

// The authorization server's routes as an application serves them over local auth: a person allows a client on the
// consent page, and the client's token then signs it in on a bearer route, as that person, until it is revoked.

const ORIGIN = "http://localhost:5173";
const CALLBACK = "https://helper.example/callback";
const CLIENTS = Object.freeze({ helper: { name: "Helper", redirectUris: [CALLBACK] } });

// A route that takes a connected client's bearer token, as an MCP endpoint does.
const BearerProbe = defineProvider({
  id: "test.bearer-probe",
  requires: { http: "runtime.http" },
  setup({ http }) {
    http.router.register("POST", "/api/probe", { auth: "required", config: { credentials: "bearer" } },
      async (request) => ({ email: request.user.email }));
    return {};
  }
});

async function startApp(t, { clients = CLIENTS } = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-web-clients-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  const authService = createLocalAuthService({ ...localServiceOptions({ clients }), backend });
  const app = Fastify();
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": authService,
      "runtime.config": { app: { name: "Books" } },
      "runtime.env": { APP_ENV: "test", APP_PUBLIC_URL: ORIGIN },
      "runtime.fastify": app,
      "runtime.logger": silentLogger
    },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthExtensionsProvider, AuthFeature, AuthPolicyProvider, AuthWebFeature, BearerProbe]
  });
  t.after(() => app.close());
  await runtime.start();
  t.after(() => runtime.shutdown());
  return { app, authService };
}

const form = (fields) => ({ headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(fields).toString() });

test("a person allows a client on the consent page, and its token then signs it in as them until it is revoked", async (t) => {
  const { app, authService } = await startApp(t);
  const metadata = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
  assert.equal(metadata.statusCode, 200);
  assert.equal(metadata.json().issuer, ORIGIN);
  assert.equal(metadata.json().token_endpoint, `${ORIGIN}/api/oauth/token`);

  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "helper",
    redirect_uri: CALLBACK,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "xyz"
  });
  const signedOut = await app.inject({ method: "GET", url: `/oauth/authorize?${query}` });
  assert.equal(signedOut.statusCode, 303);
  const login = new URL(signedOut.headers.location, ORIGIN);
  assert.equal(login.pathname, "/auth/login");
  assert.equal(login.searchParams.get("returnTo"), `/oauth/authorize?${query}`);

  const { session } = await authService.register({ email: "ada@example.com", password: "correct horse battery staple" });
  const cookies = { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token };
  const consent = await app.inject({ method: "GET", url: `/oauth/authorize?${query}`, cookies, headers: { "accept-language": "en-GB,en;q=0.8" } });
  assert.equal(consent.statusCode, 200, consent.body);
  assert.match(consent.headers["content-type"], /^text\/html/u);
  assert.equal(consent.headers["x-frame-options"], "DENY");
  assert.match(consent.headers["content-security-policy"], /frame-ancestors 'none'; form-action 'self' https:\/\/helper\.example$/u);
  assert.match(consent.body, /<h1>Helper wants to use Books as you<\/h1>/u);
  assert.match(consent.body, /ada@example\.com/u);
  const ticket = /name="ticket" value="([^"]+)"/u.exec(consent.body)[1];

  const allowed = await app.inject({ method: "POST", url: "/oauth/authorize", cookies, ...form({ ticket, decision: "allow" }) });
  assert.equal(allowed.statusCode, 303, allowed.body);
  const back = new URL(allowed.headers.location);
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get("state"), "xyz");

  const exchanged = await app.inject({
    method: "POST",
    url: "/api/oauth/token",
    ...form({ grant_type: "authorization_code", client_id: "helper", code: back.searchParams.get("code"), redirect_uri: CALLBACK, code_verifier: verifier })
  });
  assert.equal(exchanged.statusCode, 200, exchanged.body);
  assert.equal(exchanged.headers["cache-control"], "no-store");
  const tokens = exchanged.json();
  const probe = (headers) => app.inject({ method: "POST", url: "/api/probe", headers });

  const asClient = await probe({ authorization: `Bearer ${tokens.access_token}` });
  assert.equal(asClient.statusCode, 200, asClient.body);
  assert.deepEqual(asClient.json(), { email: "ada@example.com" });
  assert.equal((await app.inject({ method: "POST", url: "/api/probe", cookies })).statusCode, 401, "a browser session is not a client's");

  const replayed = await app.inject({
    method: "POST",
    url: "/api/oauth/token",
    ...form({ grant_type: "authorization_code", client_id: "helper", code: back.searchParams.get("code"), redirect_uri: CALLBACK, code_verifier: verifier })
  });
  assert.equal(replayed.statusCode, 400);
  assert.equal(replayed.json().error, "invalid_grant");
  const refused = await probe({ authorization: `Bearer ${tokens.access_token}` });
  assert.equal(refused.statusCode, 401, "a code used twice ends its connection");
  assert.equal(refused.headers["www-authenticate"],
    `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/probe", error="invalid_token"`);
});

test("a revoked token stops the next call, a person can say no, and an unknown client is sent nowhere", async (t) => {
  const { app, authService } = await startApp(t);
  const { session } = await authService.register({ email: "ada@example.com", password: "correct horse battery staple" });
  const cookies = { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token };
  const verifier = randomBytes(32).toString("base64url");
  const query = (fields = {}) => new URLSearchParams({
    response_type: "code",
    client_id: "helper",
    redirect_uri: CALLBACK,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...fields
  });
  const ticketOf = async () => /name="ticket" value="([^"]+)"/u.exec((await app.inject({ method: "GET", url: `/oauth/authorize?${query()}`, cookies })).body)[1];

  const denied = await app.inject({ method: "POST", url: "/oauth/authorize", cookies, ...form({ ticket: await ticketOf(), decision: "deny" }) });
  assert.equal(new URL(denied.headers.location).searchParams.get("error"), "access_denied");

  const allowed = await app.inject({ method: "POST", url: "/oauth/authorize", cookies, ...form({ ticket: await ticketOf(), decision: "allow" }) });
  const code = new URL(allowed.headers.location).searchParams.get("code");
  const tokens = (await app.inject({
    method: "POST", url: "/api/oauth/token", ...form({ grant_type: "authorization_code", client_id: "helper", code, redirect_uri: CALLBACK, code_verifier: verifier })
  })).json();
  const revoked = await app.inject({ method: "POST", url: "/api/oauth/revoke", ...form({ client_id: "helper", token: tokens.refresh_token }) });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await app.inject({ method: "POST", url: "/api/probe", headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode, 401);

  const unknown = await app.inject({ method: "GET", url: `/oauth/authorize?${query({ client_id: "stranger" })}`, cookies });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.headers.location, undefined);
  assert.match(unknown.body, /Books doesn&#39;t know the app that sent you here\./u);
});

test("an application without clients has no authorization server", async (t) => {
  const { app } = await startApp(t, { clients: undefined });
  for (const [method, url] of [["GET", "/.well-known/oauth-authorization-server"], ["GET", "/oauth/authorize"], ["POST", "/api/oauth/token"]]) {
    assert.equal(app.hasRoute({ method, url }), false, `${method} ${url}`);
  }
});
