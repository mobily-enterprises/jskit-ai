exports.up = async function up(knex) {
  await knex.schema.alterTable("workspaces", (table) => {
    table.string("color", 7).notNullable().defaultTo("#0F6B54");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("workspaces", (table) => {
    table.dropColumn("color");
  });
};
