import assert from "node:assert/strict";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createLocalAuthService, createLocalDeliveries } from "../src/server/lib/index.js";
import { sha256Base64url } from "../src/server/lib/tokens.js";
import { localServiceOptions } from "./localService.js";
import { sessionCookies } from "./passSignInScenario.js";
import { requestFrom } from "./sessionMetadataScenario.js";

const PASSWORD = "correct horse battery staple";
const CHANGED_PASSWORD = "a changed password value";
const RESET_PASSWORD = "a reset password value";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const MINUTE = 60_000;

/**
 * A local auth service over the backend whose email-change sender keeps what it is given, sent through deliveries the
 * test waits for.
 * @param {import("../src/server/types.js").AuthLocalBackend} backend
 * @param {Record<string, string>} [env]
 */
function signInFactsService(backend, env = {}) {
  const deliveries = createLocalDeliveries({ logger: silentLogger });
  const sent = [];
  const service = createLocalAuthService({
    ...localServiceOptions({ env, emailChangeSender: true }),
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

/**
 * How a session was signed in, and when its account's credentials last changed, against any backend, with Date
 * mocked through `t.mock.timers`. A session keeps the address, browser and time of the request that signed it in:
 * later requests from elsewhere, and a refresh, move where it was last seen and never where it was signed in from.
 * Registering, and confirming a registration's email, change no credential; a password change, a password reset and a
 * used email-change link each set when that credential changed, and asking for an email change does not. A sign-in
 * without a request has no address or browser, as a session from before sessions kept them.
 * @param {import("node:test").TestContext} t
 * @param {import("../src/server/types.js").AuthLocalBackend} backend
 */
async function exerciseSignInFacts(t, backend) {
  const start = Date.parse("2026-11-23T09:00:00.000Z");
  const at = (minutes) => new Date(start + minutes * MINUTE).toISOString();
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const { service, takeSent } = signInFactsService(backend);
  const answerFor = async (request) => {
    const answer = await service.authenticateRequest(request);
    assert.equal(answer.authenticated, true);
    return answer;
  };
  const storedSession = (refreshToken) => backend.withTransaction((tx) => tx.sessions.findByTokenHash(sha256Base64url(refreshToken)));
  const seenAndSignedIn = async (refreshToken) => {
    const session = await storedSession(refreshToken);
    return { ip: session.ip, userAgent: session.userAgent, signInIp: session.signInIp, signInUserAgent: session.signInUserAgent };
  };

  // Registering signs in from its request and changes no credential.
  const registered = await service.register({ email: "ada@example.com", password: PASSWORD }, requestFrom("192.0.2.1", PHONE));
  const registeredAnswer = await answerFor(requestFrom("192.0.2.1", PHONE, sessionCookies(registered.session)));
  assert.deepEqual(registeredAnswer.signIn, { at: at(0), ip: "192.0.2.1", userAgent: PHONE, purpose: "normal" });
  assert.deepEqual(registeredAnswer.credentialsChangedAt, { password: "", email: "" });

  // A sign-in keeps its own request's address and browser, and its time.
  t.mock.timers.tick(MINUTE);
  const signedIn = await service.login({ email: "ada@example.com", password: PASSWORD }, requestFrom("203.0.113.7", FIREFOX));
  const cookies = sessionCookies(signedIn.session);
  const signIn = { at: at(1), ip: "203.0.113.7", userAgent: FIREFOX, purpose: "normal" };
  assert.deepEqual((await answerFor(requestFrom("203.0.113.7", FIREFOX, cookies))).signIn, signIn);

  // A visit from elsewhere after five minutes moves where the session was last seen, never where it was signed in from.
  t.mock.timers.tick(6 * MINUTE);
  assert.deepEqual((await answerFor(requestFrom("198.51.100.9", PHONE, cookies))).signIn, signIn);
  assert.deepEqual(await seenAndSignedIn(cookies.jskit_local_refresh_token),
    { ip: "198.51.100.9", userAgent: PHONE, signInIp: "203.0.113.7", signInUserAgent: FIREFOX });
  // Nor does a refresh, once the access token has expired: the session is signed in as long ago as before.
  t.mock.timers.tick(20 * MINUTE);
  const refreshed = await answerFor(requestFrom("198.51.100.10", PHONE, { jskit_local_refresh_token: cookies.jskit_local_refresh_token }));
  assert.ok(refreshed.session, "the refresh answers new cookies");
  assert.deepEqual(refreshed.signIn, signIn);
  assert.deepEqual(await seenAndSignedIn(cookies.jskit_local_refresh_token),
    { ip: "198.51.100.10", userAgent: PHONE, signInIp: "203.0.113.7", signInUserAgent: FIREFOX });
  assert.deepEqual(refreshed.credentialsChangedAt, { password: "", email: "" });

  // A password change sets when the password changed.
  t.mock.timers.tick(MINUTE);
  const changeRequest = requestFrom("203.0.113.7", FIREFOX, sessionCookies(refreshed.session));
  await service.changePassword(changeRequest, { currentPassword: PASSWORD, newPassword: CHANGED_PASSWORD });
  assert.deepEqual((await answerFor(requestFrom("203.0.113.7", FIREFOX, sessionCookies(refreshed.session)))).credentialsChangedAt,
    { password: at(28), email: "" });

  // A password reset sets it too. Its recovery session keeps its own sign-in, as purpose recovery.
  t.mock.timers.tick(MINUTE);
  const { recoveryUrl } = await service.requestPasswordReset({ email: "ada@example.com" });
  const recovery = await service.completePasswordRecovery({ code: new URL(recoveryUrl).searchParams.get("token") },
    requestFrom("192.0.2.50", PHONE));
  const recoverySession = await storedSession(recovery.session.refresh_token);
  assert.deepEqual([recoverySession.purpose, recoverySession.signInIp, recoverySession.signInUserAgent], ["recovery", "192.0.2.50", PHONE]);
  t.mock.timers.tick(MINUTE);
  await service.resetPassword({ password: RESET_PASSWORD }, { cookies: { jskit_local_recovery_token: recovery.session.access_token } });
  const afterReset = await service.login({ email: "ada@example.com", password: RESET_PASSWORD }, requestFrom("203.0.113.7", FIREFOX));
  const afterResetCookies = sessionCookies(afterReset.session);
  assert.deepEqual((await answerFor(requestFrom("203.0.113.7", FIREFOX, afterResetCookies))).credentialsChangedAt,
    { password: at(30), email: "" });

  // Asking for an email change changes nothing yet; using its link sets when the email changed.
  t.mock.timers.tick(MINUTE);
  await service.requestEmailChange(requestFrom("203.0.113.7", FIREFOX, afterResetCookies), { email: "ada.new@example.com", password: RESET_PASSWORD });
  assert.deepEqual((await answerFor(requestFrom("203.0.113.7", FIREFOX, afterResetCookies))).credentialsChangedAt,
    { password: at(30), email: "" });
  t.mock.timers.tick(MINUTE);
  const [confirmation] = await takeSent();
  await service.confirmEmailChange({ token: new URL(confirmation.confirmationUrl).searchParams.get("token") });
  const afterEmailChange = await answerFor(requestFrom("203.0.113.7", FIREFOX, afterResetCookies));
  assert.deepEqual(afterEmailChange.credentialsChangedAt, { password: at(30), email: at(32) });
  assert.deepEqual(afterEmailChange.signIn, { at: at(30), ip: "203.0.113.7", userAgent: FIREFOX, purpose: "normal" },
    "no credential change moves a session's sign-in");

  // A sign-in without a request keeps no address or browser, as a session from before sessions kept them.
  const internal = await service.login({ email: "ada.new@example.com", password: RESET_PASSWORD });
  assert.deepEqual((await answerFor(requestFrom("203.0.113.7", FIREFOX, sessionCookies(internal.session)))).signIn,
    { at: at(32), ip: "", userAgent: "", purpose: "normal" });

  // A registration confirmed by its email's link changes no credential either.
  const confirming = signInFactsService(backend, { AUTH_LOCAL_EMAIL_CONFIRMATION: "" }).service;
  const waiting = await confirming.register({ email: "bob@example.com", password: PASSWORD }, requestFrom("192.0.2.7", PHONE));
  const confirmed = await confirming.confirmRegistration({
    token: new URL(waiting.confirmationUrl).searchParams.get("confirmation_token"),
    password: PASSWORD
  }, requestFrom("192.0.2.8", FIREFOX));
  const confirmedAnswer = await confirming.authenticateRequest(requestFrom("192.0.2.8", FIREFOX, sessionCookies(confirmed.session)));
  assert.deepEqual(confirmedAnswer.signIn, { at: at(32), ip: "192.0.2.8", userAgent: FIREFOX, purpose: "normal" });
  assert.deepEqual(confirmedAnswer.credentialsChangedAt, { password: "", email: "" });
}

export { FIREFOX, PHONE, exerciseSignInFacts };
