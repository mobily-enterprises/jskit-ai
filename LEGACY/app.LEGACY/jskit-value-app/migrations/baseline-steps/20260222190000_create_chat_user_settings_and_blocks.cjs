exports.up = async function up(knex) {
  await knex.schema.createTable("chat_user_settings", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("public_chat_id", 64).nullable();
    table.boolean("allow_workspace_dms").notNullable().defaultTo(true);
    table.boolean("allow_global_dms").notNullable().defaultTo(false);
    table.boolean("require_shared_workspace_for_global_dm").notNullable().defaultTo(true);
    table.boolean("discoverable_by_public_chat_id").notNullable().defaultTo(false);
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["user_id"], "uq_chat_user_settings_user_id");
    table.unique(["public_chat_id"], "uq_chat_user_settings_public_chat_id");
    table.index(["allow_global_dms"], "idx_chat_user_settings_allow_global_dms");

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
  });

  await knex.schema.createTable("chat_user_blocks", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("user_id").unsigned().notNullable();
    table.bigInteger("blocked_user_id").unsigned().notNullable();
    table.string("reason", 64).notNullable().defaultTo("");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["user_id", "blocked_user_id"], "uq_chat_user_blocks_user_blocked_user");
    table.index(["blocked_user_id", "created_at"], "idx_chat_user_blocks_blocked_user_created");

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    table.foreign("blocked_user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("chat_user_blocks");
  await knex.schema.dropTableIfExists("chat_user_settings");
};
