import assert from "node:assert/strict";
import test from "node:test";
import { createLocalAuthService, hashPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import signInFactsMigration from "../migrations/auth_local_db_sign_in_facts.cjs";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { sessionCookies } from "../../auth-provider-local-core/test-support/passSignInScenario.js";
import { requestFrom } from "../../auth-provider-local-core/test-support/sessionMetadataScenario.js";
import { FIREFOX, PHONE, exerciseSignInFacts } from "../../auth-provider-local-core/test-support/signInFactsScenario.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

const PASSWORD = "listed password value";
const COLUMNS = Object.freeze([
  ["auth_local_sessions", "sign_in_ip"],
  ["auth_local_sessions", "sign_in_user_agent"],
  ["auth_local_users", "password_changed_at"],
  ["auth_local_users", "email_changed_at"]
]);

async function hasColumns(knex) {
  return Promise.all(COLUMNS.map(([table, column]) => knex.schema.hasColumn(table, column)));
}

test("a session keeps how it was signed in, and an account when its credentials changed (database backend)", async (t) => {
  const { backend, knex } = await openSqliteLocalAuth(t);
  // The migration runs again on a database that has its columns, as a rerun deploy does.
  await signInFactsMigration.up(knex);
  await exerciseSignInFacts(t, backend);
});

test("a session signed in before the migration has no sign-in facts after it, and later visits add none", async (t) => {
  const { accounts, backend, knex, sessions } = await openSqliteLocalAuth(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-23T09:00:00.000Z") });
  const service = createLocalAuthService({ ...localServiceOptions(), backend });
  await service.register({ email: "ada@example.com", password: PASSWORD }, requestFrom("192.0.2.1", PHONE));
  const signedIn = await service.login({ email: "ada@example.com", password: PASSWORD }, requestFrom("203.0.113.7", FIREFOX));
  await service.changePassword(requestFrom("203.0.113.7", FIREFOX, sessionCookies(signedIn.session)),
    { currentPassword: PASSWORD, newPassword: `${PASSWORD} again` });

  // The database as it was before this release: the migration's down drops its columns, keeping the rows; up adds
  // them again, empty, as it does on a database whose sessions and accounts were made before it.
  await signInFactsMigration.down(knex);
  assert.deepEqual(await hasColumns(knex), [false, false, false, false]);
  await signInFactsMigration.up(knex);
  await signInFactsMigration.up(knex);
  assert.deepEqual(await hasColumns(knex), [true, true, true, true]);

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
