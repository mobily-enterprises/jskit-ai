exports.up = async function up(knex) {
  const hasConversationsTable = await knex.schema.hasTable("ai_conversations");
  if (!hasConversationsTable) {
    await knex.schema.createTable("ai_conversations", (table) => {
      table.increments("id").unsigned().primary();
      table.integer("workspace_id").unsigned().notNullable().references("id").inTable("workspaces").onDelete("CASCADE").index();
      table.integer("created_by_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL").index();
      table.string("title", 160).notNullable().defaultTo("New conversation");
      table.string("status", 32).notNullable().defaultTo("active");
      table.string("provider", 64).notNullable().defaultTo("");
      table.string("model", 128).notNullable().defaultTo("");
      table.string("surface_sid", 32).notNullable().defaultTo("admin");
      table.integer("message_count").unsigned().notNullable().defaultTo(0);
      table.text("metadata_json").nullable();
      table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("ended_at").nullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.index(["workspace_id", "started_at"], "idx_ai_conversations_workspace_started_at");
      table.index(["workspace_id", "created_by_user_id"], "idx_ai_conversations_workspace_creator");
    });
  }

  const hasMessagesTable = await knex.schema.hasTable("ai_messages");
  if (!hasMessagesTable) {
    await knex.schema.createTable("ai_messages", (table) => {
      table.increments("id").unsigned().primary();
      table.integer("conversation_id").unsigned().notNullable().references("id").inTable("ai_conversations").onDelete("CASCADE");
      table.integer("workspace_id").unsigned().notNullable().references("id").inTable("workspaces").onDelete("CASCADE").index();
      table.integer("seq").unsigned().notNullable();
      table.string("role", 32).notNullable();
      table.string("kind", 32).notNullable().defaultTo("chat");
      table.string("client_message_sid", 128).notNullable().defaultTo("");
      table.integer("actor_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL").index();
      table.text("content_text").nullable();
      table.text("metadata_json").nullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

      table.unique(["conversation_id", "seq"], "uq_ai_messages_conversation_seq");
      table.index(["conversation_id", "created_at"], "idx_ai_messages_conversation_created_at");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("ai_messages");
  await knex.schema.dropTableIfExists("ai_conversations");
};
