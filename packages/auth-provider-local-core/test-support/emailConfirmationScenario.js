import assert from "node:assert/strict";
import { AUTH_TEXTS } from "@jskit-ai/auth-core/server/authTexts";
import { sha256Base64url } from "../src/server/lib/tokens.js";

const PASSWORD = "correct horse battery staple";
const EMAIL = "ada@example.com";
const invalidLink = { status: 400, code: "auth.local.register.confirmationInvalid" };
const wrongPassword = { status: 400, code: "auth.local.register.confirmationPasswordInvalid" };
const invalidCredentials = { status: 401, code: AUTH_TEXTS.invalidCredentials.code };
const unconfirmed = { status: 403, code: AUTH_TEXTS.emailUnconfirmed.code };

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
  await assert.rejects(service.login({ email: EMAIL, password: PASSWORD }), unconfirmed);
  await assert.rejects(service.login({ email: EMAIL, password: "a wrong password" }), invalidCredentials);

  // Asking for a new link replaces the link.
  const resent = await service.resendRegisterConfirmation({ email: EMAIL });
  assert.equal(resent.messageCode, "auth.local.register.confirmationResent");
  const secondToken = linkToken(resent);
  await assert.rejects(service.confirmRegistration({ token: firstToken, password: PASSWORD }), invalidLink);
  // The answer for an email nobody registered is the same, without a link.
  assert.deepEqual(await service.resendRegisterConfirmation({ email: "nobody@example.com" }), {
    ok: true,
    message: resent.message,
    messageCode: resent.messageCode,
    messageParams: {}
  });

  // The link alone, or with another password, creates nothing: the registration and its link still wait.
  await assert.rejects(service.confirmRegistration({ token: secondToken }), wrongPassword);
  await assert.rejects(service.confirmRegistration({ token: secondToken, password: "a wrong password" }), wrongPassword);
  await assert.rejects(service.login({ email: EMAIL, password: PASSWORD }), unconfirmed);

  // Confirming with the registration's password creates the account and signs the person in; its password signs in too.
  const confirmed = await service.confirmRegistration({ token: secondToken, password: PASSWORD });
  assert.ok(confirmed.session.access_token);
  assert.equal(confirmed.actor.email, EMAIL);
  assert.equal(confirmed.actor.displayName, "Ada");
  assert.equal((await service.login({ email: EMAIL, password: PASSWORD })).actor.email, EMAIL);
  assert.equal((await storedRegistrations()).includes(sha256Base64url(secondToken)), false);

  // The link works once, and the confirmed email cannot register again.
  await assert.rejects(service.confirmRegistration({ token: secondToken, password: PASSWORD }), invalidLink);
  await assert.rejects(service.register({ email: EMAIL, password: PASSWORD }), {
    status: 409,
    code: "auth.local.register.emailTaken"
  });

  // A link expires after a day; the waiting password is then an ordinary failed sign-in, asking for a new link sends
  // none, and registering again starts afresh.
  const lateToken = linkToken(await service.register({ email: "late@example.com", password: PASSWORD }));
  t.mock.timers.tick(24 * 60 * 60 * 1000 + 1000);
  await assert.rejects(service.confirmRegistration({ token: lateToken, password: PASSWORD }), invalidLink);
  await assert.rejects(service.login({ email: "late@example.com", password: PASSWORD }), invalidCredentials);
  assert.equal(Object.hasOwn(await service.resendRegisterConfirmation({ email: "late@example.com" }), "confirmationUrl"), false);
  const againToken = linkToken(await service.register({ email: "late@example.com", password: PASSWORD }));
  assert.equal((await service.confirmRegistration({ token: againToken, password: PASSWORD })).actor.email, "late@example.com");
}

/**
 * Registering an email someone else owns, before its owner registers it or
 * after, against any backend with confirmation on. Each link stands for the
 * email its owner receives (development shows it in the answer), and the owner
 * opens it with their own password. Whatever the order, the account a link
 * creates opens only with the owner's password.
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} service
 */
async function exerciseRegistrationTakeover(service) {
  const ownPassword = "the owner's own password";
  const otherPassword = "someone else's password";

  // Someone else registers the email first; its owner ignores that link and later registers it.
  const before = "before@example.com";
  linkToken(await service.register({ email: before, password: otherPassword, displayName: "Someone else" }));
  const ownLink = linkToken(await service.register({ email: before, password: ownPassword, displayName: "Owner" }));
  const first = await service.confirmRegistration({ token: ownLink, password: ownPassword });
  assert.equal(first.actor.displayName, "Owner");
  assert.equal((await service.login({ email: before, password: ownPassword })).actor.email, before);
  await assert.rejects(service.login({ email: before, password: otherPassword }), invalidCredentials);

  // The owner registers first; someone else registers the email later. The owner's link stops working, and the new
  // one, which reaches the owner too, does not open with the owner's password: nothing is created.
  const after = "after@example.com";
  const ownFirst = linkToken(await service.register({ email: after, password: ownPassword, displayName: "Owner" }));
  const theirs = linkToken(await service.register({ email: after, password: otherPassword, displayName: "Someone else" }));
  await assert.rejects(service.confirmRegistration({ token: ownFirst, password: ownPassword }), invalidLink);
  await assert.rejects(service.confirmRegistration({ token: theirs, password: ownPassword }), wrongPassword);
  await assert.rejects(service.login({ email: after, password: otherPassword }), unconfirmed);
  // Registering again gives the owner a link that works.
  const ownAgain = linkToken(await service.register({ email: after, password: ownPassword, displayName: "Owner" }));
  const second = await service.confirmRegistration({ token: ownAgain, password: ownPassword });
  assert.equal(second.actor.displayName, "Owner");
  await assert.rejects(service.login({ email: after, password: otherPassword }), invalidCredentials);

  // A link the owner never asked for creates nothing when opened with the owner's password, and asking for a new
  // link, which anyone may, keeps the registration's password.
  const unasked = "unasked@example.com";
  const unaskedLink = linkToken(await service.register({ email: unasked, password: otherPassword }));
  await assert.rejects(service.confirmRegistration({ token: unaskedLink, password: ownPassword }), wrongPassword);
  const resentLink = linkToken(await service.resendRegisterConfirmation({ email: unasked }));
  await assert.rejects(service.confirmRegistration({ token: resentLink, password: ownPassword }), wrongPassword);
  await assert.rejects(service.login({ email: unasked, password: ownPassword }), invalidCredentials);
}

export { exerciseEmailConfirmation, exerciseRegistrationTakeover };
