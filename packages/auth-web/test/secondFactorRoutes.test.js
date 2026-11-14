import assert from "node:assert/strict";
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
import { sessionCookies } from "../../auth-provider-local-core/test-support/oauthHarness.js";
import {
  SCENARIO_START,
  codeAt,
  secondFactorServiceOptions
} from "../../auth-provider-local-core/test-support/secondFactorScenario.js";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";
import { DEFAULT_AUTH_RATE_LIMITS } from "../src/server/authRateLimits.js";

const PASSWORD = "correct horse battery staple";

// An application's console: a page that asks for the session's second factor, and a dangerous action that asks for a
// code proved within five minutes.
const ConsoleRoutes = defineProvider({
  id: "test.console.routes",
  requires: { http: "runtime.http" },
  setup({ http }) {
    http.router.register("GET", "/api/console", { auth: "required", secondFactor: true }, async (request, reply) => {
      reply.send({ page: "console" });
    });
    http.router.register("POST", "/api/console/refund", { auth: "required", secondFactor: { maxAgeSeconds: 300 } },
      async (request, reply) => {
        reply.send({ refunded: true });
      });
    return {};
  }
});

/** The auth routes, the auth policy and the console over local auth in a store of the test's own. */
async function startConsole(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-web-second-factor-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const authService = createLocalAuthService({
    ...secondFactorServiceOptions().options,
    backend: createLocalFileBackend({ storeDir })
  });
  const app = Fastify();
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": authService,
      "runtime.config": {},
      "runtime.env": { APP_ENV: "test" },
      "runtime.fastify": app,
      "runtime.logger": silentLogger
    },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthExtensionsProvider, AuthFeature, AuthPolicyProvider, AuthWebFeature,
      ConsoleRoutes]
  });
  await runtime.start();
  t.after(async () => {
    await runtime.shutdown();
    await app.close();
  });
  return { app, authService };
}

/** A signed-in browser: its cookies and CSRF token, sending each request from one address. */
async function signedInBrowser(app, authService, email) {
  await authService.register({ email, password: PASSWORD });
  const cookies = sessionCookies((await authService.login({ email, password: PASSWORD })).session);
  const session = await app.inject({ method: "GET", url: "/api/session", cookies });
  for (const cookie of session.cookies) {
    cookies[cookie.name] = cookie.value;
  }
  const csrfToken = session.json().csrfToken;
  return (method, url, payload) => app.inject({
    method,
    url,
    cookies,
    remoteAddress: "203.0.113.7",
    headers: { "csrf-token": csrfToken },
    ...(payload === undefined ? {} : { payload })
  });
}

function refusedFor(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().code, code);
  return response.json();
}

test("a console asks for the session's second factor, and its dangerous action for one proved within five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const { app, authService } = await startConsole(t);
  const ada = await signedInBrowser(app, authService, "ada@example.com");

  // A signed-in session without a second factor is refused, saying what the route asks for.
  assert.deepEqual(refusedFor(await ada("GET", "/api/console"), 403, "auth.secondFactor.required").params, {});
  assert.deepEqual(refusedFor(await ada("POST", "/api/console/refund"), 403, "auth.secondFactor.required").params, {
    maxAgeSeconds: 300
  });
  refusedFor(await app.inject({ method: "GET", url: "/api/console" }), 401, "auth.session.required");

  // Setting up the authenticator proves this session's second factor.
  assert.deepEqual((await ada("GET", "/api/second-factor")).json(), { enrolled: false, enrolledAt: null, recoveryCodesLeft: 0, verifiedAt: null });
  const setup = await ada("POST", "/api/second-factor/setup");
  assert.equal(setup.statusCode, 200, setup.body);
  const { secret } = setup.json();
  refusedFor(await ada("POST", "/api/second-factor/setup/confirm", {}), 400, "validation_failed");
  const confirmed = await ada("POST", "/api/second-factor/setup/confirm", { code: codeAt(secret) });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().recoveryCodes.length, 10);
  assert.deepEqual((await ada("GET", "/api/console")).json(), { page: "console" });
  assert.deepEqual((await ada("POST", "/api/console/refund")).json(), { refunded: true });

  // Six minutes on, the console still opens but the refund asks for a fresh code.
  t.mock.timers.tick(6 * 60_000);
  assert.equal((await ada("GET", "/api/console")).statusCode, 200);
  refusedFor(await ada("POST", "/api/console/refund"), 403, "auth.secondFactor.required");
  refusedFor(await ada("POST", "/api/second-factor/verify", { code: codeAt(secret, -2) }), 400, "auth.local.secondFactor.codeInvalid");
  const verified = await ada("POST", "/api/second-factor/verify", { code: codeAt(secret) });
  assert.deepEqual(verified.json(), { verifiedAt: new Date().toISOString(), method: "code", recoveryCodesLeft: 10 });
  assert.deepEqual((await ada("POST", "/api/console/refund")).json(), { refunded: true });

  // Another signed-in person proves nothing for Ada's session, and Ada's proof opens nothing for them.
  const bob = await signedInBrowser(app, authService, "bob@example.com");
  refusedFor(await bob("GET", "/api/console"), 403, "auth.secondFactor.required");
  refusedFor(await bob("POST", "/api/second-factor/verify", { code: codeAt(secret) }), 409, "auth.local.secondFactor.notSetUp");

  // Removing it takes a proof, and afterwards the console asks again.
  t.mock.timers.tick(30_000);
  refusedFor(await ada("DELETE", "/api/second-factor", {}), 400, "auth.local.secondFactor.proofRequired");
  assert.deepEqual((await ada("DELETE", "/api/second-factor", { code: codeAt(secret) })).json(), { ok: true });
  refusedFor(await ada("GET", "/api/console"), 403, "auth.secondFactor.required");
});

test("one address may try codes only as fast as the verify route's limit", async (t) => {
  const { app, authService } = await startConsole(t);
  const ada = await signedInBrowser(app, authService, "ada@example.com");
  const statuses = [];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    statuses.push((await ada("POST", "/api/second-factor/verify", { code: "123456" })).statusCode);
  }
  const allowed = DEFAULT_AUTH_RATE_LIMITS.secondFactorVerify.max;
  assert.deepEqual(statuses.slice(0, allowed), Array(allowed).fill(409), "Ada has no authenticator to check");
  assert.deepEqual(statuses.slice(allowed), Array(15 - allowed).fill(429));
});
