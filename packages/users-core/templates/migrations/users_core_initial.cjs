// JSKIT_MIGRATION_ID: users-core-initial-schema

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("user_profiles", (table) => {
    table.increments("id").primary();
    table.string("auth_provider", 64).notNullable();
    table.string("auth_provider_user_id", 191).notNullable();
    table.string("email", 255).notNullable();
    table.string("display_name", 160).notNullable();
    table.string("avatar_storage_key", 512).nullable();
    table.string("avatar_version", 64).nullable();
    table.timestamp("avatar_updated_at", { useTz: false }).nullable();
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.unique(["auth_provider", "auth_provider_user_id"], "uq_user_profiles_identity");
    table.unique(["email"], "uq_user_profiles_email");
  });

  await knex.schema.createTable("workspaces", (table) => {
    table.increments("id").primary();
    table.string("slug", 120).notNullable().unique();
    table.string("name", 160).notNullable();
    table.integer("owner_user_id").unsigned().notNullable().references("id").inTable("user_profiles").onDelete("CASCADE");
    table.boolean("is_personal").notNullable().defaultTo(true);
    table.string("avatar_url", 512).notNullable().defaultTo("");
    table.string("color", 7).notNullable().defaultTo("#0F6B54");
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at", { useTz: false }).nullable();
  });

  await knex.schema.createTable("workspace_memberships", (table) => {
    table.increments("id").primary();
    table.integer("workspace_id").unsigned().notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
    table.integer("user_id").unsigned().notNullable().references("id").inTable("user_profiles").onDelete("CASCADE");
    table.string("role_id", 64).notNullable().defaultTo("member");
    table.string("status", 32).notNullable().defaultTo("active");
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.unique(["workspace_id", "user_id"], "uq_workspace_memberships_workspace_user");
  });

  await knex.schema.createTable("workspace_settings", (table) => {
    table.integer("workspace_id").unsigned().primary().references("id").inTable("workspaces").onDelete("CASCADE");
    table.boolean("invites_enabled").notNullable().defaultTo(true);
    table.text("features_json").notNullable();
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workspace_invites", (table) => {
    table.increments("id").primary();
    table.integer("workspace_id").unsigned().notNullable().references("id").inTable("workspaces").onDelete("CASCADE");
    table.string("email", 255).notNullable();
    table.string("role_id", 64).notNullable().defaultTo("member");
    table.string("status", 32).notNullable().defaultTo("pending");
    table.string("token_hash", 191).notNullable();
    table.integer("invited_by_user_id").unsigned().nullable().references("id").inTable("user_profiles").onDelete("SET NULL");
    table.timestamp("expires_at", { useTz: false }).nullable();
    table.timestamp("accepted_at", { useTz: false }).nullable();
    table.timestamp("revoked_at", { useTz: false }).nullable();
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.unique(["token_hash"], "uq_workspace_invites_token_hash");
    table.index(["workspace_id", "status"], "idx_workspace_invites_workspace_status");
  });

  await knex.schema.createTable("user_settings", (table) => {
    table.integer("user_id").unsigned().primary().references("id").inTable("user_profiles").onDelete("CASCADE");
    table.integer("last_active_workspace_id").unsigned().nullable().references("id").inTable("workspaces").onDelete("SET NULL");
    table.string("theme", 32).notNullable().defaultTo("system");
    table.string("locale", 24).notNullable().defaultTo("en");
    table.string("time_zone", 64).notNullable().defaultTo("UTC");
    table.string("date_format", 32).notNullable().defaultTo("yyyy-mm-dd");
    table.string("number_format", 32).notNullable().defaultTo("1,234.56");
    table.string("currency_code", 3).notNullable().defaultTo("USD");
    table.integer("avatar_size").notNullable().defaultTo(64);
    table.boolean("password_sign_in_enabled").notNullable().defaultTo(true);
    table.boolean("password_setup_required").notNullable().defaultTo(false);
    table.boolean("notify_product_updates").notNullable().defaultTo(true);
    table.boolean("notify_account_activity").notNullable().defaultTo(true);
    table.boolean("notify_security_alerts").notNullable().defaultTo(true);
    table.text("chat_settings_json").notNullable();
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("console_settings", (table) => {
    table.integer("id").primary();
    table.text("assistant_system_prompt_workspace").notNullable().defaultTo("");
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex("console_settings").insert({
    id: 1,
    assistant_system_prompt_workspace: "",
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_settings");
  await knex.schema.dropTableIfExists("user_settings");
  await knex.schema.dropTableIfExists("workspace_invites");
  await knex.schema.dropTableIfExists("workspace_settings");
  await knex.schema.dropTableIfExists("workspace_memberships");
  await knex.schema.dropTableIfExists("workspaces");
  await knex.schema.dropTableIfExists("user_profiles");
};
