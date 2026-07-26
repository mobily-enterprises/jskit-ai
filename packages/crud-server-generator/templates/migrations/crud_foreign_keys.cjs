const TABLE_NAME = __JSKIT_CRUD_TABLE_NAME__;
const HAS_FOREIGN_KEYS = __JSKIT_CRUD_MIGRATION_HAS_FOREIGN_KEYS__;

exports.up = async function up(knex) {
  if (!HAS_FOREIGN_KEYS) {
    return;
  }

  const hasCrudTable = await knex.schema.hasTable(TABLE_NAME);
  if (!hasCrudTable) {
    throw new Error(`Cannot install foreign keys before table "${TABLE_NAME}" exists.`);
  }

  await knex.schema.alterTable(TABLE_NAME, (table) => {
__JSKIT_CRUD_MIGRATION_FOREIGN_KEY_LINES__
  });
};

exports.down = async function down(knex) {
  if (!HAS_FOREIGN_KEYS || !(await knex.schema.hasTable(TABLE_NAME))) {
    return;
  }

  await knex.schema.alterTable(TABLE_NAME, (table) => {
__JSKIT_CRUD_MIGRATION_DROP_FOREIGN_KEY_LINES__
  });
};
