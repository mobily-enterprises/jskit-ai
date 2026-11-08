import { detectDialectFromClient } from "@jskit-ai/database-runtime/shared";
import { UnsupportedDatabaseError } from "./errors.js";

/**
 * PostgreSQL's snapshot horizon, `pg_snapshot_xmin(pg_current_snapshot())`, as decimal text: every transaction below it
 * had finished when it was read. A cursor of what changed starts there: taken before a read, a later read of the rows
 * whose xid8 change stamp is at or above it finds every row a transaction that read could not see wrote, a row whose
 * id was taken before its transaction committed and a changed older row included (see the data-access guide, "What
 * changed since"). It reads no row. MySQL, MariaDB and SQLite have no transaction stamps: it throws
 * UnsupportedDatabaseError there, before anything runs.
 * @param {string} name The resource's name, for the message.
 * @param {import("knex").Knex | import("knex").Knex.Transaction} db The caller's transaction, or the runtime's Knex.
 * @returns {Promise<string>}
 */
async function readChangeHorizon(name, db) {
  if (detectDialectFromClient(db) !== "postgres") {
    throw new UnsupportedDatabaseError(
      `${name}.changeHorizon()`,
      "reads PostgreSQL's snapshot horizon (pg_snapshot_xmin), which MySQL, MariaDB and SQLite do not have."
    );
  }
  const { rows: [{ horizon }] } = await db.raw("select pg_snapshot_xmin(pg_current_snapshot())::text as horizon");
  return horizon;
}

export { readChangeHorizon };
