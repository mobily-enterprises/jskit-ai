exports.up = async function up(knex) {
  await knex.schema.createTable("workspaces", (table) => {
    table.bigIncrements("id").primary();
    table.string("slug", 120).notNullable().unique();
    table.string("name", 160).notNullable();
    table.bigInteger("owner_user_id").unsigned().notNullable();
    table.boolean("is_personal").notNullable().defaultTo(false);
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("owner_user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    table.index(["owner_user_id"], "idx_workspaces_owner");
    table.index(["is_personal"], "idx_workspaces_is_personal");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("workspaces");
};
