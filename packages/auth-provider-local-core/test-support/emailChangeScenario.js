import assert from "node:assert/strict";
import { createLocalAuthService, createLocalDeliveries } from "../src/server/lib/index.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { AUTH_TEXTS } from "@jskit-ai/auth-core/server/authTexts";
import { localServiceOptions } from "./localService.js";

const PASSWORD = "correct horse battery staple";
const DAY = 24 * 60 * 60 * 1000;

/**
 * A local auth service over the backend whose email-change sender keeps what it is given, sent through deliveries the
 * test waits for.
 * @param {import("../src/server/types.js").AuthLocalBackend} backend
 */
function emailChangeService(backend) {
  const deliveries = createLocalDeliveries({ logger: silentLogger });
  const sent = [];
  const service = createLocalAuthService({
    ...localServiceOptions({ emailChangeSender: true }),
    backend,
    deliveries,
    emailChangeSender: async (delivery) => {
      sent.push(delivery);
    }
  });
  /** What was sent so far, once every send finished; it forgets them. */
  async function takeSent() {
    await deliveries.settled();
    return sent.splice(0);
  }
  return { service, takeSent };
}

function sessionCookies(session) {
  return { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token };
}

const tokenOf = (delivery) => new URL(delivery.confirmationUrl).searchParams.get("token");

/**
 * An account's email change, against any backend, with Date mocked through `t.mock.timers`: the signed-in person
 * asks with their password, or the application asks for an account; a link goes to the new address, and using it
 * changes the email and tells the old address. A newer request, a used link, an expired one and one for an email
 * taken since are refused; refusals change and send nothing.
 * @param {import("node:test").TestContext} t
 * @param {import("../src/server/types.js").AuthLocalBackend} backend
 * @returns {Promise<{ adaId: string, bobId: string }>} The accounts it changed, for the backend's own checks.
 */
async function exerciseEmailChange(t, backend) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-15T09:00:00.000Z") });
  const { service, takeSent } = emailChangeService(backend);
  const ada = await service.register({ email: "ada@example.com", password: PASSWORD });
  const bob = await service.register({ email: "bob@example.com", password: PASSWORD });
  const adaId = ada.actor.providerUserId;
  const bobId = bob.actor.providerUserId;
  const signedIn = { cookies: sessionCookies(ada.session) };
  const user = (id) => backend.withTransaction((tx) => tx.users.findById(id));

  // Refused: no session, a wrong password, no email or not an email, the same email, another account's email.
  await assert.rejects(service.requestEmailChange({ cookies: {} }, { email: "new@example.com", password: PASSWORD }),
    AUTH_TEXTS.sessionRequired);
  await assert.rejects(service.requestEmailChange(signedIn, { email: "new@example.com", password: "a wrong password" }),
    { status: 400, code: "auth.local.emailChange.passwordInvalid" });
  for (const email of ["", "not an email"]) {
    await assert.rejects(service.requestEmailChange(signedIn, { email, password: PASSWORD }),
      { status: 400, code: "auth.local.email.invalid" }, email);
  }
  await assert.rejects(service.requestEmailChange(signedIn, { email: "Ada@Example.com", password: PASSWORD }),
    { status: 400, code: "auth.local.emailChange.sameEmail" });
  await assert.rejects(service.requestEmailChange(signedIn, { email: "bob@example.com", password: PASSWORD }),
    { status: 409, code: "auth.local.emailChange.emailTaken" });
  assert.deepEqual(await takeSent(), []);
  assert.equal((await user(adaId)).pendingEmail, "");

  // A request answers the new address and sends it a link; the email is unchanged until the link is used. A userId
  // in the request changes nothing: the session names the account.
  assert.deepEqual(
    await service.requestEmailChange(signedIn, { email: "Ada.First@example.com", password: PASSWORD, userId: bobId }),
    { ok: true, email: "ada.first@example.com" }
  );
  const [first] = await takeSent();
  assert.deepEqual({ ...first, confirmationUrl: "" },
    { type: "confirmation", email: "ada.first@example.com", currentEmail: "ada@example.com", confirmationUrl: "" });
  assert.match(first.confirmationUrl, /^http:\/\/localhost:5173\/auth\/email-change\?token=/u);
  assert.equal((await user(adaId)).email, "ada@example.com");
  assert.equal((await user(adaId)).pendingEmail, "ada.first@example.com");
  assert.equal((await user(bobId)).pendingEmail, "");

  // A newer request replaces it, so the first link no longer works.
  await service.requestEmailChange(signedIn, { email: "ada.second@example.com", password: PASSWORD });
  const [second] = await takeSent();
  await assert.rejects(service.confirmEmailChange({ token: tokenOf(first) }), { status: 400, code: "auth.local.emailChange.linkInvalid" });
  // A password reset sent to the old address before the change stops working once the email changes.
  const { recoveryUrl } = await service.requestPasswordReset({ email: "ada@example.com" });

  assert.deepEqual(await service.confirmEmailChange({ token: tokenOf(second) }), { ok: true, email: "ada.second@example.com" });
  assert.deepEqual(await takeSent(), [{ type: "notice", email: "ada@example.com", newEmail: "ada.second@example.com" }]);
  const changed = await user(adaId);
  assert.deepEqual([changed.email, changed.pendingEmail], ["ada.second@example.com", ""]);
  await assert.rejects(service.completePasswordRecovery({ code: new URL(recoveryUrl).searchParams.get("token") }),
    { code: "auth.local.recovery.tokenInvalid" });
  await assert.rejects(service.login({ email: "ada@example.com", password: PASSWORD }), { status: 401 });
  assert.equal((await service.login({ email: "ada.second@example.com", password: PASSWORD })).actor.email, "ada.second@example.com");
  // The session stays signed in, with the new email from its next request on.
  assert.equal((await service.authenticateRequest({ cookies: signedIn.cookies })).actor.email, "ada.second@example.com");
  // A used link, a link that is not one, and a link changed by hand are refused.
  for (const token of [tokenOf(second), "", "not-a-link", `${tokenOf(second)}x`]) {
    await assert.rejects(service.confirmEmailChange({ token }), { status: 400, code: "auth.local.emailChange.linkInvalid" }, token);
  }

  // The application asks for an account, without a password; a missing id is a programming error, a missing account
  // is refused.
  assert.deepEqual(await service.requestEmailChangeForUser({ userId: bobId, email: "bob.new@example.com" }),
    { ok: true, email: "bob.new@example.com" });
  const [bobLink] = await takeSent();
  assert.deepEqual([bobLink.type, bobLink.email, bobLink.currentEmail], ["confirmation", "bob.new@example.com", "bob@example.com"]);
  await assert.rejects(service.requestEmailChangeForUser({ userId: "", email: "x@example.com" }), TypeError);
  await assert.rejects(service.requestEmailChangeForUser({ userId: "usr_missing", email: "x@example.com" }),
    { status: 404, code: "auth.local.emailChange.accountNotFound" });
  await assert.rejects(service.requestEmailChangeForUser({ userId: bobId, email: "ada.second@example.com" }),
    { status: 409, code: "auth.local.emailChange.emailTaken" });
  assert.deepEqual(await takeSent(), []);

  // A link expires after a day.
  t.mock.timers.tick(DAY + 1000);
  await assert.rejects(service.confirmEmailChange({ token: tokenOf(bobLink) }), { status: 400, code: "auth.local.emailChange.linkInvalid" });
  assert.equal((await user(bobId)).email, "bob@example.com");

  // An address an account took since the request is refused, and nothing changes.
  await service.requestEmailChangeForUser({ userId: bobId, email: "carol@example.com" });
  const [toCarol] = await takeSent();
  await service.register({ email: "carol@example.com", password: PASSWORD });
  await assert.rejects(service.confirmEmailChange({ token: tokenOf(toCarol) }), { status: 409, code: "auth.local.emailChange.emailTaken" });
  assert.equal((await user(bobId)).email, "bob@example.com");
  assert.deepEqual(await takeSent(), []);
  return { adaId, bobId };
}

export { emailChangeService, exerciseEmailChange };
