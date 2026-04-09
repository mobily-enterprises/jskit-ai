exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("assistant_config");
  if (!hasTable) {
    const hasWorkspacesTable = await knex.schema.hasTable("workspaces");

    await knex.schema.createTable("assistant_config", (table) => {
      table.increments("id").unsigned().primary();
      table.string("target_surface_id", 64).notNullable();
      table.string("scope_key", 160).notNullable();
      table.integer("workspace_id").unsigned().nullable();
      if (hasWorkspacesTable) {
        table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
      }
      table.text("system_prompt").notNullable().defaultTo("");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.unique(["target_surface_id", "scope_key"], "uq_assistant_config_target_surface_scope");
      table.index(["target_surface_id"], "idx_assistant_config_target_surface");
      table.index(["workspace_id"], "idx_assistant_config_workspace");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("assistant_config");
};
