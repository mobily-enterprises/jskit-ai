// The address an account's email change waits to confirm, until the link sent to it is used; null when none waits.
const USERS_TABLE = "auth_local_users";
const COLUMN_NAME = "pending_email";
const EMAIL_MAX_LENGTH = 320;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(USERS_TABLE, COLUMN_NAME))) {
    await knex.schema.alterTable(USERS_TABLE, (table) => {
      table.string(COLUMN_NAME, EMAIL_MAX_LENGTH).nullable();
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
