const TABLE_NAME = "google_rewarded_provider_configs";

exports.up = async function up(knex) {
  const hasCrudTable = await knex.schema.hasTable(TABLE_NAME);
  if (hasCrudTable) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.string("surface", 64).notNullable();
    table.boolean("enabled").notNullable().defaultTo(true);
    table.string("ad_unit_path", 255).notNullable();
    table.string("script_mode", 64).notNullable().defaultTo("gpt_rewarded");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.raw("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"));
    table.index(["workspace_id"], "idx_google_rewarded_provider_configs_workspace");
    table.unique(["workspace_id","surface"], "uq_google_rewarded_provider_configs_workspace_surface");
    table.foreign(["workspace_id"], "fk_google_rewarded_provider_configs_workspace").references(["id"]).inTable("workspaces").onUpdate("RESTRICT").onDelete("CASCADE");
  });

};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
