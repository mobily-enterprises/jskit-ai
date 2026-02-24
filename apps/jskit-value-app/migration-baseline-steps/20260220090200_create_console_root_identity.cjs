exports.up = async function up(knex) {
  await knex.schema.createTable("console_root_identity", (table) => {
    table.bigInteger("id").unsigned().primary();
    table.bigInteger("user_id").unsigned().nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("user_id").references("id").inTable("user_profiles");
    table.unique(["user_id"], "uq_console_root_identity_user");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_root_identity");
};
