import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import {
  createLocalAuthService,
  createLocalDeliveries,
  createLocalFileBackend,
  createLoggedSignInEvents,
  hashPassword
} from "../src/server/lib/index.js";
import { NO_PASSWORD } from "../src/server/lib/accounts.js";
import { APP_URL, approveAtProvider, oidcProviderEntry, startOidcProvider } from "../test-support/oauthHarness.js";
import { localServiceOptions } from "../test-support/localService.js";
import { createPassIssuer, passIdentityByEmail, passwordlessAccount } from "../test-support/passSignInScenario.js";
import { requestFrom } from "../test-support/sessionMetadataScenario.js";

const PASSWORD = "correct horse battery staple";
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const START = Date.parse("2026-11-15T09:00:00.000Z");
const FROM = requestFrom("203.0.113.7", BROWSER);
const WHERE = Object.freeze({ ip: "203.0.113.7", userAgent: BROWSER });

/**
 * A local auth service over a file store of the test's own that keeps every sign-in event it is given, sent through
 * deliveries the test waits for.
 * @param {import("node:test").TestContext} t
 * @param {{ env?: Record<string, string>, signInEvents?: (event: object) => Promise<void>, config?: (config: object) => object, passIdentity?: boolean }} [options]
 */
async function startService(t, { env = {}, signInEvents = null, config = (given) => given, passIdentity = false } = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-sign-in-events-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  const deliveries = createLocalDeliveries({ logger: silentLogger });
  const events = [];
  const options = localServiceOptions({ env });
  const service = createLocalAuthService({
    ...options,
    backend,
    config: config(options.config),
    deliveries,
    ...(passIdentity ? { passIdentity: passIdentityByEmail(backend) } : {}),
    signInEvents: signInEvents ?? (async (event) => {
      events.push(event);
    })
  });
  /** The events sent so far, once every one of them was handed over; it forgets them. */
  async function takeEvents() {
    await deliveries.settled();
    return events.splice(0);
  }
  return { backend, service, takeEvents };
}

const at = (ms = 0) => new Date(START + ms).toISOString();

test("each sign-in and each refused password sign-in is an event, with the account, where it came from and when", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START });
  const { backend, service, takeEvents } = await startService(t, { env: { AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT: "1" } });
  const ada = await service.register({ email: "ada@example.com", password: PASSWORD }, FROM);
  const adaId = ada.actor.providerUserId;
  await service.login({ email: "ada@example.com", password: PASSWORD }, FROM);
  await backend.withTransaction(async (tx) => tx.users.create({
    id: "usr_off", email: "off@example.com", displayName: "Off", password: await hashPassword(PASSWORD), disabled: true
  }));
  await assert.rejects(service.login({ email: "off@example.com", password: PASSWORD }, FROM), { code: "auth.local.login.disabled" });
  await assert.rejects(service.login({ email: "nobody@example.com", password: "a wrong password" }, FROM), { status: 401 });
  await assert.rejects(service.login({ email: "ada@example.com", password: "a wrong password" }, FROM), { status: 401 });
  // One failure makes ada wait: then even the right password is refused, unchecked.
  await assert.rejects(service.login({ email: "ada@example.com", password: PASSWORD }, FROM), { status: 429 });
  // A sign-in with no request says nothing of where it came from.
  t.mock.timers.tick(31_000);
  await service.login({ email: "ada@example.com", password: PASSWORD });

  assert.deepEqual(await takeEvents(), [
    { type: "signedIn", method: "registration", userId: adaId, email: "ada@example.com", ...WHERE, at: at() },
    { type: "signedIn", method: "password", userId: adaId, email: "ada@example.com", ...WHERE, at: at() },
    { type: "failed", method: "password", reason: "disabled", userId: "usr_off", email: "off@example.com", ...WHERE, at: at() },
    { type: "failed", method: "password", reason: "invalidCredentials", userId: "", email: "nobody@example.com", ...WHERE, at: at() },
    { type: "failed", method: "password", reason: "invalidCredentials", userId: adaId, email: "ada@example.com", ...WHERE, at: at() },
    { type: "failed", method: "password", reason: "locked", userId: adaId, email: "ada@example.com", ...WHERE, at: at() },
    { type: "signedIn", method: "password", userId: adaId, email: "ada@example.com", ip: "", userAgent: "", at: at(31_000) }
  ]);

  // A password reset's link signs in too, for the reset.
  const { recoveryUrl } = await service.requestPasswordReset({ email: "ada@example.com" });
  await service.completePasswordRecovery({ code: new URL(recoveryUrl).searchParams.get("token") }, FROM);
  assert.deepEqual(await takeEvents(), [
    { type: "signedIn", method: "recovery", userId: adaId, email: "ada@example.com", ...WHERE, at: at(31_000) }
  ]);
});

test("a registration waiting for its email is an event when its right password is refused, and when its link signs in", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START });
  const { service, takeEvents } = await startService(t, { env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "" } });
  const waiting = await service.register({ email: "eve@example.com", password: PASSWORD }, FROM);
  await assert.rejects(service.login({ email: "eve@example.com", password: PASSWORD }, FROM), { code: "auth.login.emailUnconfirmed" });
  const token = new URL(waiting.confirmationUrl).searchParams.get("confirmation_token");
  const confirmed = await service.confirmRegistration({ token, password: PASSWORD }, FROM);
  assert.deepEqual(await takeEvents(), [
    { type: "failed", method: "password", reason: "unconfirmed", userId: "", email: "eve@example.com", ...WHERE, at: at() },
    { type: "signedIn", method: "confirmation", userId: confirmed.actor.providerUserId, email: "eve@example.com", ...WHERE, at: at() }
  ]);
});

test("a one-time pass's sign-in, and its refusal for a disabled account, are events", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START });
  const issuer = createPassIssuer();
  const { backend, service, takeEvents } = await startService(t, { env: issuer.env, passIdentity: true });
  await backend.withTransaction(async (tx) => {
    await tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" }));
    await tx.users.create(passwordlessAccount({ id: "usr_off", email: "off@example.com", displayName: "Off", disabled: true }));
  });
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") }, FROM);
  await assert.rejects(service.signInWithPass({ pass: issuer.pass("off@example.com") }, FROM), { code: "auth.local.login.disabled" });
  // A pass that names nobody signs no account in or out: no event.
  await assert.rejects(service.signInWithPass({ pass: issuer.pass("nobody@example.com") }, FROM), { code: "auth.pass.unmapped" });
  assert.deepEqual(await takeEvents(), [
    { type: "signedIn", method: "pass", userId: "usr_ada", email: "ada@example.com", ...WHERE, at: at() },
    { type: "failed", method: "pass", reason: "disabled", userId: "usr_off", email: "off@example.com", ...WHERE, at: at() }
  ]);
});

test("a provider's sign-in, and its refusal for a disabled account, are events naming the provider", async (t) => {
  const issuer = await startOidcProvider();
  t.after(() => issuer.close());
  const withGoogle = { env: { APP_PUBLIC_URL: APP_URL }, config: (given) => ({ ...given, oauthProviders: [oidcProviderEntry(issuer)], oauthEnabled: true }) };
  const fromBrowser = (request) => ({ ...request, ...FROM, cookies: request.cookies });
  const { service, takeEvents } = await startService(t, withGoogle);
  const approved = await approveAtProvider(service);
  const signedIn = await service.oauthComplete(approved.input, fromBrowser(approved.request));
  const [event] = await takeEvents();
  assert.deepEqual({ ...event, at: "" }, {
    type: "signedIn",
    method: "provider",
    provider: "google",
    userId: signedIn.actor.providerUserId,
    email: issuer.account.email,
    ...WHERE,
    at: ""
  });

  const off = await startService(t, withGoogle);
  await off.backend.withTransaction((tx) => tx.users.create({
    id: "usr_off", email: issuer.account.email, displayName: "Off", password: NO_PASSWORD, disabled: true
  }));
  const refused = await approveAtProvider(off.service);
  await assert.rejects(off.service.oauthComplete(refused.input, fromBrowser(refused.request)), { code: "auth.local.login.disabled" });
  const [refusal] = await off.takeEvents();
  assert.deepEqual({ ...refusal, at: "" }, {
    type: "failed",
    method: "provider",
    provider: "google",
    reason: "disabled",
    userId: "usr_off",
    email: issuer.account.email,
    ...WHERE,
    at: ""
  });
});

test("a refused sign-in answers without waiting for its event, and an event that fails is logged, never the sign-in's failure", async (t) => {
  const warnings = [];
  const logger = { ...silentLogger, error: (fields, message) => warnings.push({ fields, message }) };
  const stalled = await startService(t, { signInEvents: () => new Promise(() => {}) });
  await stalled.service.register({ email: "ada@example.com", password: PASSWORD });
  for (const email of ["ada@example.com", "nobody@example.com"]) {
    await assert.rejects(stalled.service.login({ email, password: "a wrong password" }), { status: 401 }, email);
  }

  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-sign-in-events-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const deliveries = createLocalDeliveries({ logger });
  const failing = createLocalAuthService({
    ...localServiceOptions(),
    backend: createLocalFileBackend({ storeDir }),
    deliveries,
    logger,
    signInEvents: async () => {
      throw new Error("The audit log is unavailable.");
    }
  });
  assert.equal((await failing.register({ email: "ada@example.com", password: PASSWORD })).actor.email, "ada@example.com");
  await deliveries.settled();
  assert.deepEqual(warnings.map(({ fields, message }) => [fields.err.message, fields.email, message]), [
    ["The audit log is unavailable.", "ada@example.com", "Sending the sign-in event failed."]
  ]);
});

test("a local auth service given no sign-in events recorder is refused when it is made", async (t) => {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-sign-in-events-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  assert.throws(() => createLocalAuthService({ ...localServiceOptions(), backend, signInEvents: undefined }),
    { name: "TypeError", message: /signInEvents/u });
});

test("without an application's own, each sign-in event is logged", async () => {
  const logged = [];
  const logSignInEvent = createLoggedSignInEvents({ ...silentLogger, info: (fields, message) => logged.push({ fields, message }) });
  const event = { type: "failed", method: "password", reason: "invalidCredentials", userId: "", email: "nobody@example.com", ip: "", userAgent: "", at: at() };
  await logSignInEvent(event);
  assert.deepEqual(logged, [{ fields: { signInEvent: event }, message: "Local auth sign-in: failed." }]);
});
