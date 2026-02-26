exports.up = async function up(knex) {
  await knex.schema.createTable("workspace_invites", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.string("email", 320).notNullable();
    table.string("role_id", 64).notNullable();
    table.string("token_hash", 128).notNullable().unique();
    table.bigInteger("invited_by_user_id").unsigned().nullable();
    table.dateTime("expires_at", { precision: 3 }).notNullable();
    table.enu("status", ["pending", "accepted", "revoked", "expired"]).notNullable().defaultTo("pending");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("CASCADE");
    table.foreign("invited_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.index(["workspace_id", "status"], "idx_workspace_invites_workspace_status");
    table.index(["expires_at", "status"], "idx_workspace_invites_expires_status");
    table.index(["email", "workspace_id"], "idx_workspace_invites_email_workspace");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("workspace_invites");
};
