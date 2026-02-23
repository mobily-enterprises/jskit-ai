exports.up = async function up(knex) {
  await knex.schema.createTable("workspace_projects", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.string("name", 160).notNullable();
    table.enu("status", ["draft", "active", "archived"]).notNullable().defaultTo("draft");
    table.string("owner", 120).notNullable().defaultTo("");
    table.text("notes").notNullable().defaultTo("");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");

    table.index(["workspace_id", "created_at"], "idx_workspace_projects_workspace_created");
    table.index(["workspace_id", "status"], "idx_workspace_projects_workspace_status");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("workspace_projects");
};
