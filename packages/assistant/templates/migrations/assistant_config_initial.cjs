exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("__ASSISTANT_CONFIG_TABLE__");
  if (!hasTable) {
    await knex.schema.createTable("__ASSISTANT_CONFIG_TABLE__", (table) => {
      table.increments("id").unsigned().primary();
      table.string("target_surface_id", 64).notNullable();
      table.string("scope_key", 160).notNullable();
      table.integer("workspace_id").unsigned().nullable();
      if ("__ASSISTANT_CONFIG_SCOPE__" === "workspace") {
        table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
      }
      table.text("system_prompt").notNullable().defaultTo("");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.unique(["target_surface_id", "scope_key"], "uq___ASSISTANT_CONFIG_TABLE___target_surface_scope");
      table.index(["target_surface_id"], "idx___ASSISTANT_CONFIG_TABLE___target_surface");
      table.index(["workspace_id"], "idx___ASSISTANT_CONFIG_TABLE___workspace");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("__ASSISTANT_CONFIG_TABLE__");
};
