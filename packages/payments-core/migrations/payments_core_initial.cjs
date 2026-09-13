exports.up = async function up(knex) {
  await knex.schema.createTable("payment_catalogues", (table) => {
    table.string("catalogue_key", 64).primary();
    table.text("payload", "mediumtext").notNullable();
  });
  await knex.schema.createTable("payment_accounts", (table) => {
    table.string("account_key", 64).primary();
    table.text("payload", "mediumtext").notNullable();
  });
  await knex.schema.createTable("payment_entries", (table) => {
    table.string("entry_key", 64).primary();
    table.string("account_key", 64).notNullable().references("account_key").inTable("payment_accounts");
    table.text("payload", "mediumtext").notNullable();
  });
  await knex.schema.createTable("payment_customers", (table) => {
    table.string("customer_key", 64).primary();
    table.string("subject_id", 200).notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("payment_customers");
  await knex.schema.dropTable("payment_entries");
  await knex.schema.dropTable("payment_accounts");
  await knex.schema.dropTable("payment_catalogues");
};
