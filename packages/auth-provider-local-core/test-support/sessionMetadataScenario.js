import assert from "node:assert/strict";

const PASSWORD = "correct horse battery staple";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const MINUTE = 60_000;

/**
 * A request as Fastify gives it: from this address and browser, with these cookies.
 * @param {string} ip
 * @param {string} userAgent
 * @param {Record<string, string>} [cookies]
 */
function requestFrom(ip, userAgent, cookies = {}) {
  return { ip, headers: { "user-agent": userAgent }, cookies };
}

function sessionCookies(session) {
  return { jskit_local_access_token: session.access_token, jskit_local_refresh_token: session.refresh_token };
}

/**
 * Where and when a session was last seen, against any backend, for a service whose Date the test mocks: a session
 * keeps the address and browser of the request that signed it in, and those of a request that finds it more than five
 * minutes after it was last seen, with when that was; requests in between write nothing.
 * @param {import("node:test").TestContext} t
 * @param {object} fixtures
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} fixtures.service
 * @param {import("../src/server/types.js").AuthLocalBackend} fixtures.backend
 */
async function exerciseSessionMetadata(t, { service, backend }) {
  const start = Date.parse("2026-11-15T09:00:00.000Z");
  const at = (minutes) => new Date(start + minutes * MINUTE).toISOString();
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const registered = await service.register({ email: "ada@example.com", password: PASSWORD }, requestFrom("192.0.2.1", PHONE));
  const signedIn = await service.login({ email: "ada@example.com", password: PASSWORD }, requestFrom("203.0.113.7", FIREFOX));
  const cookies = sessionCookies(signedIn.session);
  const seen = async (request) => {
    const answer = await service.authenticateRequest(request);
    assert.equal(answer.authenticated, true);
    const session = await backend.withTransaction((tx) => tx.sessions.findById(answer.sessionId));
    return { ip: session.ip, userAgent: session.userAgent, lastSeenAt: session.lastSeenAt, createdAt: session.createdAt };
  };

  // The sign-in's request, and the registration's for the session registering made.
  assert.deepEqual(await seen(requestFrom("203.0.113.7", FIREFOX, cookies)),
    { ip: "203.0.113.7", userAgent: FIREFOX, lastSeenAt: at(0), createdAt: at(0) });
  assert.deepEqual(await seen(requestFrom("192.0.2.1", PHONE, sessionCookies(registered.session))),
    { ip: "192.0.2.1", userAgent: PHONE, lastSeenAt: at(0), createdAt: at(0) });

  // Within five minutes of being seen, a request from elsewhere changes nothing.
  t.mock.timers.tick(4 * MINUTE);
  assert.deepEqual(await seen(requestFrom("198.51.100.9", PHONE, cookies)),
    { ip: "203.0.113.7", userAgent: FIREFOX, lastSeenAt: at(0), createdAt: at(0) });
  // After them, it is seen again from there.
  t.mock.timers.tick(2 * MINUTE);
  assert.deepEqual(await seen(requestFrom("198.51.100.9", PHONE, cookies)),
    { ip: "198.51.100.9", userAgent: PHONE, lastSeenAt: at(6), createdAt: at(0) });
  // A request that does not say where it is from keeps where the session was last seen from.
  t.mock.timers.tick(6 * MINUTE);
  assert.deepEqual(await seen({ cookies }), { ip: "198.51.100.9", userAgent: PHONE, lastSeenAt: at(12), createdAt: at(0) });
  // A session found by its refresh token, once its access token has expired, is seen too.
  t.mock.timers.tick(20 * MINUTE);
  assert.deepEqual(await seen(requestFrom("203.0.113.7", FIREFOX, { jskit_local_refresh_token: cookies.jskit_local_refresh_token })),
    { ip: "203.0.113.7", userAgent: FIREFOX, lastSeenAt: at(32), createdAt: at(0) });

  // A browser that names itself at length is kept to its first 512 characters; a sign-in with no request keeps no place.
  const long = `${FIREFOX} ${"x".repeat(600)}`;
  const longSignIn = await service.login({ email: "ada@example.com", password: PASSWORD }, requestFrom("203.0.113.8", long));
  assert.equal((await seen({ cookies: sessionCookies(longSignIn.session) })).userAgent, long.slice(0, 512));
  const internal = await service.login({ email: "ada@example.com", password: PASSWORD });
  assert.deepEqual(await seen({ cookies: sessionCookies(internal.session) }),
    { ip: "", userAgent: "", lastSeenAt: at(32), createdAt: at(32) });
}

export { exerciseSessionMetadata, requestFrom };
