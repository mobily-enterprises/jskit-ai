// The users table comes from users-core, whose migrations run after console-core's, or from the
// application's own migrations, which run after every package's table migrations, so
// console_settings gets its users key in this later phase.
// A database migrated before this file already has it from the table migration.
const USERS_KEY = { tableName: "console_settings", columnName: "owner_user_id", parentTable: "users", onDelete: "SET NULL" };

exports.up = async function up(knex) {
  const { addMissingForeignKey } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  await addMissingForeignKey(knex, USERS_KEY);
};

exports.down = async function down(knex) {
  const { dropForeignKeyIfPresent } = await import("@jskit-ai/database-runtime/server/foreignKeyMigrations");
  await dropForeignKeyIfPresent(knex, USERS_KEY);
};
