// JSKIT_MIGRATION_ID: assistant-settings-initial-schema

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasConsolePromptColumn = await knex.schema.hasColumn("console_settings", "assistant_workspace_surface_prompt");
  if (!hasConsolePromptColumn) {
    await knex.schema.alterTable("console_settings", (table) => {
      table.text("assistant_workspace_surface_prompt").notNullable().defaultTo("");
    });
  }

  const hasWorkspacePromptColumn = await knex.schema.hasColumn("workspace_settings", "assistant_app_surface_prompt");
  if (!hasWorkspacePromptColumn) {
    await knex.schema.alterTable("workspace_settings", (table) => {
      table.text("assistant_app_surface_prompt").notNullable().defaultTo("");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasWorkspacePromptColumn = await knex.schema.hasColumn("workspace_settings", "assistant_app_surface_prompt");
  if (hasWorkspacePromptColumn) {
    await knex.schema.alterTable("workspace_settings", (table) => {
      table.dropColumn("assistant_app_surface_prompt");
    });
  }

  const hasConsolePromptColumn = await knex.schema.hasColumn("console_settings", "assistant_workspace_surface_prompt");
  if (hasConsolePromptColumn) {
    await knex.schema.alterTable("console_settings", (table) => {
      table.dropColumn("assistant_workspace_surface_prompt");
    });
  }
};
