const TABLE_NAME = "google_rewarded_unlock_receipts";

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
    table.bigInteger("watch_session_id").unsigned().nullable();
    table.timestamp("granted_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("unlocked_until").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["user_id"], "fk_google_rewarded_unlock_receipts_user");
    table.index(["gate_key"], "idx_google_rewarded_unlock_receipts_gate");
    table.index(["provider_config_id"], "idx_google_rewarded_unlock_receipts_provider_config");
    table.index(["unlocked_until"], "idx_google_rewarded_unlock_receipts_unlocked_until");
    table.index(["watch_session_id"], "idx_google_rewarded_unlock_receipts_watch_session");
    table.index(["workspace_id","user_id"], "idx_google_rewarded_unlock_receipts_workspace_user");
    table.foreign(["provider_config_id"], "fk_google_rewarded_unlock_receipts_provider_config").references(["id"]).inTable("google_rewarded_provider_configs").onUpdate("RESTRICT").onDelete("SET NULL");
    table.foreign(["user_id"], "fk_google_rewarded_unlock_receipts_user").references(["id"]).inTable("users").onUpdate("RESTRICT").onDelete("CASCADE");
    table.foreign(["watch_session_id"], "fk_google_rewarded_unlock_receipts_watch_session").references(["id"]).inTable("google_rewarded_watch_sessions").onUpdate("RESTRICT").onDelete("SET NULL");
    table.foreign(["workspace_id"], "fk_google_rewarded_unlock_receipts_workspace").references(["id"]).inTable("workspaces").onUpdate("RESTRICT").onDelete("CASCADE");
  });

};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
