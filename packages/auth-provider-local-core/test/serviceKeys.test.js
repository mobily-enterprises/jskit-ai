import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SERVICE_KEY_PURPOSE, createLocalAuthService, createLocalFileBackend, createServiceKeyRecord } from "../src/server/lib/index.js";
import { NO_PASSWORD } from "../src/server/lib/accounts.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/oauthHarness.js";

// A service key lets another application's server call this app's bearer routes as the users it names, one per call
// (Act-As-User), with exactly that user's rights. Every way a call can go wrong is refused in words, and none falls back
// to the key's own service user.

async function startService(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-service-keys-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  const service = createLocalAuthService({ ...localServiceOptions(), backend });
  const account = async (email) => (await service.register({ email, password: "correct horse" })).actor;
  const robot = await account("mercbot@example.com");
  const anna = await account("anna@example.com");
  await backend.withTransaction((tx) => tx.users.create({
    id: "usr_gone", email: "gone@example.com", displayName: "Gone", password: NO_PASSWORD, disabled: true
  }));
  async function issue(userId, options = {}) {
    const { key, record } = createServiceKeyRecord({ userId, ...options });
    await backend.withTransaction((tx) => tx.sessions.create(record));
    return { key, record };
  }
  return { backend, service, robot, anna, issue };
}

// What a bearer route (credentials: "bearer") hands the auth service: auth-core sets authCredentials.
function call(key, actAs, extra = {}) {
  return {
    authCredentials: "bearer",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(actAs ? { "act-as-user": actAs } : {}) },
    cookies: {},
    ...extra
  };
}

function assertRefused(result, status, code, words) {
  assert.equal(result.authenticated, false);
  assert.equal(result.actor ?? null, null);
  assert.equal(result.refusal?.status, status, JSON.stringify(result.refusal));
  assert.equal(result.refusal.code, code);
  assert.match(result.refusal.message, words);
}

test("a service key acts as the user it names, by id or by email, with that user's identity and the key's name", async (t) => {
  const { service, robot, anna, issue } = await startService(t);
  const { key, record } = await issue(robot.providerUserId);
  assert.equal(record.purpose, SERVICE_KEY_PURPOSE);
  assert.equal(record.userId, robot.providerUserId);
  assert.notEqual(record.tokenHash, key, "the store keeps only the key's hash");
  assert.equal(record.id.length <= 64 && record.tokenHash.length <= 64, true, "it fits a sessions table's 64-character columns");

  const byId = await service.authenticateRequest(call(key, anna.providerUserId));
  assert.equal(byId.authenticated, true);
  assert.equal(byId.credentials, "bearer");
  assert.equal(byId.actor.providerUserId, anna.providerUserId);
  assert.equal(byId.actor.email, "anna@example.com");
  assert.deepEqual(byId.via, { userId: robot.providerUserId, name: robot.displayName });
  assert.equal(byId.session, null, "it writes no cookie");
  assert.equal(byId.secondFactorAt, "", "a route that asks for a second factor refuses it");

  const byEmail = await service.authenticateRequest(call(key, "Anna@Example.com"));
  assert.equal(byEmail.actor.providerUserId, anna.providerUserId);
});

test("a call without a key, with a wrong, revoked or expired key, or with a disabled key user is refused", async (t) => {
  const { backend, service, robot, anna, issue } = await startService(t);
  assertRefused(await service.authenticateRequest(call("", anna.providerUserId)), 401, "auth.serviceKey.required", /service key/u);
  assertRefused(await service.authenticateRequest(call("svk_not-a-key", anna.providerUserId)), 401, "auth.serviceKey.invalid",
    /unknown, revoked or expired/u);
  assertRefused(await service.authenticateRequest({ ...call("", anna.providerUserId), headers: { authorization: "Basic abc", "act-as-user": anna.providerUserId } }),
    401, "auth.serviceKey.invalid", /unknown, revoked or expired/u);

  const revoked = await issue(robot.providerUserId);
  await backend.withTransaction((tx) => tx.sessions.revoke(revoked.record.id));
  assertRefused(await service.authenticateRequest(call(revoked.key, anna.providerUserId)), 401, "auth.serviceKey.invalid", /revoked/u);

  const expired = await issue(robot.providerUserId, { now: Date.now() - 3 * 86_400_000, days: 1 });
  assertRefused(await service.authenticateRequest(call(expired.key, anna.providerUserId)), 401, "auth.serviceKey.invalid", /expired/u);

  const ofGone = await issue("usr_gone");
  assertRefused(await service.authenticateRequest(call(ofGone.key, anna.providerUserId)), 401, "auth.serviceKey.invalid", /disabled/u);
});

test("a person's own sign-in may not act as anyone, on a bearer route or by sending the key as a cookie", async (t) => {
  const { service, robot, anna, issue } = await startService(t);
  const signedIn = (await service.login({ email: "anna@example.com", password: "correct horse" })).session;
  assertRefused(await service.authenticateRequest(call(signedIn.access_token, robot.providerUserId)), 403,
    "auth.serviceKey.notServiceKey", /Only a service key may act as other users/u);
  assertRefused(await service.authenticateRequest(call(signedIn.refresh_token, robot.providerUserId)), 403,
    "auth.serviceKey.notServiceKey", /Only a service key/u);

  const { key } = await issue(robot.providerUserId);
  const asCookie = await service.authenticateRequest({ cookies: sessionCookies({ access_token: "", refresh_token: key }), headers: {} });
  assert.equal(asCookie.authenticated, false, "a service key never signs in a browser");
  const onCookieRoute = await service.authenticateRequest({ cookies: {}, headers: { authorization: `Bearer ${key}`, "act-as-user": anna.providerUserId } });
  assert.equal(onCookieRoute.authenticated, false, "a route that takes cookies ignores the Authorization header");
});

test("a call that names nobody, an unknown user, a disabled user or the key's own user is refused, never run as the key's user", async (t) => {
  const { service, robot, issue } = await startService(t);
  const { key } = await issue(robot.providerUserId);
  assertRefused(await service.authenticateRequest(call(key, "")), 400, "auth.serviceKey.actAsRequired", /Act-As-User/u);
  assertRefused(await service.authenticateRequest(call(key, "  ")), 400, "auth.serviceKey.actAsRequired", /never acts as itself/u);
  assertRefused(await service.authenticateRequest(call(key, "usr_nobody")), 403, "auth.serviceKey.actAsUnknown", /no user "usr_nobody"/u);
  assertRefused(await service.authenticateRequest(call(key, "nobody@example.com")), 403, "auth.serviceKey.actAsUnknown",
    /no user "nobody@example.com"/u);
  assertRefused(await service.authenticateRequest(call(key, "usr_gone")), 403, "auth.serviceKey.actAsInactive", /disabled/u);
  assertRefused(await service.authenticateRequest(call(key, "gone@example.com")), 403, "auth.serviceKey.actAsInactive", /disabled/u);
  assertRefused(await service.authenticateRequest(call(key, robot.providerUserId)), 403, "auth.serviceKey.actAsSelf", /its own service user/u);
});

test("a key's lifetime is whole days, at most ten years, and it names its user", () => {
  for (const options of [{ userId: "" }, { userId: "usr_a", days: 0 }, { userId: "usr_a", days: 3651 }, { userId: "usr_a", days: 1.5 }]) {
    assert.throws(() => createServiceKeyRecord(options), /createServiceKeyRecord/u, JSON.stringify(options));
  }
  const now = Date.UTC(2026, 10, 24);
  const { key, record } = createServiceKeyRecord({ userId: "usr_a", now });
  assert.match(key, /^svk_[A-Za-z0-9_-]{43}$/u);
  assert.equal(record.createdAt, new Date(now).toISOString());
  assert.equal(record.expiresAt, new Date(now + 365 * 86_400_000).toISOString(), "a year unless it says");
});
