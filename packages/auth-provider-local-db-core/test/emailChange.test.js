import assert from "node:assert/strict";
import test from "node:test";
import pendingEmailMigration from "../migrations/auth_local_db_users_pending_email.cjs";
import { exerciseEmailChange } from "../../auth-provider-local-core/test-support/emailChangeScenario.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

test("an account's email changes once the link sent to the new address is used, and the old address is told (database backend)", async (t) => {
  const { accounts, backend, knex } = await openSqliteLocalAuth(t);
  // The migration runs again on a database that has its column, as a rerun deploy does.
  await pendingEmailMigration.up(knex);
  const { adaId, bobId } = await exerciseEmailChange(t, backend);
  // The link proved the new address, so it is confirmed from when it was used; the account whose change was refused
  // keeps its own confirmation, which registering without a link never gave.
  const ada = await accounts.findById(adaId);
  assert.deepEqual([ada.email, ada.pendingEmail, ada.emailVerifiedAt], ["ada.second@example.com", "", "2026-11-15T09:00:00.000Z"]);
  const bob = await accounts.findById(bobId);
  assert.deepEqual([bob.email, bob.pendingEmail, bob.emailVerifiedAt], ["bob@example.com", "carol@example.com", ""]);

  // The migration's down drops the column, and up adds it again.
  await pendingEmailMigration.down(knex);
  assert.equal(await knex.schema.hasColumn("auth_local_users", "pending_email"), false);
  await pendingEmailMigration.up(knex);
  assert.equal(await knex.schema.hasColumn("auth_local_users", "pending_email"), true);
});
