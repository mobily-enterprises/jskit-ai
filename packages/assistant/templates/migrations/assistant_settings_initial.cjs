// JSKIT_MIGRATION_ID: assistant-settings-initial-schema

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("assistant_console_settings", (table) => {
    table.integer("id").primary();
    table.text("workspace_surface_prompt").notNullable().defaultTo("");
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("assistant_workspace_settings", (table) => {
    table.integer("workspace_id").unsigned().primary().references("id").inTable("workspaces").onDelete("CASCADE");
    table.text("app_surface_prompt").notNullable().defaultTo("");
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex("assistant_console_settings").insert({
    id: 1,
    workspace_surface_prompt: "",
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("assistant_workspace_settings");
  await knex.schema.dropTableIfExists("assistant_console_settings");
};
