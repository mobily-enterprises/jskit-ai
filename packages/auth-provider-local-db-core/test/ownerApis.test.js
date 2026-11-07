import assert from "node:assert/strict";
import test from "node:test";
import emailVerifiedMigration from "../migrations/auth_local_db_users_email_verified.cjs";
import { hashPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

// The owner APIs as an application feature requires them, over a migrated database.
async function ownerApis(t) {
  const records = await openSqliteLocalAuth(t);
  // The email proof's migration runs again on a database that has its column, as a rerun deploy does.
  await emailVerifiedMigration.up(records.knex);
  return records;
}

const at = (iso) => new Date(iso).toISOString();

test("markEmailVerified keeps the first proof, in the caller's transaction or on its own", async (t) => {
  const { knex, accounts, inCallerTransaction } = await ownerApis(t);
  const account = await accounts.create({
    id: "usr_owner", email: "owner@example.com", displayName: "Owner", password: await hashPassword("owner password value")
  });
  assert.equal(account.emailVerifiedAt, "");
  assert.equal((await accounts.findByEmail("owner@example.com")).id, "usr_owner");

  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T09:00:00.000Z") });
  await assert.rejects(inCallerTransaction(async (options) => {
    assert.equal((await accounts.markEmailVerified("usr_owner", options)).emailVerifiedAt, at("2026-11-08T09:00:00.000Z"));
    throw new Error("Abort the sign-in");
  }), /Abort the sign-in/u);
  assert.equal((await accounts.findByEmail("owner@example.com")).emailVerifiedAt, "", "The rolled-back proof is gone");

  assert.equal((await accounts.markEmailVerified("usr_owner")).emailVerifiedAt, at("2026-11-08T09:00:00.000Z"));
  t.mock.timers.tick(3_600_000);
  assert.equal((await accounts.markEmailVerified("usr_owner")).emailVerifiedAt, at("2026-11-08T09:00:00.000Z"));
  assert.equal(await accounts.markEmailVerified("usr_missing"), null);
  assert.equal((await accounts.updateProfile("usr_owner", { displayName: "Renamed" })).displayName, "Renamed");
  assert.equal((await knex(LOCAL_AUTH_DB_TABLES.users).count({ count: "*" }).first()).count, 1);
});

test("sessions.deleteExpired deletes the sessions expired by then and keeps the rest", async (t) => {
  const { knex, accounts, sessions, recovery, inCallerTransaction } = await ownerApis(t);
  await accounts.create({
    id: "usr_sessions", email: "sessions@example.com", displayName: "Sessions", password: await hashPassword("sessions password")
  });
  const session = (id, expiresAt) => sessions.create({
    id, userId: "usr_sessions", tokenHash: `hash-${id}`, purpose: "normal", expiresAt
  });
  await session("ses_old", "2026-11-01T00:00:00.000Z");
  await session("ses_edge", "2026-11-08T00:00:00.000Z");
  await session("ses_live", "2026-12-01T00:00:00.000Z");

  await inCallerTransaction(async (options) => {
    assert.equal(await sessions.deleteExpired("2026-11-08T00:00:00.000Z", options), 2);
  });
  assert.deepEqual((await knex(LOCAL_AUTH_DB_TABLES.sessions).select("id")).map(({ id }) => id), ["ses_live"]);
  assert.equal(await sessions.deleteExpired(new Date("2026-11-08T00:00:00.000Z")), 0);
  assert.equal(await sessions.revokeForUser("usr_sessions", { exceptSessionId: "ses_live" }), 0);
  assert.notEqual((await sessions.revoke("ses_live")).revokedAt, "");

  const token = await recovery.create({
    id: "rec_owner", userId: "usr_sessions", tokenHash: "recovery-hash", expiresAt: "2026-12-01T00:00:00.000Z"
  });
  assert.equal((await recovery.findByTokenHash("recovery-hash")).id, token.id);
  assert.notEqual((await recovery.consume("rec_owner")).usedAt, "");
  assert.equal(await recovery.consumeForUser("usr_sessions"), 0);
});
