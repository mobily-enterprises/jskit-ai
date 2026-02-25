exports.up = async function up(knex) {
  const hasUserAlerts = await knex.schema.hasTable("user_alerts");
  if (!hasUserAlerts) {
    await knex.schema.createTable("user_alerts", (table) => {
      table.bigIncrements("id").primary();
      table.bigInteger("user_id").unsigned().notNullable();
      table.string("type", 80).notNullable();
      table.string("title", 200).notNullable();
      table.string("message", 1000).nullable();
      table.string("target_url", 2048).notNullable();
      table.json("payload_json").nullable();
      table.bigInteger("actor_user_id").unsigned().nullable();
      table.bigInteger("workspace_id").unsigned().nullable();
      table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

      table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
      table.foreign("actor_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
      table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("SET NULL");

      table.index(["user_id", "id"], "idx_user_alerts_user_id_id");
      table.index(["user_id", "created_at"], "idx_user_alerts_user_id_created_at");
      table.index(["workspace_id", "created_at"], "idx_user_alerts_workspace_id_created_at");
    });
  }

  const hasUserAlertStates = await knex.schema.hasTable("user_alert_states");
  if (!hasUserAlertStates) {
    await knex.schema.createTable("user_alert_states", (table) => {
      table.bigInteger("user_id").unsigned().notNullable().primary();
      table.bigInteger("read_through_alert_id").unsigned().nullable();
      table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

      table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    });
  }

  const hasUserAlertStatesUpdatedAt = await knex.schema.hasColumn("user_alert_states", "updated_at");
  if (hasUserAlertStatesUpdatedAt) {
    await knex.raw(`
      ALTER TABLE user_alert_states
      MODIFY COLUMN updated_at DATETIME(3)
      NOT NULL
      DEFAULT CURRENT_TIMESTAMP(3)
      ON UPDATE CURRENT_TIMESTAMP(3)
    `);
  }
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260225000000_create_user_alerts_forward is irreversible.");
};
