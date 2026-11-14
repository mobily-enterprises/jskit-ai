import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthService, hashPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import sessionsMetadataMigration from "../migrations/auth_local_db_sessions_metadata.cjs";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { exerciseSessionMetadata, requestFrom } from "../../auth-provider-local-core/test-support/sessionMetadataScenario.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

const PASSWORD = "listed password value";
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

test("a session keeps where and when it was last seen, at most every five minutes (database backend)", async (t) => {
  const { backend, knex } = await openSqliteLocalAuth(t);
  // The migration runs again on a database that has its columns, as a rerun deploy does.
  await sessionsMetadataMigration.up(knex);
  await exerciseSessionMetadata(t, { service: createLocalAuthService({ ...localServiceOptions(), backend }), backend });
});

test("sessions.listForUser answers the account's live sessions, newest first, in one read whatever their number", async (t) => {
  const { accounts, backend, knex, sessions } = await openSqliteLocalAuth(t);
  const service = createLocalAuthService({ ...localServiceOptions(), backend });
  const password = await hashPassword(PASSWORD);
  await accounts.create({ id: "usr_list", email: "list@example.com", displayName: "List", password });
  await accounts.create({ id: "usr_other", email: "other@example.com", displayName: "Other", password });
  const start = Date.parse("2026-11-15T09:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const signIn = async (email, ip) => {
    t.mock.timers.tick(1000);
    const answer = await service.authenticateRequest({
      cookies: {
        jskit_local_access_token: (await service.login({ email, password: PASSWORD }, requestFrom(ip, BROWSER))).session.access_token
      }
    });
    return answer.sessionId;
  };
  const first = await signIn("list@example.com", "203.0.113.1");
  const ended = await signIn("list@example.com", "203.0.113.2");
  const latest = await signIn("list@example.com", "203.0.113.3");
  await signIn("other@example.com", "198.51.100.1");
  await sessions.revoke(ended);
  await sessions.create({ id: "ses_expired", userId: "usr_list", tokenHash: "hash-expired", purpose: "normal", expiresAt: new Date(start).toISOString() });

  const listed = await sessions.listForUser("usr_list");
  assert.deepEqual(listed.map(({ id, ip, userAgent }) => ({ id, ip, userAgent })), [
    { id: latest, ip: "203.0.113.3", userAgent: BROWSER },
    { id: first, ip: "203.0.113.1", userAgent: BROWSER }
  ], "Only the account's own sessions that are neither ended nor expired");
  assert.equal(listed[0].lastSeenAt, new Date(start + 3000).toISOString());
  assert.deepEqual(await sessions.listForUser("usr_missing"), []);
  await assert.rejects(sessions.listForUser(""), { name: "TypeError" });

  // The read is one statement whether the account has two sessions or sixty.
  const statements = async () => {
    let count = 0;
    const onQuery = () => { count += 1; };
    knex.on("query", onQuery);
    try {
      const listed = await sessions.listForUser("usr_list");
      return { sessions: listed.length, statements: count };
    } finally {
      knex.off("query", onQuery);
    }
  };
  const few = await statements();
  for (let index = 0; index < 58; index += 1) {
    await sessions.create({ id: `ses_many_${index}`, userId: "usr_list", tokenHash: `hash-many-${index}`, purpose: "normal",
      expiresAt: "2026-12-15T09:00:00.000Z" });
  }
  const many = await statements();
  assert.deepEqual([few.sessions, many.sessions], [2, 60]);
  assert.equal(many.statements, few.statements);
});
