const TABLE_NAME = "google_rewarded_watch_sessions";

exports.up = async function up(knex) {
  const hasCrudTable = await knex.schema.hasTable(TABLE_NAME);
  if (hasCrudTable) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.bigIncrements("id").unsigned().primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("gate_key", 120).notNullable();
    table.bigInteger("provider_config_id").unsigned().nullable();
    table.string("status", 32).notNullable().defaultTo("started");
    table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("rewarded_at").nullable();
    table.timestamp("completed_at").nullable();
    table.timestamp("closed_at").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.raw("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"));
    table.index(["user_id"], "fk_google_rewarded_watch_sessions_user");
    table.index(["gate_key"], "idx_google_rewarded_watch_sessions_gate");
    table.index(["provider_config_id"], "idx_google_rewarded_watch_sessions_provider_config");
    table.index(["status"], "idx_google_rewarded_watch_sessions_status");
    table.index(["workspace_id","user_id"], "idx_google_rewarded_watch_sessions_workspace_user");
    table.foreign(["provider_config_id"], "fk_google_rewarded_watch_sessions_provider_config").references(["id"]).inTable("google_rewarded_provider_configs").onUpdate("RESTRICT").onDelete("SET NULL");
    table.foreign(["user_id"], "fk_google_rewarded_watch_sessions_user").references(["id"]).inTable("users").onUpdate("RESTRICT").onDelete("CASCADE");
    table.foreign(["workspace_id"], "fk_google_rewarded_watch_sessions_workspace").references(["id"]).inTable("workspaces").onUpdate("RESTRICT").onDelete("CASCADE");
  });

};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
