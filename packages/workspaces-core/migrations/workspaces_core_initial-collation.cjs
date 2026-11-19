// Knex sorts this file just before workspaces_core_initial.cjs ("-" sorts before "."), so it runs first on every
// database that has not run it. It runs that released migration with each table it creates in the collation of
// workspaces, or of the next table listed that exists, instead of the database's default, and repairs a table that
// default left: see migrateInExistingCollation. The released migration then finds its tables in place.
const released = require("./workspaces_core_initial.cjs");

exports.up = async function up(knex) {
  const { migrateInExistingCollation } = await import("@jskit-ai/database-runtime/server/tableCollationMigrations");
  await migrateInExistingCollation(knex, {
    migration: "workspaces_core_initial.cjs",
    up: released.up,
    tables: ["workspaces", "workspace_memberships", "workspace_settings", "workspace_invites"],
    referenceTables: ["workspaces", "users", "auth_local_users"]
  });
};

// The released migration's down drops its tables.
exports.down = async function down() {};
