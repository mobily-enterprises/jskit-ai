exports.up = async function up(knex) {
  await knex.schema.alterTable("user_profiles", (table) => {
    table.string("avatar_storage_key", 255).nullable();
    table.bigInteger("avatar_version").unsigned().nullable();
    table.dateTime("avatar_updated_at", { precision: 3 }).nullable();
  });

  await knex.schema.alterTable("user_settings", (table) => {
    table.integer("avatar_size").unsigned().notNullable().defaultTo(64);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.dropColumn("avatar_size");
  });

  await knex.schema.alterTable("user_profiles", (table) => {
    table.dropColumn("avatar_storage_key");
    table.dropColumn("avatar_version");
    table.dropColumn("avatar_updated_at");
  });
};
