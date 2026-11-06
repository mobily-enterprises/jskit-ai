import assert from "node:assert/strict";
import { AUTH_TEXTS } from "@jskit-ai/auth-core/server/authTexts";
import { sha256Base64url } from "../src/server/lib/tokens.js";

const PASSWORD = "correct horse battery staple";
const EMAIL = "ada@example.com";
const invalidLink = { status: 400, code: "auth.local.register.confirmationInvalid" };

/** The code of a development confirmation link. */
function linkToken(result) {
  assert.match(result.confirmationUrl, /^http:\/\/localhost:5173\/auth\/login\?confirmation_token=/u);
  return new URL(result.confirmationUrl).searchParams.get("confirmation_token");
}

/**
 * Registration with email confirmation in development, against any backend:
 * run with Date mocked through `t.mock.timers`. `storedRegistrations` answers
 * what the backend keeps of waiting registrations, as text, so the scenario
 * can check that a link's code is kept only as its hash.
 * @param {import("node:test").TestContext} t
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} service
 * @param {() => Promise<string>} storedRegistrations
 */
async function exerciseEmailConfirmation(t, service, storedRegistrations) {
  // Registering keeps the account waiting: nobody is signed in, and development shows the link.
  const registered = await service.register({ email: EMAIL, password: PASSWORD, displayName: "Ada" });
  assert.equal(registered.requiresEmailConfirmation, true);
  assert.equal(registered.session, null);
  assert.equal(registered.actor, null);
  const firstToken = linkToken(registered);
  assert.ok(firstToken.length >= 40);
  const stored = await storedRegistrations();
  assert.equal(stored.includes(firstToken), false);
  assert.equal(stored.includes(sha256Base64url(firstToken)), true);

  // Until it is confirmed, the right password is refused as unconfirmed; a wrong one is an ordinary failure.
  await assert.rejects(service.login({ email: EMAIL, password: PASSWORD }), {
    status: 403,
    code: AUTH_TEXTS.emailUnconfirmed.code
  });
  await assert.rejects(service.login({ email: EMAIL, password: "a wrong password" }), {
    status: 401,
    code: AUTH_TEXTS.invalidCredentials.code
  });

  // Registering again, or asking for a new link, replaces the link.
  const secondToken = linkToken(await service.register({ email: EMAIL, password: PASSWORD, displayName: "Ada" }));
  await assert.rejects(service.confirmRegistration({ token: firstToken }), invalidLink);
  const resent = await service.resendRegisterConfirmation({ email: EMAIL });
  assert.equal(resent.messageCode, "auth.local.register.confirmationResent");
  const thirdToken = linkToken(resent);
  await assert.rejects(service.confirmRegistration({ token: secondToken }), invalidLink);
  // The answer for an email nobody registered is the same, without a link.
  assert.deepEqual(await service.resendRegisterConfirmation({ email: "nobody@example.com" }), {
    ok: true,
    message: resent.message,
    messageCode: resent.messageCode,
    messageParams: {}
  });

  // Confirming creates the account and signs the person in; its password signs in too.
  const confirmed = await service.confirmRegistration({ token: thirdToken });
  assert.ok(confirmed.session.access_token);
  assert.equal(confirmed.actor.email, EMAIL);
  assert.equal(confirmed.actor.displayName, "Ada");
  assert.equal((await service.login({ email: EMAIL, password: PASSWORD })).actor.email, EMAIL);
  assert.equal((await storedRegistrations()).includes(sha256Base64url(thirdToken)), false);

  // The link works once, and the confirmed email cannot register again.
  await assert.rejects(service.confirmRegistration({ token: thirdToken }), invalidLink);
  await assert.rejects(service.register({ email: EMAIL, password: PASSWORD }), {
    status: 409,
    code: "auth.local.register.emailTaken"
  });

  // A link expires after a day; the waiting password is then an ordinary failed sign-in.
  const lateToken = linkToken(await service.register({ email: "late@example.com", password: PASSWORD }));
  t.mock.timers.tick(24 * 60 * 60 * 1000 + 1000);
  await assert.rejects(service.confirmRegistration({ token: lateToken }), invalidLink);
  await assert.rejects(service.login({ email: "late@example.com", password: PASSWORD }), {
    status: 401,
    code: AUTH_TEXTS.invalidCredentials.code
  });
}

export { exerciseEmailConfirmation };
