exports.up = async function up(knex) {
  if (await knex.schema.hasTable("assistant_turn_requests")) return;
  await knex.schema.createTable("assistant_turn_requests", table => {
    table.bigIncrements("id").primary();
    table.bigInteger("actor_user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("scope_key", 128).notNullable();
    table.string("message_sid", 128).notNullable();
    table.string("claim_token", 36).notNullable();
    table.text("request_json", "longtext").notNullable();
    table.text("response_json", "longtext").nullable();
    table.string("status", 32).notNullable().defaultTo("running");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["actor_user_id", "scope_key", "message_sid"], "uq_assistant_turn_request");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("assistant_turn_requests");
};
