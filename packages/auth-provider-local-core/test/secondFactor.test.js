import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveLocalAuthConfig } from "../src/server/lib/config.js";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { __testables, deriveSecondFactorKeys, openSecret, sealSecret } from "../src/server/lib/secondFactorCrypto.js";
import { NO_PASSWORD } from "../src/server/lib/accounts.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/oauthHarness.js";
import {
  SCENARIO_START,
  SECOND_FACTOR_KEY,
  codeAt,
  exerciseSecondFactor,
  secondFactorServiceOptions
} from "../test-support/secondFactorScenario.js";

const { fromBase32, stepAt, toBase32, totpCodeAt } = __testables;

async function storeDirFor(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-second-factor-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

test("authenticator codes are RFC 6238's: its test vectors, as six-digit codes", () => {
  const secret = toBase32(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(fromBase32(secret), Buffer.from("12345678901234567890"));
  for (const [seconds, code] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"]
  ]) {
    assert.equal(totpCodeAt(secret, stepAt(seconds * 1000)), code, `T = ${seconds}`);
  }
});

test("a sealed secret opens only for its own account and with the key that sealed it", () => {
  const keys = deriveSecondFactorKeys(SECOND_FACTOR_KEY);
  const sealed = sealSecret(keys, "usr_ada", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u);
  assert.equal(sealed.includes("GEZDGNBV"), false);
  assert.notEqual(sealSecret(keys, "usr_ada", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), sealed, "each seal has its own nonce");
  assert.equal(openSecret(keys, "usr_ada", sealed), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.throws(() => openSecret(keys, "usr_bob", sealed), /does not open with AUTH_LOCAL_SECOND_FACTOR_KEY/u);
  assert.throws(() => openSecret(deriveSecondFactorKeys(`${SECOND_FACTOR_KEY}!`), "usr_ada", sealed), /does not open/u);
  assert.throws(() => openSecret(keys, "usr_ada", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), /is not a sealed secret/u);
});

test("an authenticator sets up, proves sessions, refuses wrong, used and expired codes, waits, and resets (file backend)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const storeDir = await storeDirFor(t);
  const { events, options } = secondFactorServiceOptions();
  const service = createLocalAuthService({ ...options, backend: createLocalFileBackend({ storeDir }) });
  await exerciseSecondFactor(t, {
    service,
    events,
    async storedText() {
      const files = await fs.readdir(storeDir);
      return (await Promise.all(files.map((file) => fs.readFile(path.join(storeDir, file), "utf8")))).join("\n");
    }
  });
});

const PASSWORD = "correct horse battery staple";
const CODE_INVALID = Object.freeze({ status: 400, code: "auth.local.secondFactor.codeInvalid" });
const CODE_USED = Object.freeze({ status: 400, code: "auth.local.secondFactor.codeUsed" });
const RECOVERY_CODE_INVALID = Object.freeze({ status: 400, code: "auth.local.secondFactor.recoveryCodeInvalid" });
const PROOF_REQUIRED = Object.freeze({ status: 400, code: "auth.local.secondFactor.proofRequired" });
const NOT_SET_UP = Object.freeze({ status: 409, code: "auth.local.secondFactor.notSetUp" });
const ACCOUNT_NOT_FOUND = Object.freeze({ status: 404, code: "auth.local.secondFactor.accountNotFound" });
const ACCOUNT_DISABLED = Object.freeze({ status: 403, code: "auth.local.secondFactor.accountDisabled" });

/** A refusal while the account waits after wrong codes, for `seconds`. */
function lockedFor(seconds) {
  return (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "auth.local.secondFactor.locked");
    assert.equal(error.headers["retry-after"], String(seconds));
    return true;
  };
}

/** Six digits that are none of the codes accepted now. */
function wrongCode(secret) {
  const accepted = new Set([-1, 0, 1].map((offset) => codeAt(secret, offset)));
  let guess = 0;
  while (accepted.has(String(guess).padStart(6, "0"))) {
    guess += 1;
  }
  return String(guess).padStart(6, "0");
}

/**
 * A file-backed service where Ada has an authenticator, confirmed one step ago, and two sessions (the second never
 * proved its second factor), and Bob has none.
 */
async function enrolledAda(t) {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const { events, options } = secondFactorServiceOptions();
  const backend = createLocalFileBackend({ storeDir: await storeDirFor(t) });
  const service = createLocalAuthService({ ...options, backend });
  await service.register({ email: "ada@example.com", password: PASSWORD });
  await service.register({ email: "bob@example.com", password: PASSWORD });
  const signIn = async (email) => {
    const cookies = sessionCookies((await service.login({ email, password: PASSWORD })).session);
    return () => ({ cookies, ip: "203.0.113.7" });
  };
  const ada = await signIn("ada@example.com");
  const adaPhone = await signIn("ada@example.com");
  const bob = await signIn("bob@example.com");
  const adaId = (await service.authenticateRequest(ada())).actor.providerUserId;
  const bobId = (await service.authenticateRequest(bob())).actor.providerUserId;
  const { secret } = await service.startSecondFactorSetup(ada());
  const { recoveryCodes } = await service.confirmSecondFactorSetup(ada(), { code: codeAt(secret) });
  t.mock.timers.tick(30_000);
  return { service, backend, events, ada, adaPhone, bob, adaId, bobId, secret, recoveryCodes };
}

test("verifySecondFactorOf accepts the named account's current code once, answers the verification and marks no session", async (t) => {
  const { service, events, adaPhone, adaId, secret } = await enrolledAda(t);
  const typed = codeAt(secret);
  const at = new Date().toISOString();
  assert.deepEqual(await service.verifySecondFactorOf({ userId: adaId, proof: { code: ` ${typed.slice(0, 3)} ${typed.slice(3)} ` } }), {
    verifiedAt: at,
    method: "code",
    recoveryCodesLeft: 10
  });
  assert.equal((await service.getSecondFactorStatus(adaPhone())).verifiedAt, null, "no session proved anything");
  // The code is used up for every path: the same one again, here or by a session, is refused.
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: typed } }), CODE_USED);
  await assert.rejects(service.verifySecondFactor(adaPhone(), { code: typed }), CODE_USED);
  assert.deepEqual(events.at(-3), { type: "verified", userId: adaId, ip: "", via: "application", at, method: "code", recoveryCodesLeft: 10 });
  assert.equal(events.at(-2).via, "application");
  assert.equal(Object.hasOwn(events.at(-1), "via"), false, "a session's own event has no via");
});

test("verifySecondFactorOf refuses a wrong code or recovery code, and a proof that is not exactly one of them", async (t) => {
  const { service, events, adaId, secret, recoveryCodes } = await enrolledAda(t);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: wrongCode(secret) } }), CODE_INVALID);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: "12345" } }), CODE_INVALID);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { recoveryCode: "abcde-fghjk" } }), RECOVERY_CODE_INVALID);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: {} }), PROOF_REQUIRED);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId }), PROOF_REQUIRED);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret), recoveryCode: recoveryCodes[0] } }),
    PROOF_REQUIRED);
  await assert.rejects(service.verifySecondFactorOf({ proof: { code: codeAt(secret) } }), TypeError);
  const failures = events.filter((event) => event.type === "failed");
  assert.deepEqual(failures.map((event) => [event.userId, event.ip, event.via, event.reason]), [
    [adaId, "", "application", "codeInvalid"],
    [adaId, "", "application", "codeInvalid"],
    [adaId, "", "application", "recoveryCodeInvalid"]
  ]);
  const everyEvent = JSON.stringify(events);
  for (const shown of [secret, ...recoveryCodes]) {
    assert.equal(everyEvent.includes(shown), false, "no event carries a secret or a code");
  }
});

test("verifySecondFactorOf and a session's verification count the same wrong codes: failing through one locks the other", async (t) => {
  const { service, ada, adaPhone, adaId, bob, bobId, secret, recoveryCodes } = await enrolledAda(t);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: wrongCode(secret) } }), CODE_INVALID);
  }
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret) }), lockedFor(30));
  await assert.rejects(service.verifySecondFactor(adaPhone(), { recoveryCode: recoveryCodes[0] }), lockedFor(30));
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret) } }), lockedFor(30));

  // After the wait a right code here forgets the failures; then wrong codes in a session lock this call.
  t.mock.timers.tick(30_000);
  assert.equal((await service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret) } })).method, "code");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.verifySecondFactor(ada(), { code: wrongCode(secret) }), CODE_INVALID);
  }
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret) } }), lockedFor(30));
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { recoveryCode: recoveryCodes[0] } }), lockedFor(30));

  // Failures through both add up to one count.
  t.mock.timers.tick(30_000);
  assert.equal((await service.verifySecondFactor(ada(), { code: codeAt(secret) })).method, "code");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(service.verifySecondFactor(ada(), { code: wrongCode(secret) }), CODE_INVALID);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { recoveryCode: "abcde-fghjk" } }), RECOVERY_CODE_INVALID);
  }
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret) }), lockedFor(30));
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret) } }), lockedFor(30));

  // Another account's attempts count apart.
  const { secret: bobSecret } = await service.startSecondFactorSetup(bob());
  await service.confirmSecondFactorSetup(bob(), { code: codeAt(bobSecret) });
  t.mock.timers.tick(30_000);
  assert.equal((await service.verifySecondFactorOf({ userId: bobId, proof: { code: codeAt(bobSecret) } })).method, "code");
});

test("verifySecondFactorOf uses a recovery code up once, shared with the session's recovery codes", async (t) => {
  const { service, ada, adaId, recoveryCodes } = await enrolledAda(t);
  const [first, second] = recoveryCodes;
  const at = new Date().toISOString();
  assert.deepEqual(await service.verifySecondFactorOf({ userId: adaId, proof: { recoveryCode: ` ${first.toUpperCase()} ` } }), {
    verifiedAt: at,
    method: "recoveryCode",
    recoveryCodesLeft: 9
  });
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { recoveryCode: first } }), RECOVERY_CODE_INVALID);
  await assert.rejects(service.verifySecondFactor(ada(), { recoveryCode: first }), RECOVERY_CODE_INVALID);
  assert.equal((await service.verifySecondFactor(ada(), { recoveryCode: second })).recoveryCodesLeft, 8);
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { recoveryCode: second } }), RECOVERY_CODE_INVALID);
  assert.equal((await service.getSecondFactorStatus(ada())).recoveryCodesLeft, 8);
});

test("verifySecondFactorOf refuses an unknown account, a disabled one, one without an authenticator and a waiting one, each with its own code", async (t) => {
  const { service, backend, bob, adaId, bobId, secret } = await enrolledAda(t);
  await assert.rejects(service.verifySecondFactorOf({ userId: "usr_missing", proof: { code: "123456" } }), ACCOUNT_NOT_FOUND);
  // A disabled account is refused even with its authenticator's right code.
  const offSecret = toBase32(Buffer.from("12345678901234567890"));
  const at = new Date().toISOString();
  await backend.withTransaction(async (tx) => {
    await tx.users.create({ id: "usr_off", email: "off@example.com", displayName: "Off", password: NO_PASSWORD, disabled: true });
    await tx.secondFactors.save({
      userId: "usr_off",
      secretSealed: sealSecret(deriveSecondFactorKeys(SECOND_FACTOR_KEY), "usr_off", offSecret),
      confirmedAt: at,
      lastUsedStep: 0,
      recoveryCodes: [],
      failures: 0,
      lastFailedAt: "",
      lockedUntil: "",
      createdAt: at,
      updatedAt: at
    });
  });
  await assert.rejects(service.verifySecondFactorOf({ userId: "usr_off", proof: { code: codeAt(offSecret) } }), ACCOUNT_DISABLED);
  await assert.rejects(service.verifySecondFactorOf({ userId: bobId, proof: { code: "123456" } }), NOT_SET_UP);
  const { secret: started } = await service.startSecondFactorSetup(bob());
  await assert.rejects(service.verifySecondFactorOf({ userId: bobId, proof: { code: codeAt(started) } }), NOT_SET_UP,
    "a setup nobody confirmed is no authenticator");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: wrongCode(secret) } }), CODE_INVALID);
  }
  await assert.rejects(service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret) } }), lockedFor(30));
  // After the wait the account's code is accepted again.
  t.mock.timers.tick(30_000);
  assert.equal((await service.verifySecondFactorOf({ userId: adaId, proof: { code: codeAt(secret) } })).method, "code");
});

test("the file store keeps a factor and its session's proof across restarts, and another key cannot open it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const storeDir = await storeDirFor(t);
  const start = (env = {}) => createLocalAuthService({ ...secondFactorServiceOptions({ env }).options, backend: createLocalFileBackend({ storeDir }) });
  const first = start();
  await first.register({ email: "ada@example.com", password: "correct horse battery staple" });
  const cookies = sessionCookies((await first.login({ email: "ada@example.com", password: "correct horse battery staple" })).session);
  const { secret } = await first.startSecondFactorSetup({ cookies });
  const { recoveryCodes } = await first.confirmSecondFactorSetup({ cookies }, { code: codeAt(secret) });

  const restarted = start();
  assert.deepEqual(await restarted.getSecondFactorStatus({ cookies }), {
    enrolled: true,
    enrolledAt: new Date(SCENARIO_START).toISOString(),
    recoveryCodesLeft: 10,
    verifiedAt: new Date(SCENARIO_START).toISOString()
  });
  assert.equal((await restarted.verifySecondFactor({ cookies }, { recoveryCode: recoveryCodes[0] })).recoveryCodesLeft, 9);

  t.mock.timers.tick(30_000);
  const rekeyed = start({ AUTH_LOCAL_SECOND_FACTOR_KEY: `another key, also 32 characters or more` });
  await assert.rejects(rekeyed.verifySecondFactor({ cookies }, { code: codeAt(secret) }), (error) => {
    assert.equal(error.status, undefined, "a key that cannot open the secret is a server failure, not a refusal");
    assert.match(error.message, /does not open with AUTH_LOCAL_SECOND_FACTOR_KEY/u);
    return true;
  });
});

test("a production server has a second factor only with its key, at least 32 characters, and APP_PUBLIC_URL", async (t) => {
  const production = { APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "", AUTH_LOCAL_SECOND_FACTOR_KEY: "" };
  const service = createLocalAuthService({
    ...localServiceOptions({ env: production }),
    backend: createLocalFileBackend({ storeDir: await storeDirFor(t) })
  });
  assert.equal(service.getCapabilities().features.secondFactor, false);
  assert.throws(() => service.getSecondFactorStatus({ cookies: {} }), { status: 501, code: "AUTH_OPERATION_UNSUPPORTED" });
  assert.throws(() => service.listSecondFactors({ userIds: [] }), { status: 501, code: "AUTH_OPERATION_UNSUPPORTED" });
  assert.throws(() => service.verifySecondFactorOf({ userId: "usr_1", proof: { code: "123456" } }),
    { status: 501, code: "AUTH_OPERATION_UNSUPPORTED" });

  const resolve = (env) => resolveLocalAuthConfig({
    appRoot: os.tmpdir(),
    env: {
      AUTH_LOCAL_SESSION_SECRET: "test-session-secret",
      AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
      APP_PUBLIC_URL: "https://console.example.com",
      ...env
    },
    fileBackend: false,
    emailRecovery: false
  });
  assert.equal(resolve({ APP_ENV: "production", NODE_ENV: "production" }).secondFactorKey, "");
  assert.equal(resolve({ APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_SECOND_FACTOR_KEY: SECOND_FACTOR_KEY }).secondFactorKey, SECOND_FACTOR_KEY);
  assert.throws(() => resolve({ APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_SECOND_FACTOR_KEY: "too short" }), /at least 32 characters/u);
  assert.throws(() => resolve({ APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_SECOND_FACTOR_KEY: SECOND_FACTOR_KEY, APP_PUBLIC_URL: "" }),
    /APP_PUBLIC_URL is required when AUTH_LOCAL_SECOND_FACTOR_KEY is set/u);
  // Outside production the session secret stands in for the key.
  assert.equal(resolve({ APP_ENV: "development" }).secondFactorKey, "test-session-secret");
  assert.equal(createLocalAuthService({ ...localServiceOptions(), backend: createLocalFileBackend({ storeDir: await storeDirFor(t) }) })
    .getCapabilities().features.secondFactor, true);
});
