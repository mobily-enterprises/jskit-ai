// The users table can come from the application's own migrations, which run after every
// package's table migrations, so the assistant tables get their users keys in this later phase.
// A database migrated before this file already has them from the table migrations.
const USER_KEYS = [
  { tableName: "assistant_conversations", columnName: "created_by_user_id", onDelete: "SET NULL" },
  { tableName: "assistant_messages", columnName: "actor_user_id", onDelete: "SET NULL" },
  { tableName: "assistant_turn_requests", columnName: "actor_user_id", onDelete: "CASCADE" }
];

async function hasUsersForeignKey(knex, { tableName, columnName }) {
  const dialect = knex.client.dialect;
  if (dialect === "mysql") {
    const key = await knex("information_schema.KEY_COLUMN_USAGE")
      .whereRaw("TABLE_SCHEMA = DATABASE()")
      .where({ TABLE_NAME: tableName, COLUMN_NAME: columnName, REFERENCED_TABLE_NAME: "users", REFERENCED_COLUMN_NAME: "id" })
      .first("CONSTRAINT_NAME");
    return Boolean(key);
  }
  if (dialect === "postgresql") {
    const { rows } = await knex.raw(
      `SELECT c.conname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.conrelid = to_regclass(?) AND c.confrelid = to_regclass('users') AND a.attname = ?`,
      [tableName, columnName]
    );
    return rows.length > 0;
  }
  if (dialect === "sqlite3") {
    const keys = await knex.raw("PRAGMA foreign_key_list(??)", [tableName]);
    return keys.some((key) => key.table === "users" && key.from === columnName);
  }
  throw new Error(`assistant users foreign keys do not support the ${dialect} dialect.`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("users"))) {
    throw new Error("assistant-runtime needs the users table before it adds its users foreign keys.");
  }
  for (const key of USER_KEYS) {
    if (await hasUsersForeignKey(knex, key)) {
      continue;
    }
    await knex.schema.alterTable(key.tableName, (table) => {
      table.foreign(key.columnName).references("id").inTable("users").onDelete(key.onDelete);
    });
  }
};

// Knex gave every one of these keys its default name, whichever migration created it.
exports.down = async function down(knex) {
  for (const key of USER_KEYS) {
    if (await hasUsersForeignKey(knex, key)) {
      await knex.schema.alterTable(key.tableName, (table) => {
        table.dropForeign(key.columnName);
      });
    }
  }
};
