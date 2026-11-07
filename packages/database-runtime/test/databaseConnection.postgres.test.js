import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import { createDatabase } from "../src/server/database.js";
import { resolveKnexConnectionFromEnvironment } from "../src/shared/databaseConnection.js";
import { toDatabaseDateTimeUtc } from "../src/shared/dateUtils.js";

// Runs beside the PostgreSQL test database: run with DB_NAME set to TEST_DB_NAME (and the usual DB_HOST, DB_PORT,
// DB_USER and DB_PASSWORD), and DB_CLIENT unset or pg.
const TEST_DB_NAME = process.env.TEST_DB_NAME?.trim();
const ON_TEST_DATABASE = Boolean(TEST_DB_NAME) && process.env.DB_NAME === TEST_DB_NAME;
const POSTGRES_CLIENT = !process.env.DB_CLIENT || process.env.DB_CLIENT === "pg";
const SKIP = ON_TEST_DATABASE && POSTGRES_CLIENT ? false : "not on a PostgreSQL test database (DB_NAME=$TEST_DB_NAME)";

// The default time zone of the server in this test. node-postgres sends PGOPTIONS as each new connection's startup
// options, so every session starts in it, as on a server configured for that zone.
const SERVER_TIME_ZONE = "Australia/Perth";

/**
 * Writes one date-time as the "datetime-utc" storage writes it (UTC, without an offset) into a timestamptz column,
 * and reads it back, on one connection.
 * @param {import("knex").Knex} knex
 * @param {Date} instant
 */
function roundTrip(knex, instant) {
  return knex.transaction(async (trx) => {
    await trx.raw("CREATE TEMPORARY TABLE stamped (at timestamptz NOT NULL) ON COMMIT DROP");
    await trx.raw("INSERT INTO stamped (at) VALUES (?)", [toDatabaseDateTimeUtc(instant)]);
    const { rows: [{ TimeZone: session }] } = await trx.raw("SHOW TIME ZONE");
    const { rows: [{ at, text }] } = await trx.raw("SELECT at, at::text AS text FROM stamped");
    return { session, at, text };
  });
}

test("the runtime's PostgreSQL sessions run in UTC on a server that is not, so a timestamptz keeps the instant written", {
  skip: SKIP
}, async (context) => {
  const previousOptions = process.env.PGOPTIONS;
  process.env.PGOPTIONS = `-c TimeZone=${SERVER_TIME_ZONE}`;
  context.after(() => {
    if (previousOptions === undefined) {
      delete process.env.PGOPTIONS;
    } else {
      process.env.PGOPTIONS = previousOptions;
    }
  });
  const env = { ...process.env, DB_CLIENT: "pg" };
  const serverDefault = knexFactory({
    client: "pg",
    connection: resolveKnexConnectionFromEnvironment(env, { client: "pg", defaultPort: 5432 }),
    pool: { min: 0, max: 1 }
  });
  const { knex } = createDatabase({ driver: { DIALECT_ID: "pg" }, env });
  context.after(() => Promise.all([serverDefault.destroy(), knex.destroy()]));
  const instant = new Date("2026-11-08T04:05:06.789Z");

  // Without the runtime's session setting, the server reads the UTC text in its own zone: eight hours early.
  const shifted = await roundTrip(serverDefault, instant);
  assert.equal(shifted.session, SERVER_TIME_ZONE);
  assert.equal(instant.getTime() - shifted.at.getTime(), 8 * 60 * 60 * 1000);

  const kept = await roundTrip(knex, instant);
  assert.equal(kept.session, "UTC");
  assert.equal(kept.at.toISOString(), instant.toISOString());
  assert.equal(kept.text, "2026-11-08 04:05:06.789+00");
});
