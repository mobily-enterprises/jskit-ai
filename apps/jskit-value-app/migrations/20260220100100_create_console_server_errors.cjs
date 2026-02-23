function isDuplicateIndexError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (code === "ER_DUP_KEYNAME") {
    return true;
  }

  const message = String(error?.message || "");
  return /Duplicate key name/i.test(message);
}

async function ensureIndex(knex, indexName, indexDefinition) {
  try {
    await knex.raw(`ALTER TABLE console_server_errors ADD INDEX ${indexName} ${indexDefinition}`);
  } catch (error) {
    if (!isDuplicateIndexError(error)) {
      throw error;
    }
  }
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("console_server_errors");
  if (!hasTable) {
    await knex.schema.createTable("console_server_errors", (table) => {
      table.bigIncrements("id").primary();
      table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
      table.string("request_id", 128).notNullable().defaultTo("");
      table.string("method", 16).notNullable().defaultTo("");
      table.string("path", 2048).notNullable().defaultTo("");
      table.integer("status_code").notNullable().defaultTo(500);
      table.string("error_name", 160).notNullable().defaultTo("");
      table.text("message", "longtext").notNullable();
      table.text("stack", "longtext").notNullable();
      table.bigInteger("user_id").unsigned().nullable();
      table.string("username", 160).notNullable().defaultTo("");
      table.text("metadata_json", "mediumtext").notNullable();
    });
  }

  await ensureIndex(knex, "idx_console_server_errors_created_at", "(created_at)");
  await ensureIndex(knex, "idx_console_server_errors_status_created_at", "(status_code, created_at)");
  await ensureIndex(knex, "idx_console_server_errors_path_created_at", "(path(255), created_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_server_errors");
};
