exports.up = async function up(knex) {
  await knex.schema.alterTable("workspaces", (table) => {
    table.string("avatar_url", 2048).nullable().after("name");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("workspaces", (table) => {
    table.dropColumn("avatar_url");
  });
};
