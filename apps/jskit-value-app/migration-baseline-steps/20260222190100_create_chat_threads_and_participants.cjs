exports.up = async function up(knex) {
  await knex.schema.createTable("chat_threads", (table) => {
    table.bigIncrements("id").primary();
    table.string("scope_kind", 32).notNullable();
    table.bigInteger("workspace_id").unsigned().nullable();
    table.string("thread_kind", 32).notNullable();
    table.bigInteger("created_by_user_id").unsigned().notNullable();
    table.string("title", 160).nullable();
    table.string("avatar_storage_key", 255).nullable();
    table.bigInteger("avatar_version").unsigned().nullable();
    table.string("scope_key", 128).notNullable();
    table.bigInteger("dm_user_low_id").unsigned().nullable();
    table.bigInteger("dm_user_high_id").unsigned().nullable();
    table.integer("participant_count").unsigned().notNullable().defaultTo(0);
    table.bigInteger("next_message_seq").unsigned().notNullable().defaultTo(1);
    table.bigInteger("last_message_id").unsigned().nullable();
    table.bigInteger("last_message_seq").unsigned().nullable();
    table.dateTime("last_message_at", { precision: 3 }).nullable();
    table.string("last_message_preview", 280).nullable();
    table.string("encryption_mode", 32).notNullable().defaultTo("none");
    table.text("metadata_json", "mediumtext").notNullable().defaultTo("{}");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("archived_at", { precision: 3 }).nullable();

    table.unique(["thread_kind", "scope_key", "dm_user_low_id", "dm_user_high_id"], "uq_chat_threads_dm_scope_pair");
    table.index(["workspace_id", "updated_at"], "idx_chat_threads_workspace_updated");
    table.index(["workspace_id", "last_message_at"], "idx_chat_threads_workspace_last_message_at");
    table.index(["scope_kind", "last_message_at"], "idx_chat_threads_scope_last_message_at");
    table.index(["created_by_user_id", "created_at"], "idx_chat_threads_creator_created_at");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("created_by_user_id").references("id").inTable("user_profiles").onDelete("RESTRICT");
  });

  await knex.schema.createTable("chat_thread_participants", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("thread_id").unsigned().notNullable();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("participant_role", 32).notNullable().defaultTo("member");
    table.string("status", 32).notNullable().defaultTo("active");
    table.dateTime("joined_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("left_at", { precision: 3 }).nullable();
    table.bigInteger("removed_by_user_id").unsigned().nullable();
    table.dateTime("mute_until", { precision: 3 }).nullable();
    table.dateTime("archived_at", { precision: 3 }).nullable();
    table.dateTime("pinned_at", { precision: 3 }).nullable();
    table.bigInteger("last_delivered_seq").unsigned().notNullable().defaultTo(0);
    table.bigInteger("last_delivered_message_id").unsigned().nullable();
    table.bigInteger("last_read_seq").unsigned().notNullable().defaultTo(0);
    table.bigInteger("last_read_message_id").unsigned().nullable();
    table.dateTime("last_read_at", { precision: 3 }).nullable();
    table.text("draft_text", "longtext").nullable();
    table.dateTime("draft_updated_at", { precision: 3 }).nullable();
    table.text("metadata_json", "mediumtext").notNullable().defaultTo("{}");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["thread_id", "user_id"], "uq_chat_thread_participants_thread_user");
    table.index(["user_id", "status", "updated_at"], "idx_chat_thread_participants_user_status_updated");
    table.index(["thread_id", "status"], "idx_chat_thread_participants_thread_status");
    table.index(["thread_id", "last_read_seq"], "idx_chat_thread_participants_thread_last_read_seq");

    table.foreign("thread_id").references("id").inTable("chat_threads").onDelete("CASCADE");
    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("RESTRICT");
    table.foreign("removed_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("chat_thread_participants");
  await knex.schema.dropTableIfExists("chat_threads");
};
