exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("assistant_config");
  if (!hasTable) {
    await knex.schema.createTable("assistant_config", (table) => {
      table.bigIncrements("id").primary();
      table.string("target_surface_id", 64).notNullable();
      table.string("scope_key", 160).notNullable();
      // constraints/assistant_workspaces_foreign_keys.cjs adds the workspaces key when that table exists.
      table.bigInteger("workspace_id").unsigned().nullable();
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
