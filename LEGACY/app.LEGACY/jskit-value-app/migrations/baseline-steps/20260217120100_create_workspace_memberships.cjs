exports.up = async function up(knex) {
  await knex.schema.createTable("workspace_memberships", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("role_id", 64).notNullable();
    table.enu("status", ["active", "invited", "suspended"]).notNullable().defaultTo("active");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    table.unique(["workspace_id", "user_id"], "uq_workspace_memberships_workspace_user");
    table.index(["user_id", "status"], "idx_workspace_memberships_user_status");
    table.index(["workspace_id", "status"], "idx_workspace_memberships_workspace_status");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("workspace_memberships");
};
