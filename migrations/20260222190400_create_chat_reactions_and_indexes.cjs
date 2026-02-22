exports.up = async function up(knex) {
  await knex.schema.createTable("chat_message_reactions", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("message_id").unsigned().notNullable();
    table.bigInteger("thread_id").unsigned().notNullable();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("reaction", 32).notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["message_id", "user_id", "reaction"], "uq_chat_message_reactions_message_user_reaction");
    table.index(["thread_id", "message_id"], "idx_chat_message_reactions_thread_message");
    table.index(["user_id", "created_at"], "idx_chat_message_reactions_user_created");

    table.foreign("message_id").references("id").inTable("chat_messages").onDelete("CASCADE");
    table.foreign("thread_id").references("id").inTable("chat_threads").onDelete("CASCADE");
    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("chat_message_reactions");
};
