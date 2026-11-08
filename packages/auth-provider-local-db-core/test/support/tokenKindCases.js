import assert from "node:assert/strict";
import test from "node:test";
import { countQueries, requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// Through the owner APIs, on SQLite, MariaDB/MySQL and PostgreSQL alike: auth.local.recovery consuming one kind of a
// user's tokens, and auth.local.sessions promoting a session only while it is still the user's recovery session.

const PASSWORD = Object.freeze({ algorithm: "scrypt", version: "1", salt: "salt-one", hash: "hash-one" });
const CREATED = "2026-11-01T08:00:00.000Z";
const LATER = "2026-12-01T00:00:00.000Z";

async function createAccounts(accounts) {
  for (const id of ["usr_ada", "usr_bob"]) {
    await accounts.create({ id, email: `${id}@example.com`, displayName: id, password: PASSWORD, createdAt: CREATED });
  }
}

/**
 * Registers the tests on the records `open(context, suffix)` answers, as startLocalAuthRecords() gives them.
 * @param {(context: import("node:test").TestContext, suffix: string) => Promise<any>} open
 * @param {{ database?: boolean, skip?: string | false }} [options] `database`: the records need TEST_DB_NAME.
 */
function tokenKindCases(open, { database = false, skip = false } = {}) {
  test("consumeForUser consumes the user's open tokens of one kind: a sign-in link leaves a password reset open, and the other way round", { skip }, async (context) => {
    if (database) requireTestDatabase(process.env);
    const { accounts, recovery, inCallerTransaction } = await open(context, "da_local_kinds");
    await createAccounts(accounts);
    const token = (id, userId = "usr_ada") => recovery.create({ id, userId, tokenHash: `hash-${id}`, expiresAt: LATER, createdAt: CREATED });
    const stillOpen = async (...ids) => Promise.all(ids.map(async (id) => (await recovery.findByTokenHash(`hash-${id}`)).usedAt === ""));
    // A password reset, two sign-in links, another user's link, and an id a LIKE 'rec_%' would also take.
    for (const id of ["rec_reset", "magic_one", "magic_two", "recXother"]) await token(id);
    await token("magic_bob", "usr_bob");

    // A new sign-in link consumes the user's earlier links only.
    assert.equal(await recovery.consumeForUser("usr_ada", { idPrefix: "magic_" }), 2);
    assert.deepEqual(await stillOpen("rec_reset", "magic_one", "magic_two", "recXother", "magic_bob"), [true, false, false, true, true]);
    assert.equal(await recovery.consumeForUser("usr_ada", { idPrefix: "magic_" }), 0);

    // A completed reset consumes the user's resets only, in the caller's transaction, whose rollback undoes it.
    await token("magic_three");
    const abort = new Error("Abort the reset");
    await assert.rejects(inCallerTransaction(async (options) => {
      assert.equal(await recovery.consumeForUser("usr_ada", { ...options, idPrefix: "rec_" }), 1);
      throw abort;
    }), (error) => error === abort);
    assert.deepEqual(await stillOpen("rec_reset"), [true], "the rolled-back consume is gone");
    assert.equal(await recovery.consumeForUser("usr_ada", { idPrefix: "rec_" }), 1);
    assert.deepEqual(await stillOpen("rec_reset", "magic_three", "recXother", "magic_bob"), [false, true, true, true]);

    for (const options of [undefined, {}, { idPrefix: "" }, { idPrefix: 1 }]) {
      await assert.rejects(recovery.consumeForUser("usr_ada", options), {
        name: "TypeError",
        message: "auth.local.recovery.consumeForUser() takes the idPrefix of the tokens it consumes, such as \"rec_\"."
      });
    }
  });

  test("sessions.update with onlyIf promotes a session in one UPDATE only while it is still the user's unrevoked recovery session", { skip }, async (context) => {
    if (database) requireTestDatabase(process.env);
    const { knex, accounts, sessions, backend, inCallerTransaction } = await open(context, "da_local_promote");
    await createAccounts(accounts);
    const session = (id) => sessions.create({ id, userId: "usr_ada", tokenHash: `hash-${id}`, purpose: "recovery", expiresAt: LATER, createdAt: CREATED });
    const promote = (id, userId, options = {}) => sessions.update(id, { purpose: "normal", expiresAt: LATER }, {
      ...options,
      onlyIf: { userId, purpose: "recovery", revokedAt: null }
    });
    const stored = (id) => backend.withTransaction((tx) => tx.sessions.findById(id));
    const created = await session("ses_recovery");

    assert.equal(await promote("ses_recovery", "usr_bob"), null, "another user's session is not promoted");
    const abort = new Error("Abort the promotion");
    await assert.rejects(inCallerTransaction(async (options) => {
      assert.equal((await promote("ses_recovery", "usr_ada", options)).purpose, "normal");
      throw abort;
    }), (error) => error === abort);
    assert.deepEqual(await stored("ses_recovery"), created, "the rolled-back promotion is gone");

    const { result, queries } = await countQueries(knex, () => promote("ses_recovery", "usr_ada"));
    assert.deepEqual(result, { ...created, purpose: "normal" });
    const updates = queries.filter((sql) => /^update/iu.test(sql));
    assert.equal(updates.length, 1);
    const where = updates[0].split(/ where /iu)[1];
    for (const column of ["user_id", "purpose", "revoked_at"]) assert.match(where, new RegExp(column, "u"), "the UPDATE compares the conditions");
    assert.equal(await promote("ses_recovery", "usr_ada"), null, "a promoted session is no recovery session");

    await session("ses_revoked");
    await sessions.revoke("ses_revoked");
    assert.equal(await promote("ses_revoked", "usr_ada"), null, "a revoked session is not promoted");
    assert.equal((await stored("ses_revoked")).purpose, "recovery");
    assert.equal(await promote("ses_missing", "usr_ada"), null);

    for (const onlyIf of [{}, { tokenHash: "hash-ses_recovery" }, null, ["userId"]]) {
      await assert.rejects(sessions.update("ses_recovery", { purpose: "normal" }, { onlyIf }), {
        name: "TypeError",
        message: "auth.local.sessions.update() takes onlyIf with userId, purpose, revokedAt only."
      });
    }
  });
}

export { tokenKindCases };
