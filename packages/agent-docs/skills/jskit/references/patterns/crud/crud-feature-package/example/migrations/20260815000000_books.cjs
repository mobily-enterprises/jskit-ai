const TABLE_NAME = "books";

exports.up = async function up(knex) {
  if (await knex.schema.hasTable(TABLE_NAME)) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("user_id").unsigned().notNullable().index()
      .references("id").inTable("users").onDelete("CASCADE");
    table.string("title", 255).notNullable();
    table.string("author", 255).notNullable();
    table.text("notes").nullable();
    table.timestamp("created_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
