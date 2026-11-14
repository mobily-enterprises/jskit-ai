// What a disabled account's sign-in is told, as the application wrote it when it
// disabled the account through auth.local.accounts' disable; null when it gave none.
const USERS_TABLE = "auth_local_users";
const COLUMN_NAME = "disabled_message";
const MESSAGE_MAX_LENGTH = 500;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(USERS_TABLE, COLUMN_NAME))) {
    await knex.schema.alterTable(USERS_TABLE, (table) => {
      table.string(COLUMN_NAME, MESSAGE_MAX_LENGTH).nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn(USERS_TABLE, COLUMN_NAME)) {
    await knex.schema.alterTable(USERS_TABLE, (table) => {
      table.dropColumn(COLUMN_NAME);
    });
  }
};
