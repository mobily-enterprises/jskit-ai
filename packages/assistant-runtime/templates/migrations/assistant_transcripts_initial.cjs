exports.up = async function up(knex) {
  const hasWorkspacesTable = await knex.schema.hasTable("workspaces");
  const hasConversationsTable = await knex.schema.hasTable("assistant_conversations");
  if (!hasConversationsTable) {
    await knex.schema.createTable("assistant_conversations", (table) => {
      table.increments("id").unsigned().primary();
      table.integer("workspace_id").unsigned().nullable();
      if (hasWorkspacesTable) {
        table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
      }
      table.integer("created_by_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL").index();
      table.string("title", 160).notNullable().defaultTo("New conversation");
      table.string("status", 32).notNullable().defaultTo("active");
      table.string("provider", 64).notNullable().defaultTo("");
      table.string("model", 128).notNullable().defaultTo("");
      table.string("surface_id", 32).notNullable();
      table.integer("message_count").unsigned().notNullable().defaultTo(0);
      table.text("metadata_json").nullable();
      table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("ended_at").nullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.index(["surface_id", "started_at"], "idx_assistant_conversations_surface_started_at");
      table.index(["workspace_id", "started_at"], "idx_assistant_conversations_workspace_started_at");
      table.index(["created_by_user_id", "started_at"], "idx_assistant_conversations_creator_started_at");
    });
  }

  const hasMessagesTable = await knex.schema.hasTable("assistant_messages");
  if (!hasMessagesTable) {
    await knex.schema.createTable("assistant_messages", (table) => {
      table.increments("id").unsigned().primary();
      table.integer("conversation_id").unsigned().notNullable().references("id").inTable("assistant_conversations").onDelete("CASCADE");
      table.integer("workspace_id").unsigned().nullable();
      if (hasWorkspacesTable) {
        table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
      }
      table.integer("seq").unsigned().notNullable();
      table.string("role", 32).notNullable();
      table.string("kind", 32).notNullable().defaultTo("chat");
      table.string("client_message_sid", 128).notNullable().defaultTo("");
      table.integer("actor_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL").index();
      table.text("content_text").nullable();
      table.text("metadata_json").nullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

      table.unique(["conversation_id", "seq"], "uq_assistant_messages_conversation_seq");
      table.index(["conversation_id", "created_at"], "idx_assistant_messages_conversation_created_at");
      table.index(["workspace_id"], "idx_assistant_messages_workspace");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("assistant_messages");
  await knex.schema.dropTableIfExists("assistant_conversations");
};
