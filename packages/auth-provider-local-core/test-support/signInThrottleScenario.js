import assert from "node:assert/strict";
import { AUTH_TEXTS } from "@jskit-ai/auth-core/server/authTexts";

const PASSWORD = "correct horse battery staple";

/**
 * Checks one refusal of a waiting account: status, code, the wait in minutes
 * and seconds, and the Retry-After header.
 * @param {number} seconds
 */
function lockedFor(seconds) {
  return (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "auth.local.login.locked");
    assert.deepEqual(error.params, { count: Math.ceil(seconds / 60), retryAfterSeconds: seconds });
    assert.equal(error.headers["retry-after"], String(seconds));
    return true;
  };
}

/**
 * The per-account sign-in throttle with its default settings, against any
 * backend: run with Date mocked through `t.mock.timers`.
 * @param {import("node:test").TestContext} t
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} service
 */
async function exerciseSignInThrottle(t, service) {
  await service.register({ email: "ada@example.com", password: PASSWORD, displayName: "Ada" });
  const signIn = (password, email = "ada@example.com") => service.login({ email, password });
  const invalid = { status: 401, code: AUTH_TEXTS.invalidCredentials.code };

  // 25 rapid guesses: five are checked, then the account waits, even for the right password.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(signIn(`guess ${attempt}`), invalid);
  }
  for (let attempt = 5; attempt < 25; attempt += 1) {
    await assert.rejects(signIn(`guess ${attempt}`), lockedFor(30));
  }
  await assert.rejects(signIn(PASSWORD), lockedFor(30));

  // The next failure after the wait doubles it.
  t.mock.timers.tick(30_000);
  await assert.rejects(signIn("another guess"), invalid);
  await assert.rejects(signIn(PASSWORD), lockedFor(60));

  // A success after the wait forgets the failures.
  t.mock.timers.tick(60_000);
  assert.equal((await signIn(PASSWORD)).actor.email, "ada@example.com");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(signIn(`fresh guess ${attempt}`), invalid);
  }
  assert.equal((await signIn(PASSWORD)).actor.email, "ada@example.com");

  // An email without an account waits the same way, so waiting reveals nothing.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(signIn(`guess ${attempt}`, "nobody@example.com"), invalid);
  }
  await assert.rejects(signIn("any", "nobody@example.com"), lockedFor(30));

  // Failures are forgotten a day after the last one.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(signIn(`old guess ${attempt}`), invalid);
  }
  t.mock.timers.tick(24 * 60 * 60 * 1000 + 1000);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(signIn(`new guess ${attempt}`), invalid);
  }
  assert.equal((await signIn(PASSWORD)).actor.email, "ada@example.com");
}

export { exerciseSignInThrottle, lockedFor };
