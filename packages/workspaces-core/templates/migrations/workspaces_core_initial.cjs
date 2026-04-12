/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable("users");
  if (!hasUsersTable) {
    throw new Error("workspaces-core initial migration requires users table.");
  }

  const hasWorkspacesTable = await knex.schema.hasTable("workspaces");
  if (!hasWorkspacesTable) {
    await knex.schema.createTable("workspaces", (table) => {
      table.bigIncrements("id").primary();
      table.string("slug", 120).notNullable().unique();
      table.string("name", 160).notNullable();
      table.bigInteger("owner_user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
      table.boolean("is_personal").notNullable().defaultTo(true);
      table.string("avatar_url", 512).notNullable().defaultTo("");
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("deleted_at", { useTz: false }).nullable();
    });
  }

  const hasWorkspaceMembershipsTable = await knex.schema.hasTable("workspace_memberships");
  if (!hasWorkspaceMembershipsTable) {
    await knex.schema.createTable("workspace_memberships", (table) => {
      table.bigIncrements("id").primary();
      table.bigInteger("workspace_id").unsigned().notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
      table.bigInteger("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
      table.string("role_sid", 64).notNullable().defaultTo("member");
      table.string("status", 32).notNullable().defaultTo("active");
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.unique(["workspace_id", "user_id"], "uq_workspace_memberships_workspace_user");
    });
  }

  const hasWorkspaceSettingsTable = await knex.schema.hasTable("workspace_settings");
  if (!hasWorkspaceSettingsTable) {
    await knex.schema.createTable("workspace_settings", (table) => {
      table.bigInteger("workspace_id").unsigned().primary().references("id").inTable("workspaces").onDelete("CASCADE");
      table.string("light_primary_color", 7).notNullable().defaultTo("#1867C0");
      table.string("light_secondary_color", 7).notNullable().defaultTo("#48A9A6");
      table.string("light_surface_color", 7).notNullable().defaultTo("#FFFFFF");
      table.string("light_surface_variant_color", 7).notNullable().defaultTo("#424242");
      table.string("dark_primary_color", 7).notNullable().defaultTo("#2196F3");
      table.string("dark_secondary_color", 7).notNullable().defaultTo("#54B6B2");
      table.string("dark_surface_color", 7).notNullable().defaultTo("#212121");
      table.string("dark_surface_variant_color", 7).notNullable().defaultTo("#C8C8C8");
      table.boolean("invites_enabled").notNullable().defaultTo(true);
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasWorkspaceInvitesTable = await knex.schema.hasTable("workspace_invites");
  if (!hasWorkspaceInvitesTable) {
    await knex.schema.createTable("workspace_invites", (table) => {
      table.bigIncrements("id").primary();
      table.bigInteger("workspace_id").unsigned().notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
      table.string("email", 255).notNullable();
      table.string("role_sid", 64).notNullable().defaultTo("member");
      table.string("status", 32).notNullable().defaultTo("pending");
      table.string("token_hash", 191).notNullable();
      table.bigInteger("invited_by_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL");
      table.timestamp("expires_at", { useTz: false }).nullable();
      table.timestamp("accepted_at", { useTz: false }).nullable();
      table.timestamp("revoked_at", { useTz: false }).nullable();
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.unique(["token_hash"], "uq_workspace_invites_token_hash");
      table.index(["workspace_id", "status"], "idx_workspace_invites_workspace_status");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("workspace_invites");
  await knex.schema.dropTableIfExists("workspace_settings");
  await knex.schema.dropTableIfExists("workspace_memberships");
  await knex.schema.dropTableIfExists("workspaces");
};
