exports.up = async function up(knex) {
  await knex.schema.createTable("console_settings", (table) => {
    table.bigInteger("id").unsigned().primary();
    table.json("features_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_settings");
};
