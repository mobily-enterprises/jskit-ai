import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createLocalAuthService, hashPassword } from "../../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../../auth-provider-local-core/test-support/localService.js";
import { sessionCookies } from "../../../auth-provider-local-core/test-support/passSignInScenario.js";
import { requestFrom } from "../../../auth-provider-local-core/test-support/sessionMetadataScenario.js";
import { FIREFOX, PHONE, exerciseSignInFacts } from "../../../auth-provider-local-core/test-support/signInFactsScenario.js";
import signInFactsMigration from "../../migrations/auth_local_db_sign_in_facts.cjs";

// How a session was signed in, and when an account's credentials last changed, in the database, on SQLite,
// MariaDB/MySQL and PostgreSQL alike: the whole scenario through local auth, and the migration going down and up over
// sessions and accounts that already exist.

const PASSWORD = "listed password value";
// Each column the migration adds, and the longest text it keeps (null for a time).
const COLUMNS = Object.freeze([
  ["auth_local_sessions", "sign_in_ip", 64],
  ["auth_local_sessions", "sign_in_user_agent", 512],
  ["auth_local_users", "password_changed_at", null],
  ["auth_local_users", "email_changed_at", null]
]);

async function hasColumns(knex) {
  return Promise.all(COLUMNS.map(([table, column]) => knex.schema.hasColumn(table, column)));
}

/**
 * Each added column as the database describes it: text of its length or a time, nullable, with no default, so that no
 * write but local auth's own sets it.
 * @param {import("knex").Knex} knex
 */
async function assertColumnShapes(knex) {
  for (const [table, column, maxLength] of COLUMNS) {
    const info = await knex(table).columnInfo(column);
    const name = `${table}.${column}`;
    assert.equal(info.nullable, true, `${name} is nullable`);
    assert.equal(info.defaultValue, null, `${name} has no default`);
    if (maxLength) {
      assert.match(info.type, /^(character varying|varchar)$/u, `${name} is text`);
      assert.equal(Number(info.maxLength), maxLength, `${name} keeps up to ${maxLength} characters`);
    } else {
      assert.match(info.type, /^(timestamp|datetime)/u, `${name} is a time`);
    }
  }
}

/**
 * Registers the tests on the records `open(context, suffix)` answers, as startLocalAuthRecords() gives them, with the
 * migrated Knex as `knex`.
 * @param {(context: import("node:test").TestContext, suffix: string) => Promise<any>} open
 * @param {{ database?: boolean, skip?: string | false }} [options] `database`: the records need TEST_DB_NAME.
 */
function signInFactsCases(open, { database = false, skip = false } = {}) {
  test("a session keeps how it was signed in, and an account when its credentials changed (database backend)", { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const { backend, knex } = await open(t, "da_local_sign_in_facts");
    // The migration runs again on a database that has its columns, as a rerun deploy does.
    await signInFactsMigration.up(knex);
    await exerciseSignInFacts(t, backend);
  });

  test("the sign-in facts migration goes down and up over existing sessions and accounts, which then have no facts, and visits add none", { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const { accounts, backend, knex, sessions } = await open(t, "da_local_facts_migration");
    await assertColumnShapes(knex);
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-23T09:00:00.000Z") });
    const service = createLocalAuthService({ ...localServiceOptions(), backend });
    await service.register({ email: "ada@example.com", password: PASSWORD }, requestFrom("192.0.2.1", PHONE));
    const signedIn = await service.login({ email: "ada@example.com", password: PASSWORD }, requestFrom("203.0.113.7", FIREFOX));
    await service.changePassword(requestFrom("203.0.113.7", FIREFOX, sessionCookies(signedIn.session)),
      { currentPassword: PASSWORD, newPassword: `${PASSWORD} again` });
    const rows = async () => [await knex("auth_local_users").pluck("id"), (await knex("auth_local_sessions").pluck("id")).sort()];
    const before = await rows();
    assert.deepEqual(before.map((ids) => ids.length), [1, 2], "one account, signed in by registering and by a sign-in");

    // The database as it was before this release: the migration's down drops its columns, keeping the rows; up adds
    // them again, empty, as it does on a database whose sessions and accounts were made before it.
    await signInFactsMigration.down(knex);
    assert.deepEqual(await hasColumns(knex), [false, false, false, false]);
    assert.deepEqual(await rows(), before, "down keeps every account and session");
    await signInFactsMigration.down(knex);
    await signInFactsMigration.up(knex);
    await signInFactsMigration.up(knex);
    assert.deepEqual(await hasColumns(knex), [true, true, true, true]);
    assert.deepEqual(await rows(), before, "up keeps every account and session");
    await assertColumnShapes(knex);
    assert.deepEqual(await knex("auth_local_sessions").whereNotNull("sign_in_ip").orWhereNotNull("sign_in_user_agent").pluck("id"), []);
    assert.deepEqual(await knex("auth_local_users").whereNotNull("password_changed_at").orWhereNotNull("email_changed_at").pluck("id"), []);

    t.mock.timers.tick(10 * 60_000);
    const visit = () => service.authenticateRequest(requestFrom("203.0.113.7", FIREFOX, sessionCookies(signedIn.session)));
    const answer = await visit();
    assert.equal(answer.authenticated, true);
    assert.deepEqual(answer.signIn, { at: "2026-11-23T09:00:00.000Z", ip: "", userAgent: "", purpose: "normal" },
      "an older session has no sign-in address or browser, so an action that asks for them refuses it");
    assert.deepEqual(answer.credentialsChangedAt, { password: "", email: "" }, "a change from before the migration is unknown");
    // Registering made a session at the same moment, so the list's order between the two is the ids'.
    const listed = (await sessions.listForUser(answer.actor.providerUserId)).find(({ id }) => id === answer.sessionId);
    assert.deepEqual([listed.ip, listed.userAgent, listed.signInIp, listed.signInUserAgent], ["203.0.113.7", FIREFOX, "", ""],
      "the visit moved where it was last seen and left where it was signed in from unknown");
    assert.deepEqual((await visit()).signIn, answer.signIn);

    // The owner APIs carry the facts: an application's own session takes them, and a password set through them is a
    // change.
    await accounts.create({ id: "usr_owner", email: "owner@example.com", displayName: "Owner", password: await hashPassword(PASSWORD) });
    const created = await sessions.create({ id: "ses_owner", userId: "usr_owner", tokenHash: "hash-owner", expiresAt: "2026-12-23T09:00:00.000Z",
      signInIp: "198.51.100.4", signInUserAgent: PHONE });
    assert.deepEqual([created.signInIp, created.signInUserAgent], ["198.51.100.4", PHONE]);
    assert.equal((await accounts.findById("usr_owner")).passwordChangedAt, "");
    assert.equal((await accounts.updatePassword("usr_owner", await hashPassword(`${PASSWORD} reset`))).passwordChangedAt,
      "2026-11-23T09:10:00.000Z");
  });
}

export { COLUMNS, signInFactsCases };
