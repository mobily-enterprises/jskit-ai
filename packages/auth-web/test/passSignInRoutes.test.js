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
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalAuthService, createLocalFileBackend } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { createPassIssuer, passIdentityByEmail, passwordlessAccount } from "../../auth-provider-local-core/test-support/passSignInScenario.js";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";
import { DEFAULT_AUTH_RATE_LIMITS } from "../src/server/authRateLimits.js";

/**
 * The auth routes and policy over local auth in a store of the test's own, trusting the issuer's passes when `env`
 * carries its key.
 * @param {import("node:test").TestContext} t
 * @param {{ env?: Record<string, string>, config?: object }} [options]
 */
async function startApp(t, { env = {}, config = {} } = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-web-pass-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const authService = createLocalAuthService({ ...localServiceOptions({ env }), backend, passIdentity: passIdentityByEmail(backend) });
  const app = Fastify();
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": authService,
      "runtime.config": config,
      "runtime.env": { NODE_ENV: "test", ...env },
      "runtime.fastify": app,
      "runtime.logger": silentLogger
    },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthExtensionsProvider, AuthFeature, AuthPolicyProvider, AuthWebFeature]
  });
  t.after(() => app.close());
  await runtime.start();
  t.after(() => runtime.shutdown());
  return app;
}

/** The browser's form post of a pass, from the issuer's page, with no CSRF token and no cookies. */
function postPass(app, pass, remoteAddress = "203.0.113.7") {
  return app.inject({
    method: "POST",
    url: "/api/login/pass",
    remoteAddress,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ pass }).toString()
  });
}

/** Checks a refused pass went to the sign-in page with its reason, and signed nobody in. */
function sentToSignIn(response, code) {
  assert.equal(response.statusCode, 303, response.body);
  const location = new URL(response.headers.location, "http://app.test");
  assert.equal(location.pathname, "/auth/login");
  assert.equal(location.searchParams.get("error"), "sign_in_unavailable");
  assert.equal(location.searchParams.get("error_code"), code);
  assert.ok(location.searchParams.get("error_description").length > 0);
  assert.deepEqual(response.cookies, []);
}

test("a pass posted as a form signs its person in and goes home; posted again, it goes to the sign-in page as replayed", async (t) => {
  const issuer = createPassIssuer();
  const app = await startApp(t, { env: issuer.env });
  const pass = issuer.pass("ada@example.com");

  const signedIn = await postPass(app, pass);
  assert.equal(signedIn.statusCode, 303, signedIn.body);
  assert.equal(signedIn.headers.location, "/");
  assert.equal(signedIn.headers["cache-control"], "no-store");
  const cookies = Object.fromEntries(signedIn.cookies.map((cookie) => [cookie.name, cookie.value]));
  assert.deepEqual(Object.keys(cookies).sort(), ["jskit_local_access_token", "jskit_local_refresh_token"]);
  const session = await app.inject({ method: "GET", url: "/api/session", cookies });
  assert.equal(session.json().authenticated, true);
  assert.equal(session.json().email, "ada@example.com");

  sentToSignIn(await postPass(app, pass), "auth.pass.replayed");
  sentToSignIn(await postPass(app, issuer.pass("nobody@example.com")), "auth.pass.unmapped");
  sentToSignIn(await postPass(app, issuer.pass("ada@example.com", { resource: "machine-8" })), "auth.pass.wrongResource");
  sentToSignIn(await postPass(app, issuer.pass("ada@example.com", { now: Date.now() - 91_000 })), "auth.pass.expired");
  sentToSignIn(await app.inject({ method: "POST", url: "/api/login/pass", remoteAddress: "203.0.113.8" }), "auth.pass.malformed");
});

test("one address may post 20 passes a minute; the next is refused with 429 and Retry-After", async (t) => {
  const issuer = createPassIssuer();
  const app = await startApp(t, { env: issuer.env });
  assert.deepEqual(DEFAULT_AUTH_RATE_LIMITS.passSignIn, { max: 20, timeWindow: "1 minute" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    sentToSignIn(await postPass(app, "not a pass"), "auth.pass.malformed");
  }
  const limited = await postPass(app, issuer.pass("ada@example.com"));
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(limited.json().code, "kernel.http.rateLimited");
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  // Another address is counted on its own.
  assert.equal((await postPass(app, issuer.pass("ada@example.com"), "203.0.113.9")).headers.location, "/");
});

test("without AUTH_PASS_PUBLIC_KEY the app has no pass sign-in route", async (t) => {
  const issuer = createPassIssuer();
  const app = await startApp(t);
  assert.equal(app.hasRoute({ method: "POST", url: "/api/login/pass" }), false);
  // The post meets the policy every unknown API post meets, and signs nobody in.
  const posted = await postPass(app, issuer.pass("ada@example.com"));
  assert.equal(posted.statusCode, 403, posted.body);
  assert.deepEqual(posted.cookies, []);

  const withPasses = await startApp(t, { env: issuer.env });
  assert.equal(withPasses.hasRoute({ method: "POST", url: "/api/login/pass" }), true);
});

test("a pass sign-in limit with no limiter to enforce it stops startup", async (t) => {
  const issuer = createPassIssuer();
  const everyOtherLimitOff = Object.fromEntries(Object.keys(DEFAULT_AUTH_RATE_LIMITS)
    .filter((name) => name !== "passSignIn")
    .map((name) => [name, false]));
  await assert.rejects(startApp(t, { env: issuer.env, config: { auth: { rateLimits: everyOtherLimitOff } } }),
    (error) => /config\.auth\.rateLimits\.passSignIn limits one-time pass sign-in, and no route rate limiter is registered/u
      .test(String(error.details?.cause?.message || error.message)));
  const unlimited = await startApp(t, { env: issuer.env, config: { auth: { rateLimits: { ...everyOtherLimitOff, passSignIn: false } } } });
  assert.equal((await postPass(unlimited, issuer.pass("ada@example.com"))).headers.location, "/");
});
