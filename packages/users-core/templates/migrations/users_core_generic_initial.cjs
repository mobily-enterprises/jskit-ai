/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable("users");
  if (!hasUsersTable) {
    await knex.schema.createTable("users", (table) => {
      table.increments("id").primary();
      table.string("auth_provider", 64).notNullable();
      table.string("auth_provider_user_sid", 191).notNullable();
      table.string("email", 255).notNullable();
      table.string("username", 120).notNullable();
      table.string("display_name", 160).notNullable();
      table.string("avatar_storage_key", 512).nullable();
      table.string("avatar_version", 64).nullable();
      table.timestamp("avatar_updated_at", { useTz: false }).nullable();
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.unique(["auth_provider", "auth_provider_user_sid"], "uq_users_identity");
      table.unique(["email"], "uq_users_email");
      table.unique(["username"], "uq_users_username");
    });
  }

  const hasUserSettingsTable = await knex.schema.hasTable("user_settings");
  if (!hasUserSettingsTable) {
    await knex.schema.createTable("user_settings", (table) => {
      table.integer("user_id").unsigned().primary().references("id").inTable("users").onDelete("CASCADE");
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
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasConsoleSettingsTable = await knex.schema.hasTable("console_settings");
  if (!hasConsoleSettingsTable) {
    await knex.schema.createTable("console_settings", (table) => {
      table.integer("id").primary();
      table.integer("owner_user_id").unsigned().nullable().references("id").inTable("users").onDelete("SET NULL");
      table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    });

    await knex("console_settings").insert({
      id: 1,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_settings");
  await knex.schema.dropTableIfExists("user_settings");
  await knex.schema.dropTableIfExists("users");
};
