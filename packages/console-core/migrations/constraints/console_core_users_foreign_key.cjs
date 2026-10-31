// The users table comes from users-core, whose migrations run after console-core's, or from the
// application's own migrations, which run after every package's table migrations, so
// console_settings gets its users key in this later phase.
// A database migrated before this file already has it from the table migration.
const TABLE_NAME = "console_settings";
const COLUMN_NAME = "owner_user_id";

async function hasUsersForeignKey(knex) {
  const dialect = knex.client.dialect;
  if (dialect === "mysql") {
    const key = await knex("information_schema.KEY_COLUMN_USAGE")
      .whereRaw("TABLE_SCHEMA = DATABASE()")
      .where({ TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME: "users", REFERENCED_COLUMN_NAME: "id" })
      .first("CONSTRAINT_NAME");
    return Boolean(key);
  }
  if (dialect === "postgresql") {
    const { rows } = await knex.raw(
      `SELECT c.conname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.conrelid = to_regclass(?) AND c.confrelid = to_regclass('users') AND a.attname = ?`,
      [TABLE_NAME, COLUMN_NAME]
    );
    return rows.length > 0;
  }
  if (dialect === "sqlite3") {
    const keys = await knex.raw("PRAGMA foreign_key_list(??)", [TABLE_NAME]);
    return keys.some((key) => key.table === "users" && key.from === COLUMN_NAME);
  }
  throw new Error(`console-core's users foreign key does not support the ${dialect} dialect.`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable("users"))) {
    throw new Error("console-core needs the users table before it adds its users foreign key.");
  }
  if (await hasUsersForeignKey(knex)) {
    return;
  }
  await knex.schema.alterTable(TABLE_NAME, (table) => {
    table.foreign(COLUMN_NAME).references("id").inTable("users").onDelete("SET NULL");
  });
};

// Knex gave this key its default name, whichever migration created it.
exports.down = async function down(knex) {
  if (await hasUsersForeignKey(knex)) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      table.dropForeign(COLUMN_NAME);
    });
  }
};
