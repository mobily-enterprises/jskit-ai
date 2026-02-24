exports.up = async function up(knex) {
  await knex.schema.createTable("user_profiles", (table) => {
    table.bigIncrements("id").primary();
    table.string("auth_provider", 64).notNullable();
    table.string("auth_provider_user_id", 191).notNullable();
    table.unique(["auth_provider", "auth_provider_user_id"], "uq_user_profiles_auth_provider_user_id");
    table.string("email", 320).notNullable().unique();
    table.string("display_name", 120).notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_profiles");
};
