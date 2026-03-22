/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasConsoleSettingsTable = await knex.schema.hasTable("console_settings");
  if (!hasConsoleSettingsTable) {
    return;
  }

  const hasOwnerUserId = await knex.schema.hasColumn("console_settings", "owner_user_id");
  if (hasOwnerUserId) {
    return;
  }

  await knex.schema.alterTable("console_settings", (table) => {
    table.integer("owner_user_id").unsigned().nullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasConsoleSettingsTable = await knex.schema.hasTable("console_settings");
  if (!hasConsoleSettingsTable) {
    return;
  }

  const hasOwnerUserId = await knex.schema.hasColumn("console_settings", "owner_user_id");
  if (!hasOwnerUserId) {
    return;
  }

  await knex.schema.alterTable("console_settings", (table) => {
    table.dropColumn("owner_user_id");
  });
};
