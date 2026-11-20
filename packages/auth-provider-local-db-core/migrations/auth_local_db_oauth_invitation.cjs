// The invitation a provider sign-in started from, kept with its attempt until the sign-in ends; null for one started
// without an invitation.
const OAUTH_ATTEMPTS_TABLE = "auth_local_oauth_attempts";
const COLUMN_NAME = "invitation_token";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(OAUTH_ATTEMPTS_TABLE, COLUMN_NAME))) {
    await knex.schema.alterTable(OAUTH_ATTEMPTS_TABLE, (table) => {
      table.text(COLUMN_NAME).nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn(OAUTH_ATTEMPTS_TABLE, COLUMN_NAME)) {
    await knex.schema.alterTable(OAUTH_ATTEMPTS_TABLE, (table) => {
      table.dropColumn(COLUMN_NAME);
    });
  }
};
