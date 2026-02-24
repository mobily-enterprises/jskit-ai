exports.up = async function up(knex) {
  await knex.schema.createTable("user_settings", (table) => {
    table.bigInteger("user_id").unsigned().primary();
    table.enu("theme", ["system", "light", "dark"]).notNullable().defaultTo("system");
    table.string("locale", 24).notNullable().defaultTo("en-US");
    table.string("time_zone", 64).notNullable().defaultTo("UTC");
    table.enu("date_format", ["system", "mdy", "dmy", "ymd"]).notNullable().defaultTo("system");
    table.enu("number_format", ["system", "comma-dot", "dot-comma", "space-comma"]).notNullable().defaultTo("system");
    table.string("currency_code", 3).notNullable().defaultTo("USD");

    table.boolean("notify_product_updates").notNullable().defaultTo(true);
    table.boolean("notify_account_activity").notNullable().defaultTo(true);
    table.boolean("notify_security_alerts").notNullable().defaultTo(true);

    table.enu("default_mode", ["fv", "pv"]).notNullable().defaultTo("fv");
    table.enu("default_timing", ["ordinary", "due"]).notNullable().defaultTo("ordinary");
    table.integer("default_payments_per_year").unsigned().notNullable().defaultTo(12);
    table.integer("default_history_page_size").unsigned().notNullable().defaultTo(10);

    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_settings");
};
