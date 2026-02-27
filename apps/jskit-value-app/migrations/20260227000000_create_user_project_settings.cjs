exports.up = async function up(knex) {
  await knex.schema.createTable("user_project_settings", (table) => {
    table.bigInteger("user_id").unsigned().primary();
    table.enu("default_view", ["list", "board"]).notNullable().defaultTo("list");
    table
      .enu("default_status_filter", ["all", "active", "draft", "archived"])
      .notNullable()
      .defaultTo("all");
    table.integer("default_page_size").unsigned().notNullable().defaultTo(20);
    table.boolean("include_archived_by_default").notNullable().defaultTo(false);

    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_project_settings");
};
