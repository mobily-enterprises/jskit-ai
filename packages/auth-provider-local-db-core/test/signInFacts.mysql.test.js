import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import signInFactsMigration from "../migrations/auth_local_db_sign_in_facts.cjs";
import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";
import { COLUMNS, signInFactsCases } from "./support/signInFactsCases.js";

const PASSWORD = Object.freeze({ algorithm: "scrypt", version: "1", salt: "salt-one", hash: "hash-one" });

// On MariaDB the new columns are nullable timestamps that no other write of their row sets: the scenario's waiting
// email change and visits leave them as they were.
signInFactsCases(openLocalAuthDatabase, { database: true });

// MySQL 5.7 and MariaDB before 10.10 default explicit_defaults_for_timestamp to OFF, under which a TIMESTAMP column
// that is not NULL takes DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP: every write of an account would then
// say its password had just changed. The migration's columns are NULL, so there too they take no default and no
// ON UPDATE, and a write of their row leaves them unset.
test("the sign-in facts migration adds no default and no ON UPDATE where timestamps default the old way (MariaDB)", async (context) => {
  requireTestDatabase(process.env);
  const { knex, accounts } = await openLocalAuthDatabase(context, "da_local_facts_legacy");
  await accounts.create({ id: "usr_ada", email: "ada@example.com", displayName: "Ada", password: PASSWORD, createdAt: "2026-11-01T08:00:00.000Z" });
  await signInFactsMigration.down(knex);
  await knex.transaction(async (trx) => {
    await trx.raw("SET SESSION explicit_defaults_for_timestamp = OFF");
    try {
      await signInFactsMigration.up(trx);
    } finally {
      await trx.raw("SET SESSION explicit_defaults_for_timestamp = DEFAULT");
    }
  });
  const described = await knex("information_schema.COLUMNS")
    .select({ table: "TABLE_NAME", column: "COLUMN_NAME", nullable: "IS_NULLABLE", fallback: "COLUMN_DEFAULT", extra: "EXTRA" })
    .where("TABLE_SCHEMA", knex.client.database())
    .whereIn("COLUMN_NAME", COLUMNS.map(([, column]) => column))
    .orderBy(["TABLE_NAME", "COLUMN_NAME"]);
  assert.deepEqual(described.map(({ table, column, nullable, fallback, extra }) =>
    [table, column, nullable, fallback === "NULL" ? null : fallback, extra]), [
    ["auth_local_sessions", "sign_in_ip", "YES", null, ""],
    ["auth_local_sessions", "sign_in_user_agent", "YES", null, ""],
    ["auth_local_users", "email_changed_at", "YES", null, ""],
    ["auth_local_users", "password_changed_at", "YES", null, ""]
  ]);

  await knex("auth_local_users").where({ id: "usr_ada" }).update({ display_name: "Ada L." });
  assert.deepEqual(await knex("auth_local_users").where({ id: "usr_ada" }).first("password_changed_at", "email_changed_at"),
    { password_changed_at: null, email_changed_at: null }, "a write of the account sets neither");
  const ada = await accounts.findById("usr_ada");
  assert.deepEqual([ada.displayName, ada.passwordChangedAt, ada.emailChangedAt], ["Ada L.", "", ""]);
});
