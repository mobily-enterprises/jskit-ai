const TABLE_NAME = __JSKIT_CRUD_TABLE_NAME__;

exports.up = async function up(knex) {
  const hasCrudTable = await knex.schema.hasTable(TABLE_NAME);
  if (hasCrudTable) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
__JSKIT_CRUD_MIGRATION_COLUMN_LINES__
__JSKIT_CRUD_MIGRATION_INDEX_LINES__
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
