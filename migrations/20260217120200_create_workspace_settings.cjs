exports.up = async function up(knex) {
  await knex.schema.createTable("workspace_settings", (table) => {
    table.bigInteger("workspace_id").unsigned().primary();
    table.boolean("invites_enabled").notNullable().defaultTo(false);
    table.json("features_json").nullable();
    table.json("policy_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("workspace_settings");
};
