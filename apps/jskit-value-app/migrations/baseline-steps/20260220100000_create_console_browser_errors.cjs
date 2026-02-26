exports.up = async function up(knex) {
  await knex.schema.createTable("console_browser_errors", (table) => {
    table.bigIncrements("id").primary();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("occurred_at", { precision: 3 }).nullable();
    table.string("source", 48).notNullable().defaultTo("window.error");
    table.string("error_name", 160).notNullable().defaultTo("");
    table.text("message", "longtext").notNullable();
    table.text("stack", "longtext").notNullable();
    table.string("url", 2048).notNullable().defaultTo("");
    table.string("path", 2048).notNullable().defaultTo("");
    table.string("surface", 64).notNullable().defaultTo("");
    table.string("user_agent", 1024).notNullable().defaultTo("");
    table.integer("line_number").nullable();
    table.integer("column_number").nullable();
    table.bigInteger("user_id").unsigned().nullable();
    table.string("username", 160).notNullable().defaultTo("");
    table.text("metadata_json", "mediumtext").notNullable();

    table.index(["created_at"], "idx_console_browser_errors_created_at");
    table.index(["surface", "created_at"], "idx_console_browser_errors_surface_created_at");
    table.index(["user_id", "created_at"], "idx_console_browser_errors_user_created_at");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_browser_errors");
};
