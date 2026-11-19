// Knex sorts this file just before auth_local_db_oauth.cjs ("-" sorts before "."), so it runs first on every
// database that has not run it. It runs that released migration with each table it creates in the collation of
// auth_local_users, or of the next table listed that exists, instead of the database's default, and repairs a table
// that default left: see migrateInExistingCollation. The released migration then finds its tables in place.
const released = require("./auth_local_db_oauth.cjs");

exports.up = async function up(knex) {
  const { migrateInExistingCollation } = await import("@jskit-ai/database-runtime/server/tableCollationMigrations");
  await migrateInExistingCollation(knex, {
    migration: "auth_local_db_oauth.cjs",
    up: released.up,
    tables: ["auth_local_identities", "auth_local_oauth_attempts"],
    referenceTables: ["auth_local_users", "users"],
    foreignKeys: [
      { tableName: "auth_local_identities", columnName: "user_id", parentTable: "auth_local_users",
        name: "fk_auth_local_identities_user", onUpdate: "RESTRICT", onDelete: "CASCADE" }
    ]
  });
};

// The released migration's down drops its tables.
exports.down = async function down() {};
