exports.up = async function up(knex) {
  await knex.schema.createTable("ai_conversations", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("created_by_user_id").unsigned().nullable();
    table.string("status", 32).notNullable().defaultTo("active");
    table.string("transcript_mode", 32).notNullable().defaultTo("standard");
    table.string("provider", 64).notNullable().defaultTo("");
    table.string("model", 128).notNullable().defaultTo("");
    table.dateTime("started_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("ended_at", { precision: 3 }).nullable();
    table.integer("message_count").unsigned().notNullable().defaultTo(0);
    table.text("metadata_json", "mediumtext").notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("created_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");

    table.index(["workspace_id", "started_at"], "idx_ai_conversations_workspace_started");
    table.index(["status", "ended_at"], "idx_ai_conversations_status_ended");
    table.index(["created_by_user_id", "started_at"], "idx_ai_conversations_actor_started");
  });

  await knex.schema.createTable("ai_messages", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("conversation_id").unsigned().notNullable();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.integer("seq").unsigned().notNullable();
    table.string("role", 32).notNullable().defaultTo("");
    table.string("kind", 32).notNullable().defaultTo("chat");
    table.string("client_message_id", 128).notNullable().defaultTo("");
    table.bigInteger("actor_user_id").unsigned().nullable();
    table.text("content_text", "longtext").nullable();
    table.boolean("content_redacted").notNullable().defaultTo(false);
    table.text("redaction_hits_json", "mediumtext").notNullable();
    table.text("metadata_json", "mediumtext").notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("conversation_id").references("id").inTable("ai_conversations").onDelete("CASCADE");
    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("actor_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");

    table.unique(["conversation_id", "seq"], "ux_ai_messages_conversation_seq");
    table.index(["conversation_id", "created_at"], "idx_ai_messages_conversation_created");
    table.index(["workspace_id", "created_at"], "idx_ai_messages_workspace_created");
    table.index(["workspace_id", "role", "created_at"], "idx_ai_messages_workspace_role_created");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("ai_messages");
  await knex.schema.dropTableIfExists("ai_conversations");
};
