# Changelog

## Unreleased

- A PostgreSQL session runs in UTC whatever the server's default time zone, as a MySQL connection does with `timezone: "Z"`: the runtime's Knex and the migration configuration (`createKnexMigrationConfig`) set `TimeZone` to UTC in the pool's `afterCreate`, and the test databases' own connections keep it. PostgreSQL reads a date-time written without an offset, as the `datetime-utc` storage writes it, in the session's zone, so on a server set to another zone a `timestamptz` value moved by that zone's offset.
- The test databases' `tableNames()` and the migration ledger read accept every name Knex gives PostgreSQL's client (`pg`, `postgres`, `postgresql`); `postgres` used to be read as MySQL.
