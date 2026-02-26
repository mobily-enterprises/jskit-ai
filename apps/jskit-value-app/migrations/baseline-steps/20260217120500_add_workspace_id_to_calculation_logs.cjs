exports.up = async function up(knex) {
  await knex.schema.alterTable("calculation_logs", (table) => {
    table.bigInteger("workspace_id").unsigned().nullable();
    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.index(["workspace_id", "created_at"], "idx_calculation_logs_workspace_created");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("calculation_logs", (table) => {
    table.dropForeign("workspace_id");
    table.dropIndex(["workspace_id", "created_at"], "idx_calculation_logs_workspace_created");
    table.dropColumn("workspace_id");
  });
};
