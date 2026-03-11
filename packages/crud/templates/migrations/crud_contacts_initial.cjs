// JSKIT_MIGRATION_ID: crud_contacts_initial

exports.up = async function up(knex) {
  const hasContactsTable = await knex.schema.hasTable("contacts");
  if (hasContactsTable) {
    return;
  }

  await knex.schema.createTable("contacts", (table) => {
    table.increments("id").unsigned().primary();
    table.integer("workspace_owner_id").unsigned().nullable().index();
    table.integer("user_owner_id").unsigned().nullable().index();
    table.string("name", 160).notNullable();
    table.string("surname", 160).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("contacts");
};
