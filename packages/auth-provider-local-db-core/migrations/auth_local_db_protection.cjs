const SIGN_IN_FAILURES_TABLE = "auth_local_sign_in_failures";

exports.up = async function up(knex) {
  // An account email's recent failed sign-ins, kept whether or not the account
  // exists; a successful sign-in or a password reset deletes it, and it is
  // forgotten a day after its last failure.
  if (!(await knex.schema.hasTable(SIGN_IN_FAILURES_TABLE))) {
    await knex.schema.createTable(SIGN_IN_FAILURES_TABLE, (table) => {
      table.string("email", 320).primary();
      table.integer("failures").unsigned().notNullable();
      table.timestamp("last_failed_at").notNullable();
      table.timestamp("locked_until").nullable();
      table.index(["last_failed_at"], "idx_auth_local_sign_in_failures_last");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(SIGN_IN_FAILURES_TABLE);
};
