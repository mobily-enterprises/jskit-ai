exports.up = async function up(knex) {
  const hasConversationsTable = await knex.schema.hasTable("__ASSISTANT_CONVERSATIONS_TABLE__");
  if (!hasConversationsTable) {
    await knex.schema.createTable("__ASSISTANT_CONVERSATIONS_TABLE__", (table) => {
      table.increments("id").unsigned().primary();
      table.integer("workspace_id").unsigned().nullable();
      if (__ASSISTANT_RUNTIME_SURFACE_REQUIRES_WORKSPACE__) {
        table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
      }
      table.integer("created_by_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL").index();
      table.string("title", 160).notNullable().defaultTo("New conversation");
      table.string("status", 32).notNullable().defaultTo("active");
      table.string("provider", 64).notNullable().defaultTo("");
      table.string("model", 128).notNullable().defaultTo("");
      table.string("surface_id", 32).notNullable().defaultTo("__ASSISTANT_RUNTIME_SURFACE_ID__");
      table.integer("message_count").unsigned().notNullable().defaultTo(0);
      table.text("metadata_json").nullable();
      table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("ended_at").nullable();
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.index(["workspace_id", "started_at"], "idx___ASSISTANT_CONVERSATIONS_TABLE___workspace_started_at");
      table.index(["created_by_user_id", "started_at"], "idx___ASSISTANT_CONVERSATIONS_TABLE___creator_started_at");
    });
  }

  const hasMessagesTable = await knex.schema.hasTable("__ASSISTANT_MESSAGES_TABLE__");
  if (!hasMessagesTable) {
    await knex.schema.createTable("__ASSISTANT_MESSAGES_TABLE__", (table) => {
      table.increments("id").unsigned().primary();
      table.integer("conversation_id").unsigned().notNullable().references("id").inTable("__ASSISTANT_CONVERSATIONS_TABLE__").onDelete("CASCADE");
      table.integer("workspace_id").unsigned().nullable();
      if (__ASSISTANT_RUNTIME_SURFACE_REQUIRES_WORKSPACE__) {
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

      table.unique(["conversation_id", "seq"], "uq___ASSISTANT_MESSAGES_TABLE___conversation_seq");
      table.index(["conversation_id", "created_at"], "idx___ASSISTANT_MESSAGES_TABLE___conversation_created_at");
      table.index(["workspace_id"], "idx___ASSISTANT_MESSAGES_TABLE___workspace");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("__ASSISTANT_MESSAGES_TABLE__");
  await knex.schema.dropTableIfExists("__ASSISTANT_CONVERSATIONS_TABLE__");
};
