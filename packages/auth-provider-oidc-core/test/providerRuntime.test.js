import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import createKnex from "knex";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { buildAuthActions } from "@jskit-ai/auth-core/server/actions/auth.contributor";
import { AuthController } from "@jskit-ai/auth-web/server/controllers/AuthController";
import { AuthWebService } from "@jskit-ai/auth-web/server/services/AuthWebService";
import packageJson from "../package.json" with { type: "json" };
import migration from "../migrations/auth_oidc_initial.cjs";
import { AuthOidcProvider } from "../src/server/providers/AuthOidcProvider.js";
import { AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH, AUTH_OIDC_LOGOUT_PATH } from "../src/shared/index.js";
import { BACKCHANNEL_LOGOUT_EVENT } from "../src/server/lib/backchannelLogout.js";
import { followAuthorization, startMockIssuer } from "../test-support/mockIssuer.js";

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

async function startApp(t, { env = {} } = {}) {
  const issuer = await startMockIssuer();
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-oidc-app-"));
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await migration.up(knex);
  const fastify = Fastify();
  await fastify.register(fastifyCookie);
  let authService = null;
  const probe = defineProvider({
    id: "test.oidc.probe",
    requires: { service: "auth.service" },
    setup({ service }) {
      authService = service;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.app-root": appRoot,
      "runtime.database": { knex },
      "runtime.env": {
        NODE_ENV: "test",
        AUTH_OIDC_ISSUER: issuer.issuer,
        AUTH_OIDC_REGISTRATION_TOKEN: issuer.registrationToken,
        ...env
      },
      "runtime.fastify": fastify,
      "runtime.logger": quietLogger,
      "auth.extensions": createAuthExtensions()
    },
    providers: [AuthOidcProvider, probe]
  });
  await runtime.start();
  await fastify.ready();
  t.after(async () => {
    await runtime.stop?.();
    await fastify.close();
    await knex.destroy();
    await issuer.close();
    await rm(appRoot, { recursive: true, force: true });
  });
  return { issuer, knex, fastify, authService };
}

function replyFixture() {
  return {
    cookies: {},
    setCookie(name, value, options) {
      this.cookies[name] = { value, options };
    },
    clearCookie(name, options) {
      this.cookies[name] = { value: "", options };
    },
    redirect(url) {
      this.redirectedTo = url;
    },
    code(status) {
      this.status = status;
      return this;
    },
    send(body) {
      this.body = body;
    }
  };
}

// The auth-web controller, its actions and this provider, without the HTTP runtime.
function authWeb(authService) {
  const actions = new Map(buildAuthActions({ authService }).map((action) => [action.id, action]));
  const request = (extra = {}) => ({
    headers: { host: "localhost:5173" },
    protocol: "http",
    socket: { remoteAddress: "127.0.0.1" },
    cookies: {},
    executeAction({ actionId, input }) {
      return actions.get(actionId).execute(input || {}, { requestMeta: { request: this } });
    },
    ...extra
  });
  return { controller: new AuthController({ service: new AuthWebService({ authService }) }), request };
}

test("the package provides auth.service with the documented descriptor", () => {
  assert.deepEqual(packageJson.jskit.capabilities.provides, ["auth.service"]);
  assert.deepEqual(packageJson.dependencies, { jose: "6.2.12", knex: "^3.1.0", "openid-client": "6.8.8" });
  assert.deepEqual(packageJson.bin, { "jskit-oidc-sign-in": "./bin/jskit-oidc-sign-in.js" });
});

test("capabilities: one OIDC button, no password features, preview identity unchanged", async (t) => {
  const { authService } = await startApp(t, {
    env: { AUTH_OIDC_LABEL: "Sign in with Mobily", AUTH_DEV_BYPASS_ENABLED: "true", AUTH_DEV_BYPASS_SECRET: "preview-secret-0123456789abcdef" }
  });
  const { provider, features } = authService.getCapabilities();
  assert.deepEqual(provider, { id: "oidc", label: "Sign in with Mobily" });
  assert.deepEqual(features.oauthLogin, { enabled: true, providers: [{ id: "oidc", label: "Sign in with Mobily" }], defaultProvider: "oidc" });
  assert.deepEqual(features.password, { login: false, register: false, change: false, methodToggle: false });
  assert.equal(features.passwordRecovery.request, false);
  assert.equal(features.otp.login, false);
  assert.equal(features.devLoginAs, true);
});

test("auth-web's start and complete routes bind the attempt to the browser and return the page", async (t) => {
  const { authService, knex } = await startApp(t);
  const { controller, request } = authWeb(authService);

  const startReply = replyFixture();
  await controller.oauthStart(request({ params: { provider: "oidc" }, query: { returnTo: "/reports" } }), startReply);
  const attempt = startReply.cookies.jskit_oidc_attempt;
  assert.ok(attempt.value);
  assert.deepEqual(attempt.options, { path: "/api/oauth", httpOnly: true, sameSite: "lax", secure: false, maxAge: 600 });

  const callback = await followAuthorization(startReply.redirectedTo, { redirectPrefix: "http://localhost:5173/auth/login" });
  const completeReply = replyFixture();
  await controller.oauthComplete(request({
    cookies: { jskit_oidc_attempt: attempt.value },
    body: {
      provider: "oidc",
      code: callback.searchParams.get("code"),
      state: callback.searchParams.get("state"),
      iss: callback.searchParams.get("iss")
    }
  }), completeReply);
  assert.equal(completeReply.status, 200);
  assert.deepEqual(completeReply.body, { ok: true, provider: "oidc", username: "Ada Lovelace", email: "ada@example.test", returnTo: "/reports" });
  assert.equal(completeReply.cookies.jskit_oidc_attempt.value, "", "the attempt is single-use");
  assert.ok(completeReply.cookies.jskit_oidc_session.value);
  assert.equal((await knex("auth_oidc_sessions").count({ count: "*" }))[0].count, 1);
});

test("a sign-in that cannot start is explained on the login page", async (t) => {
  const { authService } = await startApp(t, { env: { AUTH_OIDC_ISSUER: "" } });
  const { controller, request } = authWeb(authService);
  const reply = replyFixture();
  await controller.oauthStart(request({ params: { provider: "oidc" }, query: {} }), reply);
  const explained = new URL(reply.redirectedTo, "http://localhost:5173");
  assert.equal(explained.pathname, "/auth/login");
  assert.equal(explained.searchParams.get("error_description"), "Sign-in is not set up yet: AUTH_OIDC_ISSUER is missing.");
  assert.equal(reply.cookies.jskit_oidc_attempt, undefined);
});

test("the back-channel route accepts a form-encoded logout token and refuses others", async (t) => {
  const { issuer, fastify, knex, authService } = await startApp(t);
  const { controller, request } = authWeb(authService);
  const startReply = replyFixture();
  await controller.oauthStart(request({ params: { provider: "oidc" }, query: {} }), startReply);
  const callback = await followAuthorization(startReply.redirectedTo, { redirectPrefix: "http://localhost:5173/auth/login" });
  await controller.oauthComplete(request({
    cookies: { jskit_oidc_attempt: startReply.cookies.jskit_oidc_attempt.value },
    body: { code: callback.searchParams.get("code"), state: callback.searchParams.get("state"), iss: callback.searchParams.get("iss") }
  }), replyFixture());

  const clientId = (await knex("auth_oidc_clients").first("client_id")).client_id;
  const token = await issuer.sign({
    iss: issuer.issuer, aud: clientId, iat: Math.floor(Date.now() / 1000), jti: randomUUID(),
    sub: issuer.account.sub, events: { [BACKCHANNEL_LOGOUT_EVENT]: {} }
  }, { typ: "logout+jwt" });
  const post = (payload) => fastify.inject({
    method: "POST",
    url: AUTH_OIDC_BACKCHANNEL_LOGOUT_PATH,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload
  });

  const refused = await post("logout_token=not-a-jwt");
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().error, "invalid_request");
  assert.equal(refused.headers["cache-control"], "no-store");

  const accepted = await post(new URLSearchParams({ logout_token: token }).toString());
  assert.equal(accepted.statusCode, 200);
  assert.equal((await knex("auth_oidc_sessions").whereNull("revoked_at").count({ count: "*" }))[0].count, 0);
  assert.equal((await post(new URLSearchParams({ logout_token: token }).toString())).statusCode, 400, "replay");
});

test("the logout route ignores cross-site links and clears the session", async (t) => {
  const { fastify } = await startApp(t);
  const crossSite = await fastify.inject({ method: "GET", url: `${AUTH_OIDC_LOGOUT_PATH}?everywhere=1`, headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(crossSite.statusCode, 302);
  assert.equal(crossSite.headers.location, "/");
  assert.equal(crossSite.headers["set-cookie"], undefined);

  const sameOrigin = await fastify.inject({
    method: "GET",
    url: AUTH_OIDC_LOGOUT_PATH,
    headers: { "sec-fetch-site": "same-origin", cookie: "jskit_oidc_session=unknown" }
  });
  assert.equal(sameOrigin.statusCode, 302);
  assert.equal(sameOrigin.headers.location, "/");
  assert.match(String(sameOrigin.headers["set-cookie"]), /jskit_oidc_session=;/u);
});
