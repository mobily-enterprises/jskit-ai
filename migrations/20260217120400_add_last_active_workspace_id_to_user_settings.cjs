exports.up = async function up(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.bigInteger("last_active_workspace_id").unsigned().nullable();
    table.foreign("last_active_workspace_id").references("id").inTable("workspaces").onDelete("SET NULL");
    table.index(["last_active_workspace_id"], "idx_user_settings_last_active_workspace");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.dropForeign("last_active_workspace_id");
    table.dropIndex(["last_active_workspace_id"], "idx_user_settings_last_active_workspace");
    table.dropColumn("last_active_workspace_id");
  });
};
