exports.up = async function up(knex) {
  await knex.schema.createTable("security_audit_events", (table) => {
    table.bigIncrements("id").primary();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.string("action", 128).notNullable();
    table.enu("outcome", ["success", "failure"]).notNullable().defaultTo("success");
    table.bigInteger("actor_user_id").unsigned().nullable();
    table.string("actor_email", 320).notNullable().defaultTo("");
    table.bigInteger("target_user_id").unsigned().nullable();
    table.bigInteger("workspace_id").unsigned().nullable();
    table.string("surface", 64).notNullable().defaultTo("");
    table.string("request_id", 128).notNullable().defaultTo("");
    table.string("method", 16).notNullable().defaultTo("");
    table.string("path", 2048).notNullable().defaultTo("");
    table.string("ip_address", 64).notNullable().defaultTo("");
    table.string("user_agent", 1024).notNullable().defaultTo("");
    table.text("metadata_json", "mediumtext").notNullable();

    table.foreign("actor_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.foreign("target_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("SET NULL");

    table.index(["created_at"], "idx_security_audit_events_created_at");
    table.index(["action", "created_at"], "idx_security_audit_events_action_created_at");
    table.index(["actor_user_id", "created_at"], "idx_security_audit_events_actor_created_at");
    table.index(["target_user_id", "created_at"], "idx_security_audit_events_target_created_at");
    table.index(["workspace_id", "created_at"], "idx_security_audit_events_workspace_created_at");
    table.index(["outcome", "created_at"], "idx_security_audit_events_outcome_created_at");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("security_audit_events");
};
