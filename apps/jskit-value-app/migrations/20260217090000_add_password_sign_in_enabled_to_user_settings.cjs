exports.up = async function up(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.boolean("password_sign_in_enabled").notNullable().defaultTo(true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("user_settings", (table) => {
    table.dropColumn("password_sign_in_enabled");
  });
};
