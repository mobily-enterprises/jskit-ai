exports.up = async function up(knex) {
  await knex.schema.createTable("chat_messages", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("thread_id").unsigned().notNullable();
    table.bigInteger("thread_seq").unsigned().notNullable();
    table.bigInteger("sender_user_id").unsigned().notNullable();
    table.string("client_message_id", 128).nullable();
    table.string("idempotency_payload_sha256", 64).nullable();
    table.integer("idempotency_payload_version").unsigned().nullable();
    table.string("message_kind", 32).notNullable().defaultTo("text");
    table.bigInteger("reply_to_message_id").unsigned().nullable();
    table.text("text_content", "longtext").nullable();
    table.binary("ciphertext_blob").nullable();
    table.binary("cipher_nonce", 64).nullable();
    table.string("cipher_alg", 32).nullable();
    table.string("key_ref", 128).nullable();
    table.text("metadata_json", "mediumtext").notNullable().defaultTo("{}");
    table.dateTime("edited_at", { precision: 3 }).nullable();
    table.dateTime("deleted_at", { precision: 3 }).nullable();
    table.bigInteger("deleted_by_user_id").unsigned().nullable();
    table.dateTime("sent_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["thread_id", "thread_seq"], "uq_chat_messages_thread_seq");
    table.unique(["thread_id", "sender_user_id", "client_message_id"], "uq_chat_messages_thread_sender_client_id");
    table.index(["thread_id", "sent_at"], "idx_chat_messages_thread_sent_at");
    table.index(["thread_id", "id"], "idx_chat_messages_thread_id");
    table.index(["sender_user_id", "sent_at"], "idx_chat_messages_sender_sent_at");

    table.foreign("thread_id").references("id").inTable("chat_threads").onDelete("CASCADE");
    table.foreign("sender_user_id").references("id").inTable("user_profiles").onDelete("RESTRICT");
    table.foreign("reply_to_message_id").references("id").inTable("chat_messages").onDelete("SET NULL");
    table.foreign("deleted_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
  });

  await knex.raw(`
    ALTER TABLE chat_messages
    MODIFY idempotency_payload_sha256 CHAR(64) NULL,
    MODIFY idempotency_payload_version SMALLINT UNSIGNED NULL,
    MODIFY ciphertext_blob LONGBLOB NULL,
    MODIFY cipher_nonce VARBINARY(64) NULL
  `);

  await knex.raw(`
    ALTER TABLE chat_messages
    MODIFY client_message_id VARCHAR(128)
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_bin
      NULL
  `);

  await knex.schema.createTable("chat_attachments", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("thread_id").unsigned().notNullable();
    table.bigInteger("message_id").unsigned().nullable();
    table.bigInteger("uploaded_by_user_id").unsigned().notNullable();
    table.string("client_attachment_id", 128).nullable();
    table.integer("position").unsigned().nullable();
    table.string("attachment_kind", 32).notNullable();
    table.string("status", 32).notNullable().defaultTo("reserved");
    table.string("storage_driver", 32).notNullable().defaultTo("fs");
    table.string("storage_key", 255).nullable();
    table.string("delivery_path", 512).nullable();
    table.string("preview_storage_key", 255).nullable();
    table.string("preview_delivery_path", 512).nullable();
    table.string("mime_type", 160).nullable();
    table.string("file_name", 255).nullable();
    table.bigInteger("size_bytes").unsigned().nullable();
    table.string("sha256_hex", 64).nullable();
    table.integer("width").unsigned().nullable();
    table.integer("height").unsigned().nullable();
    table.integer("duration_ms").unsigned().nullable();
    table.dateTime("upload_expires_at", { precision: 3 }).nullable();
    table.dateTime("processed_at", { precision: 3 }).nullable();
    table.string("failed_reason", 255).nullable();
    table.text("metadata_json", "mediumtext").notNullable().defaultTo("{}");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("deleted_at", { precision: 3 }).nullable();

    table.unique(["message_id", "position"], "uq_chat_attachments_message_position");
    table.unique(
      ["thread_id", "uploaded_by_user_id", "client_attachment_id"],
      "uq_chat_attachments_thread_user_client_attachment_id"
    );
    table.index(["thread_id", "status", "created_at"], "idx_chat_attachments_thread_status_created");
    table.index(["message_id"], "idx_chat_attachments_message_id");
    table.index(["status", "upload_expires_at"], "idx_chat_attachments_status_upload_expires");
    table.index(["uploaded_by_user_id", "created_at"], "idx_chat_attachments_user_created");

    table.foreign("thread_id").references("id").inTable("chat_threads").onDelete("RESTRICT");
    table.foreign("message_id").references("id").inTable("chat_messages").onDelete("RESTRICT");
    table.foreign("uploaded_by_user_id").references("id").inTable("user_profiles").onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE chat_attachments
    MODIFY client_attachment_id VARCHAR(128)
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_bin
      NULL
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("chat_attachments");
  await knex.schema.dropTableIfExists("chat_messages");
};
