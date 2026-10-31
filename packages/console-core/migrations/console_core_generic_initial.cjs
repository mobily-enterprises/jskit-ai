/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasConsoleSettingsTable = await knex.schema.hasTable("console_settings");
  if (!hasConsoleSettingsTable) {
    await knex.schema.createTable("console_settings", (table) => {
      table.bigInteger("id").primary();
      // constraints/console_core_users_foreign_key.cjs adds the users key once the users table exists.
      table.bigInteger("owner_user_id").unsigned().nullable();
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    });

    await knex("console_settings").insert({
      id: 1,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_settings");
};
