exports.up = async function up(knex) {
  await knex.schema.createTable("chat_message_idempotency_tombstones", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("thread_id").unsigned().notNullable();
    table.bigInteger("sender_user_id").unsigned().notNullable();
    table.string("client_message_id", 128).notNullable();
    table.integer("idempotency_payload_version").unsigned().notNullable();
    table.string("idempotency_payload_sha256", 64).notNullable();
    table.bigInteger("original_message_id").unsigned().nullable();
    table.dateTime("deleted_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("expires_at", { precision: 3 }).notNullable();
    table.string("delete_reason", 64).nullable();
    table.text("metadata_json", "mediumtext").notNullable().defaultTo("{}");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["thread_id", "sender_user_id", "client_message_id"],
      "uq_chat_idempotency_tombstones_thread_sender_client_id"
    );
    table.index(["expires_at"], "idx_chat_idempotency_tombstones_expires_at");
    table.index(
      ["thread_id", "sender_user_id", "deleted_at"],
      "idx_chat_idempotency_tombstones_thread_sender_deleted_at"
    );

    table.foreign("thread_id").references("id").inTable("chat_threads").onDelete("CASCADE");
    table.foreign("sender_user_id").references("id").inTable("user_profiles").onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE chat_message_idempotency_tombstones
    MODIFY idempotency_payload_sha256 CHAR(64) NOT NULL,
    MODIFY idempotency_payload_version SMALLINT UNSIGNED NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE chat_message_idempotency_tombstones
    MODIFY client_message_id VARCHAR(128)
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_bin
      NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("chat_message_idempotency_tombstones");
};
