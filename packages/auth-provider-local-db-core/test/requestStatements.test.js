import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthService, hashPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

const PASSWORD = "a long enough password value";

// Every request reads its session and its user, so a revoked session or a disabled account is refused from the next
// request on. The two reads need no transaction around them, and the session is noted as seen at most every five
// minutes, so an authenticated request costs two statements however many come.
test("an authenticated request costs two statements, its session and its user, and a revoked session or disabled account is refused from the next", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { accounts, backend, knex, sessions } = await openSqliteLocalAuth(t);
  const service = createLocalAuthService({ ...localServiceOptions(), backend });
  await accounts.create({ id: "usr_req", email: "req@example.com", displayName: "Req", password: await hashPassword(PASSWORD) });
  const signIn = async () => (await service.login({ email: "req@example.com", password: PASSWORD }, null)).session;
  const session = await signIn();
  const statements = [];
  const onQuery = (query) => { statements.push(query.sql); };
  knex.on("query", onQuery);
  t.after(() => knex.off("query", onQuery));
  const requests = async (cookies, count) => {
    statements.length = 0;
    const answers = [];
    for (let index = 0; index < count; index += 1) answers.push(await service.authenticateRequest({ cookies }));
    return { authenticated: answers.map(({ authenticated }) => authenticated), statements: statements.length };
  };
  const byAccess = { jskit_local_access_token: session.access_token };
  const byRefresh = { jskit_local_refresh_token: session.refresh_token };
  for (const cookies of [byAccess, byRefresh]) {
    assert.deepEqual(await requests(cookies, 1), { authenticated: [true], statements: 2 });
    assert.deepEqual(await requests(cookies, 20), { authenticated: Array(20).fill(true), statements: 40 });
  }
  // Five minutes on, the first request notes the session as seen: one statement more, once.
  t.mock.timers.tick(5 * 60 * 1000 + 1000);
  assert.deepEqual(await requests(byAccess, 2), { authenticated: [true, true], statements: 5 });

  const { sessionId } = await service.authenticateRequest({ cookies: byAccess });
  await sessions.revoke(sessionId);
  assert.deepEqual((await requests(byAccess, 1)).authenticated, [false]);
  assert.deepEqual((await requests(byRefresh, 1)).authenticated, [false]);
  const again = await signIn();
  assert.deepEqual((await requests({ jskit_local_access_token: again.access_token }, 1)).authenticated, [true]);
  await accounts.disable("usr_req");
  assert.deepEqual((await requests({ jskit_local_access_token: again.access_token }, 1)).authenticated, [false]);
});
