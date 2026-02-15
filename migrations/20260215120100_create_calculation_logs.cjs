exports.up = async function up(knex) {
  await knex.schema.createTable("calculation_logs", (table) => {
    table.string("id", 36).primary();
    table.bigInteger("user_id").unsigned().notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.enu("mode", ["fv", "pv"]).notNullable();
    table.enu("timing", ["ordinary", "due"]).notNullable();
    table.decimal("payment", 20, 6).notNullable();
    table.decimal("annual_rate", 10, 6).notNullable();
    table.decimal("annual_growth_rate", 10, 6).notNullable();
    table.decimal("years", 10, 4).nullable();
    table.integer("payments_per_year").unsigned().notNullable();
    table.decimal("periodic_rate", 20, 12).notNullable();
    table.decimal("periodic_growth_rate", 20, 12).notNullable();
    table.decimal("total_periods", 14, 4).nullable();
    table.boolean("is_perpetual").notNullable().defaultTo(false);
    table.decimal("value", 36, 12).notNullable();

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");

    table.index(["user_id", "created_at"], "idx_calculation_logs_user_created");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("calculation_logs");
};
