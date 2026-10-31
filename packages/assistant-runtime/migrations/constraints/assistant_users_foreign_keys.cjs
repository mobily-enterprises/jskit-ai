// The users table can come from the application's own migrations, which run after every
// package's table migrations, so the assistant tables get their users keys in this later phase.
// A database migrated before this file already has them from the table migrations.
const USER_KEYS = [
  { tableName: "assistant_conversations", columnName: "created_by_user_id", parentTable: "users", onDelete: "SET NULL" },
  { tableName: "assistant_messages", columnName: "actor_user_id", parentTable: "users", onDelete: "SET NULL" },
  { tableName: "assistant_turn_requests", columnName: "actor_user_id", parentTable: "users", onDelete: "CASCADE" }
];

exports.up = async function up(knex) {
  const { addMissingForeignKey } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  for (const key of USER_KEYS) {
    await addMissingForeignKey(knex, key);
  }
};

exports.down = async function down(knex) {
  const { dropForeignKeyIfPresent } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  for (const key of USER_KEYS) {
    await dropForeignKeyIfPresent(knex, key);
  }
};
