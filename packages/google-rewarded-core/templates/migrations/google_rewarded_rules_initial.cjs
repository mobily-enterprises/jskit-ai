const TABLE_NAME = "google_rewarded_rules";

exports.up = async function up(knex) {
  const hasCrudTable = await knex.schema.hasTable(TABLE_NAME);
  if (hasCrudTable) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.string("gate_key", 120).notNullable();
    table.string("surface", 64).notNullable();
    table.boolean("enabled").notNullable().defaultTo(true);
    table.integer("unlock_minutes").unsigned().notNullable().defaultTo(30);
    table.integer("cooldown_minutes").unsigned().notNullable().defaultTo(0);
    table.integer("daily_limit").unsigned().nullable();
    table.string("title", 160).notNullable().defaultTo("");
    table.text("description").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.raw("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"));
    table.index(["workspace_id"], "idx_google_rewarded_rules_workspace");
    table.unique(["workspace_id","gate_key"], "uq_google_rewarded_rules_workspace_gate");
    table.foreign(["workspace_id"], "fk_google_rewarded_rules_workspace").references(["id"]).inTable("workspaces").onUpdate("RESTRICT").onDelete("CASCADE");
  });

};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
