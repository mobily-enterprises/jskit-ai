import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createLocalAuthService } from "../../../auth-provider-local-core/src/server/lib/index.js";
import {
  SCENARIO_START,
  exerciseSecondFactor,
  secondFactorServiceOptions
} from "../../../auth-provider-local-core/test-support/secondFactorScenario.js";
import secondFactorsMigration from "../../migrations/auth_local_db_users_second_factors.cjs";
import { LOCAL_AUTH_DB_TABLES } from "../../src/server/lib/index.js";

// Second factors in the database, on SQLite, MariaDB/MySQL and PostgreSQL alike: the whole scenario through local
// auth's service, and the migration, which runs again, down and up, and whose rows go with their account.

/**
 * Registers the tests on the records `open(context, suffix)` answers: its Knex and startLocalAuthRecords()'s records.
 * @param {(context: import("node:test").TestContext, suffix: string) => Promise<any>} open
 * @param {{ database?: boolean, skip?: string | false }} [options] `database`: the records need TEST_DB_NAME.
 */
function secondFactorCases(open, { database = false, skip = false } = {}) {
  test("an authenticator sets up, proves sessions, refuses wrong, used and expired codes, waits, and resets (database backend)", { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const { knex, backend } = await open(t, "da_local_2fa");
    t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
    const { events, options } = secondFactorServiceOptions();
    await exerciseSecondFactor(t, {
      service: createLocalAuthService({ ...options, backend }),
      events,
      async storedText() {
        return JSON.stringify([
          await knex(LOCAL_AUTH_DB_TABLES.secondFactors).select(),
          await knex(LOCAL_AUTH_DB_TABLES.sessions).select()
        ]);
      }
    });

    // Ada's started setup is the one factor left, with the secret sealed for her account.
    const [factor] = await knex(LOCAL_AUTH_DB_TABLES.secondFactors).select();
    assert.equal(factor.confirmed_at, null);
    assert.match(factor.secret_sealed, /^v1\./u);
  });

  test("the second factor migration runs again, goes down and up, and deleting an account deletes its factor", { skip }, async (t) => {
    if (database) requireTestDatabase(process.env);
    const { knex, backend } = await open(t, "da_local_2fa_migration");
    await secondFactorsMigration.up(knex);
    const at = "2026-11-13T10:00:00.000Z";
    await backend.withTransaction(async (tx) => {
      await tx.users.create({ id: "usr_ada", email: "ada@example.com", displayName: "Ada", password: {}, createdAt: at });
      await tx.sessions.create({ id: "ses_ada", userId: "usr_ada", tokenHash: "hash-ada", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: at });
      await tx.secondFactors.save({
        userId: "usr_ada",
        secretSealed: "v1.nonce.body.tag",
        confirmedAt: at,
        lastUsedStep: 58767600,
        recoveryCodes: ["hash-one", "hash-two"],
        failures: 0,
        lastFailedAt: "",
        lockedUntil: "",
        createdAt: at,
        updatedAt: at
      });
      assert.equal((await tx.sessions.markSecondFactorProved("ses_ada", at)).secondFactorAt, at);
    });
    assert.deepEqual(await backend.withTransaction((tx) => tx.secondFactors.findMany(["usr_ada", "usr_missing", "usr_ada"])), [{
      userId: "usr_ada",
      secretSealed: "v1.nonce.body.tag",
      confirmedAt: at,
      lastUsedStep: 58767600,
      recoveryCodes: ["hash-one", "hash-two"],
      failures: 0,
      lastFailedAt: "",
      lockedUntil: "",
      createdAt: at,
      updatedAt: at
    }]);
    assert.equal(await backend.withTransaction((tx) => tx.sessions.clearSecondFactorForUser("usr_ada")), 1);
    assert.equal(await backend.withTransaction((tx) => tx.sessions.clearSecondFactorForUser("usr_ada")), 0, "a session without a proof is left alone");
    assert.equal((await backend.withTransaction((tx) => tx.sessions.findById("ses_ada"))).secondFactorAt, "");

    await backend.withTransaction(async (tx) => {
      await tx.users.create({ id: "usr_bob", email: "bob@example.com", displayName: "Bob", password: {}, createdAt: at });
      await tx.sessions.create({ id: "ses_bob", userId: "usr_bob", tokenHash: "hash-bob", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: at });
    });
    await knex(LOCAL_AUTH_DB_TABLES.users).where({ id: "usr_ada" }).delete();
    assert.deepEqual(await knex(LOCAL_AUTH_DB_TABLES.secondFactors).select("user_id"), []);

    // Down removes the table and the sessions' column, keeping Bob's session; up brings both back.
    const schema = async () => [
      await knex.schema.hasTable(LOCAL_AUTH_DB_TABLES.secondFactors),
      await knex.schema.hasColumn(LOCAL_AUTH_DB_TABLES.sessions, "second_factor_at")
    ];
    await secondFactorsMigration.down(knex);
    assert.deepEqual(await schema(), [false, false]);
    assert.deepEqual(await knex(LOCAL_AUTH_DB_TABLES.sessions).pluck("id"), ["ses_bob"]);
    await secondFactorsMigration.up(knex);
    assert.deepEqual(await schema(), [true, true]);
  });
}

export { secondFactorCases };
