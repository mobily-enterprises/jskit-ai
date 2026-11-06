import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { resolveLocalAuthConfig } from "../src/server/lib/config.js";
import { localServiceOptions } from "../test-support/localService.js";
import { exerciseSignInThrottle } from "../test-support/signInThrottleScenario.js";

const PASSWORD = "correct horse battery staple";

async function startService(t, env = {}) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-throttle-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalFileBackend({ storeDir });
  return createLocalAuthService({ ...localServiceOptions({ env }), backend });
}

test("failed sign-ins make the account wait, doubling, and a success forgets them (file backend)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });
  await exerciseSignInThrottle(t, await startService(t));
});

test("the longest wait caps the doubling", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });
  const service = await startService(t, {
    AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT: "2",
    AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS: "30",
    AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS: "100"
  });
  const signIn = () => service.login({ email: "cap@example.com", password: "wrong value" });
  await assert.rejects(signIn(), { status: 401 });
  for (const expectedSeconds of [30, 60, 100, 100]) {
    await assert.rejects(signIn(), { status: 401 });
    await assert.rejects(signIn(), (error) => error.status === 429 && error.params.retryAfterSeconds === expectedSeconds);
    t.mock.timers.tick(expectedSeconds * 1000);
  }
});

test("a password reset ends the wait, so recovery is always the way back in", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });
  const service = await startService(t);
  await service.register({ email: "locked@example.com", password: PASSWORD });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.login({ email: "locked@example.com", password: "a guess" }), { status: 401 });
  }
  await assert.rejects(service.login({ email: "locked@example.com", password: PASSWORD }), { status: 429 });

  const { recoveryUrl } = await service.requestPasswordReset({ email: "locked@example.com" });
  const recovery = await service.completePasswordRecovery({ code: new URL(recoveryUrl).searchParams.get("token") });
  const cookies = {};
  service.writeSessionCookies({ setCookie: (name, value) => { cookies[name] = value; }, clearCookie() {} }, recovery.session);
  await service.resetPassword({ password: "a brand new password" }, { cookies });

  const signedIn = await service.login({ email: "locked@example.com", password: "a brand new password" });
  assert.equal(signedIn.actor.email, "locked@example.com");
});

test("sign-in throttle and password length settings are checked at startup", () => {
  const resolve = (env) => resolveLocalAuthConfig({
    appRoot: os.tmpdir(),
    env: { NODE_ENV: "test", AUTH_LOCAL_SESSION_SECRET: "test-session-secret", ...env },
    fileBackend: false,
    emailRecovery: false
  });
  assert.deepEqual(resolve({}).signInThrottle, { failuresBeforeWait: 5, firstWaitMs: 30_000, maxWaitMs: 3_600_000 });
  assert.equal(resolve({}).passwordMinLength, 8);
  assert.equal(resolve({ AUTH_LOCAL_PASSWORD_MIN_LENGTH: "15" }).passwordMinLength, 15);
  assert.throws(() => resolve({ AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT: "0" }), /must be a positive whole number/u);
  assert.throws(() => resolve({ AUTH_LOCAL_SIGN_IN_FAILURES_BEFORE_WAIT: "101" }), /must be at most 100/u);
  assert.throws(() => resolve({ AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS: "soon" }), /must be a positive whole number/u);
  assert.throws(() => resolve({ AUTH_LOCAL_SIGN_IN_FIRST_WAIT_SECONDS: "60", AUTH_LOCAL_SIGN_IN_MAX_WAIT_SECONDS: "30" }),
    /MAX_WAIT_SECONDS must be at least/u);
  assert.throws(() => resolve({ AUTH_LOCAL_PASSWORD_MIN_LENGTH: "7" }), /from 8 to 64/u);
  assert.throws(() => resolve({ AUTH_LOCAL_PASSWORD_MIN_LENGTH: "65" }), /from 8 to 64/u);
});

test("a raised minimum password length is enforced on registration", async (t) => {
  const service = await startService(t, { AUTH_LOCAL_PASSWORD_MIN_LENGTH: "15" });
  await assert.rejects(service.register({ email: "short@example.com", password: "fourteen chars" }), {
    code: "auth.local.password.tooShort",
    params: { min: 15 },
    message: "Password must be at least 15 characters."
  });
  const registered = await service.register({ email: "long@example.com", password: "fifteen chars!!" });
  assert.equal(registered.actor.email, "long@example.com");
});
