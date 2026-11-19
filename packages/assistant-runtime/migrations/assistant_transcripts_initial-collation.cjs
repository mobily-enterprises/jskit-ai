// Knex sorts this file just before assistant_transcripts_initial.cjs ("-" sorts before "."), so it runs first on
// every database that has not run it. It runs that released migration with each table it creates in the collation
// of assistant_config, or of the next table listed that exists, instead of the database's default, and repairs a
// table that default left: see migrateInExistingCollation. The released migration then finds its tables in place.
const released = require("./assistant_transcripts_initial.cjs");

exports.up = async function up(knex) {
  const { migrateInExistingCollation } = await import("@jskit-ai/database-runtime/server/tableCollationMigrations");
  await migrateInExistingCollation(knex, {
    migration: "assistant_transcripts_initial.cjs",
    up: released.up,
    tables: ["assistant_conversations", "assistant_messages"],
    referenceTables: ["assistant_config", "users", "auth_local_users"]
  });
};

// The released migration's down drops its tables.
exports.down = async function down() {};
