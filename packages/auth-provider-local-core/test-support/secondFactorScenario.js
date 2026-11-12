import assert from "node:assert/strict";
import { AUTH_TEXTS } from "@jskit-ai/auth-core/server/authTexts";
import { __testables } from "../src/server/lib/secondFactorCrypto.js";
import { localServiceOptions } from "./localService.js";
import { sessionCookies } from "./oauthHarness.js";

const { stepAt, totpCodeAt } = __testables;
const PASSWORD = "correct horse battery staple";
const IP = "203.0.113.7";
// A key as an application supplies it in AUTH_LOCAL_SECOND_FACTOR_KEY.
const SECOND_FACTOR_KEY = "test second factor key, 32 characters or more";
// The start of a 30-second step, so the scenario's whole-second ticks land where it expects.
const SCENARIO_START = Date.parse("2026-11-13T10:00:00.000Z");
const RECOVERY_CODE = /^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/u;

const SESSION_REQUIRED = AUTH_TEXTS.sessionRequired;
const NOT_SET_UP = Object.freeze({ status: 409, code: "auth.local.secondFactor.notSetUp" });
const ALREADY_SET_UP = Object.freeze({ status: 409, code: "auth.local.secondFactor.alreadySetUp" });
const SETUP_NOT_STARTED = Object.freeze({ status: 409, code: "auth.local.secondFactor.setupNotStarted" });
const PROOF_REQUIRED = Object.freeze({ status: 400, code: "auth.local.secondFactor.proofRequired" });
const CODE_INVALID = Object.freeze({ status: 400, code: "auth.local.secondFactor.codeInvalid" });
const CODE_USED = Object.freeze({ status: 400, code: "auth.local.secondFactor.codeUsed" });
const RECOVERY_CODE_INVALID = Object.freeze({ status: 400, code: "auth.local.secondFactor.recoveryCodeInvalid" });
const NOTHING_PROVED = Object.freeze({ enrolled: false, enrolledAt: null, recoveryCodesLeft: 0, verifiedAt: null });

/** Checks a refusal while the account waits after wrong codes: the minutes, the seconds and Retry-After. */
function lockedFor(seconds) {
  return (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "auth.local.secondFactor.locked");
    assert.deepEqual(error.params, { count: Math.ceil(seconds / 60), retryAfterSeconds: seconds });
    assert.equal(error.headers["retry-after"], String(seconds));
    return true;
  };
}

const now = () => new Date().toISOString();

/** The code the authenticator shows now, or `offset` steps from now. */
function codeAt(secret, offset = 0) {
  return totpCodeAt(secret, stepAt(Date.now()) + offset);
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
 * Local auth's options for a second factor scenario: the test settings with an
 * application's key, and a recorder of the events.
 */
function secondFactorServiceOptions({ env = {} } = {}) {
  const events = [];
  const options = localServiceOptions({ env: { AUTH_LOCAL_SECOND_FACTOR_KEY: SECOND_FACTOR_KEY, ...env } });
  return {
    events,
    options: {
      ...options,
      async secondFactorEvents(event) {
        events.push(event);
      }
    }
  };
}

/** Signs the account in; each call of the answer is a new request from that browser. */
async function signIn(service, email) {
  const cookies = sessionCookies((await service.login({ email, password: PASSWORD })).session);
  return () => ({ cookies, ip: IP });
}

/**
 * Local auth's second factor against any backend, from setup to removal and
 * the application's reset: run with Date mocked through `t.mock.timers`, from
 * the start of a 30-second step (SCENARIO_START).
 * @param {import("node:test").TestContext} t
 * @param {object} input
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} input.service
 * @param {object[]} input.events The events the service's secondFactorEvents recorded.
 * @param {() => Promise<string>} input.storedText Everything the backend keeps of the second factors, as text.
 */
async function exerciseSecondFactor(t, { service, events, storedText }) {
  await service.register({ email: "ada@example.com", password: PASSWORD, displayName: "Ada" });
  await service.register({ email: "bob@example.com", password: PASSWORD, displayName: "Bob" });
  const ada = await signIn(service, "ada@example.com");
  const adaPhone = await signIn(service, "ada@example.com");
  const bob = await signIn(service, "bob@example.com");
  const adaId = (await service.authenticateRequest(ada())).actor.providerUserId;
  const bobId = (await service.authenticateRequest(bob())).actor.providerUserId;

  // Nothing is set up yet, and a signed-out request works with no one's factor.
  assert.deepEqual(await service.getSecondFactorStatus(ada()), NOTHING_PROVED);
  await assert.rejects(service.getSecondFactorStatus({ cookies: {}, ip: IP }), SESSION_REQUIRED);
  await assert.rejects(service.startSecondFactorSetup({ cookies: {}, ip: IP }), SESSION_REQUIRED);
  await assert.rejects(service.verifySecondFactor({ cookies: {}, ip: IP }, { code: "123456" }), SESSION_REQUIRED);
  await assert.rejects(service.verifySecondFactor(ada(), { code: "123456" }), NOT_SET_UP);
  await assert.rejects(service.confirmSecondFactorSetup(ada(), { code: "123456" }), SETUP_NOT_STARTED);

  // The secret is shown once, as text and in the address an authenticator app reads from a QR code.
  const setup = await service.startSecondFactorSetup(ada());
  assert.match(setup.secret, /^[A-Z2-7]{32}$/u);
  assert.deepEqual(setup, {
    secret: setup.secret,
    otpauthUrl: `otpauth://totp/localhost%3A5173:ada%40example.com?secret=${setup.secret}` +
      "&issuer=localhost%3A5173&algorithm=SHA1&digits=6&period=30",
    issuer: "localhost:5173",
    accountName: "ada@example.com"
  });
  assert.equal((await service.getSecondFactorStatus(ada())).enrolled, false, "a started setup is no factor yet");
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(setup.secret) }), NOT_SET_UP);
  const restarted = await service.startSecondFactorSetup(ada());
  assert.notEqual(restarted.secret, setup.secret, "starting again replaces the setup nobody confirmed");
  await assert.rejects(service.confirmSecondFactorSetup(ada(), { code: wrongCode(restarted.secret) }), CODE_INVALID);

  // The first code confirms it and answers the recovery codes, once; it proves the second factor of that session only.
  const secret = restarted.secret;
  const confirmed = await service.confirmSecondFactorSetup(ada(), { code: codeAt(secret) });
  assert.equal(confirmed.verifiedAt, now());
  assert.equal(confirmed.recoveryCodes.length, 10);
  assert.equal(new Set(confirmed.recoveryCodes).size, 10);
  for (const code of confirmed.recoveryCodes) {
    assert.match(code, RECOVERY_CODE);
  }
  const enrolledAt = now();
  assert.deepEqual(await service.getSecondFactorStatus(ada()), { enrolled: true, enrolledAt, recoveryCodesLeft: 10, verifiedAt: enrolledAt });
  assert.equal((await service.getSecondFactorStatus(adaPhone())).verifiedAt, null, "the person's other session has not proved it");
  await assert.rejects(service.startSecondFactorSetup(ada()), ALREADY_SET_UP);
  await assert.rejects(service.confirmSecondFactorSetup(ada(), { code: codeAt(secret) }), ALREADY_SET_UP);

  // A code is accepted once: the first code again, or the one before it, is refused.
  await assert.rejects(service.verifySecondFactor(adaPhone(), { code: codeAt(secret) }), CODE_USED);
  await assert.rejects(service.verifySecondFactor(adaPhone(), { code: codeAt(secret, -1) }), CODE_USED);

  // The next step's code is accepted, typed as people type it.
  t.mock.timers.tick(30_000);
  const typed = codeAt(secret);
  assert.deepEqual(await service.verifySecondFactor(adaPhone(), { code: ` ${typed.slice(0, 3)} ${typed.slice(3)} ` }), {
    verifiedAt: now(),
    method: "code",
    recoveryCodesLeft: 10
  });
  assert.equal((await service.getSecondFactorStatus(adaPhone())).verifiedAt, now());
  assert.equal((await service.getSecondFactorStatus(ada())).verifiedAt, enrolledAt, "each session keeps its own proof");

  // A code two steps old has expired, one two steps ahead is not shown yet, and neither is right.
  t.mock.timers.tick(30_000);
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret, -2) }), CODE_INVALID);
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret, 2) }), CODE_INVALID);
  await assert.rejects(service.verifySecondFactor(ada(), { code: "12345" }), CODE_INVALID);
  // A proof is a code or a recovery code, never both or neither, and a missing one counts no attempt.
  await assert.rejects(service.verifySecondFactor(ada(), {}), PROOF_REQUIRED);
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret), recoveryCode: confirmed.recoveryCodes[0] }), PROOF_REQUIRED);
  assert.equal((await service.verifySecondFactor(ada(), { code: codeAt(secret) })).method, "code");

  // A recovery code proves it once, however it is typed.
  const [firstRecovery, secondRecovery] = confirmed.recoveryCodes;
  assert.deepEqual(await service.verifySecondFactor(adaPhone(), { recoveryCode: ` ${firstRecovery.toUpperCase()} ` }), {
    verifiedAt: now(),
    method: "recoveryCode",
    recoveryCodesLeft: 9
  });
  await assert.rejects(service.verifySecondFactor(adaPhone(), { recoveryCode: firstRecovery }), RECOVERY_CODE_INVALID);
  await assert.rejects(service.verifySecondFactor(adaPhone(), { recoveryCode: "not a code" }), RECOVERY_CODE_INVALID);
  assert.equal((await service.verifySecondFactor(adaPhone(), { recoveryCode: secondRecovery })).recoveryCodesLeft, 8);

  // Bob proves nothing with Ada's factor: with none of his own, then with his own, and naming hers changes nothing.
  await assert.rejects(service.verifySecondFactor(bob(), { recoveryCode: confirmed.recoveryCodes[2] }), NOT_SET_UP);
  const bobSetup = await service.startSecondFactorSetup(bob());
  const bobConfirmed = await service.confirmSecondFactorSetup(bob(), { code: codeAt(bobSetup.secret) });
  const bobEnrolledAt = now();
  await assert.rejects(service.verifySecondFactor(bob(), { recoveryCode: confirmed.recoveryCodes[2] }), RECOVERY_CODE_INVALID);
  await assert.rejects(service.removeSecondFactor(ada(), { recoveryCode: bobConfirmed.recoveryCodes[0], userId: bobId }),
    RECOVERY_CODE_INVALID);
  assert.equal((await service.verifySecondFactor(bob(), { recoveryCode: bobConfirmed.recoveryCodes[0] })).recoveryCodesLeft, 9);
  assert.equal((await service.getSecondFactorStatus(ada())).recoveryCodesLeft, 8);

  // Ada's next proof forgets that failure. Then five wrong codes make the account wait, even for a right code or a
  // recovery code, and the next wrong one doubles the wait.
  t.mock.timers.tick(30_000);
  assert.equal((await service.verifySecondFactor(ada(), { code: codeAt(secret) })).method, "code");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.verifySecondFactor(ada(), { code: wrongCode(secret) }), CODE_INVALID);
  }
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret) }), lockedFor(30));
  await assert.rejects(service.verifySecondFactor(adaPhone(), { recoveryCode: confirmed.recoveryCodes[3] }), lockedFor(30));
  await assert.rejects(service.removeSecondFactor(ada(), { code: codeAt(secret) }), lockedFor(30));
  assert.equal((await service.verifySecondFactor(bob(), { code: codeAt(bobSetup.secret) })).method, "code", "Bob's attempts count apart");
  t.mock.timers.tick(30_000);
  await assert.rejects(service.verifySecondFactor(ada(), { code: wrongCode(secret) }), CODE_INVALID);
  await assert.rejects(service.verifySecondFactor(ada(), { code: codeAt(secret) }), lockedFor(60));
  // A code after the wait is accepted and forgets the failures.
  t.mock.timers.tick(60_000);
  assert.equal((await service.verifySecondFactor(ada(), { code: codeAt(secret) })).method, "code");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(service.verifySecondFactor(ada(), { recoveryCode: "abcde-fghjk" }), RECOVERY_CODE_INVALID);
  }

  // New recovery codes replace every unused one.
  t.mock.timers.tick(30_000);
  const replaced = await service.replaceSecondFactorRecoveryCodes(ada(), { code: codeAt(secret) });
  assert.equal(replaced.verifiedAt, now());
  assert.equal(replaced.recoveryCodes.length, 10);
  await assert.rejects(service.verifySecondFactor(ada(), { recoveryCode: confirmed.recoveryCodes[4] }), RECOVERY_CODE_INVALID);
  assert.equal((await service.verifySecondFactor(ada(), { recoveryCode: replaced.recoveryCodes[0] })).recoveryCodesLeft, 9);

  // The store keeps the secret sealed and the recovery codes as keyed hashes.
  const stored = await storedText();
  assert.equal(stored.includes(secret), false, "the authenticator secret is not stored as it was shown");
  for (const code of [...replaced.recoveryCodes, ...bobConfirmed.recoveryCodes]) {
    assert.equal(stored.includes(code) || stored.includes(code.replace("-", "")), false, `recovery code ${code} is not stored`);
  }

  // Removing takes a proof; afterwards every session of the person must prove a second factor again, and cannot.
  await assert.rejects(service.removeSecondFactor(adaPhone(), { code: wrongCode(secret) }), CODE_INVALID);
  t.mock.timers.tick(30_000);
  assert.deepEqual(await service.removeSecondFactor(adaPhone(), { code: codeAt(secret) }), { ok: true });
  assert.deepEqual(await service.getSecondFactorStatus(ada()), NOTHING_PROVED);
  assert.deepEqual(await service.getSecondFactorStatus(adaPhone()), NOTHING_PROVED);
  await assert.rejects(service.verifySecondFactor(ada(), { recoveryCode: replaced.recoveryCodes[1] }), NOT_SET_UP);

  // The application lists the accounts with an authenticator (a started setup is none) and resets Bob's.
  await service.startSecondFactorSetup(ada());
  assert.deepEqual(await service.listSecondFactors({ userIds: [adaId, bobId, "usr_missing"] }), [{ userId: bobId, enrolledAt: bobEnrolledAt }]);
  assert.deepEqual(await service.listSecondFactors({ userIds: [] }), []);
  await assert.rejects(service.listSecondFactors({ userIds: bobId }), TypeError);
  await assert.rejects(service.resetSecondFactor({ userId: bobId }), TypeError);
  assert.notEqual((await service.getSecondFactorStatus(bob())).verifiedAt, null);
  assert.deepEqual(await service.resetSecondFactor({ userId: bobId, byUserId: adaId }), { reset: true });
  assert.deepEqual(await service.resetSecondFactor({ userId: bobId, byUserId: adaId }), { reset: false });
  assert.deepEqual(await service.getSecondFactorStatus(bob()), NOTHING_PROVED);
  assert.deepEqual(await service.listSecondFactors({ userIds: [adaId, bobId] }), []);

  // Each change and failed attempt is an event naming the account and where it came from, never a secret or a code.
  const label = (event) => [event.type, event.reason || event.method].filter(Boolean).join(":");
  assert.deepEqual(events.filter((event) => event.userId === bobId).map(label), [
    "setupStarted",
    "setupConfirmed",
    "failed:recoveryCodeInvalid",
    "verified:recoveryCode",
    "verified:code",
    "reset"
  ]);
  assert.deepEqual(events.find((event) => event.type === "reset"), { type: "reset", userId: bobId, ip: "", at: now(), byUserId: adaId });
  assert.deepEqual(events.find((event) => event.type === "removed"), { type: "removed", userId: adaId, ip: IP, at: now(), method: "code" });
  const adaFailures = events.filter((event) => event.userId === adaId && event.type === "failed").map((event) => event.reason);
  assert.equal(adaFailures.filter((reason) => reason === "locked").length, 4);
  for (const event of events) {
    assert.equal(event.ip === IP || event.type === "reset", true, `${event.type} names where it came from`);
  }
  const everyEvent = JSON.stringify(events);
  for (const shown of [setup.secret, secret, bobSetup.secret, ...confirmed.recoveryCodes, ...replaced.recoveryCodes]) {
    assert.equal(everyEvent.includes(shown), false);
  }
}

export { SCENARIO_START, SECOND_FACTOR_KEY, codeAt, exerciseSecondFactor, secondFactorServiceOptions };
