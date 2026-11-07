// When an account proved it owns its email address, for example by using an
// emailed sign-in link: set once by auth.local.accounts' markEmailVerified.
const USERS_TABLE = "auth_local_users";
const COLUMN_NAME = "email_verified_at";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn(USERS_TABLE, COLUMN_NAME))) {
    await knex.schema.alterTable(USERS_TABLE, (table) => {
      table.timestamp(COLUMN_NAME).nullable();
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
