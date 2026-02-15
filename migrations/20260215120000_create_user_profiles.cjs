exports.up = async function up(knex) {
  await knex.schema.createTable("user_profiles", (table) => {
    table.bigIncrements("id").primary();
    table.string("supabase_user_id", 36).notNullable().unique();
    table.string("email", 320).notNullable().unique();
    table.string("display_name", 120).notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("user_profiles");
};
