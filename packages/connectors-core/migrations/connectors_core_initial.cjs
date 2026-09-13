exports.up = async function up(knex) {
  await knex.schema.createTable("connector_connections", (table) => {
    table.string("connection_key", 64).primary();
    table.text("payload", "mediumtext").nullable();
  });
  await knex.schema.createTable("connector_authorization_attempts", (table) => {
    table.string("attempt_key", 64).primary();
    table.string("connection_key", 64).notNullable().references("connection_key").inTable("connector_connections").onDelete("CASCADE");
    table.bigInteger("expires_at").notNullable().index();
    table.text("payload", "mediumtext").notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("connector_authorization_attempts");
  await knex.schema.dropTable("connector_connections");
};
