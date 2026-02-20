exports.up = async function up(knex) {
  await knex.schema.alterTable("ai_conversations", (table) => {
    table.string("title", 160).notNullable().defaultTo("New conversation");
  });

  await knex("ai_conversations")
    .whereNull("title")
    .orWhere("title", "")
    .update({
      title: "New conversation"
    });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("ai_conversations", (table) => {
    table.dropColumn("title");
  });
};
