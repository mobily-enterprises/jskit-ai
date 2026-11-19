// Knex sorts this file just before auth_local_db_protection.cjs ("-" sorts before "."), so it runs first on every
// database that has not run it. It runs that released migration with each table it creates in the collation of
// auth_local_users, or of the next table listed that exists, instead of the database's default, and repairs a table
// that default left: see migrateInExistingCollation. The released migration then finds its tables in place.
const released = require("./auth_local_db_protection.cjs");

exports.up = async function up(knex) {
  const { migrateInExistingCollation } = await import("@jskit-ai/database-runtime/server/tableCollationMigrations");
  await migrateInExistingCollation(knex, {
    migration: "auth_local_db_protection.cjs",
    up: released.up,
    tables: ["auth_local_sign_in_failures", "auth_local_registrations"],
    referenceTables: ["auth_local_users", "users"]
  });
};

// The released migration's down drops its tables.
exports.down = async function down() {};
