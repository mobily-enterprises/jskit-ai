exports.up = async function up(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.boolean("password_setup_required").notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.dropColumn("password_setup_required");
  });
};
