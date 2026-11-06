const SIGN_IN_FAILURES_TABLE = "auth_local_sign_in_failures";
const REGISTRATIONS_TABLE = "auth_local_registrations";

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

  // A registration waiting for its email to be confirmed: the account it will
  // create and the hash of its link's code. Confirming deletes it.
  if (!(await knex.schema.hasTable(REGISTRATIONS_TABLE))) {
    await knex.schema.createTable(REGISTRATIONS_TABLE, (table) => {
      table.string("email", 320).primary();
      table.string("display_name", 160).notNullable();
      table.string("password_algorithm", 64).notNullable();
      table.string("password_version", 32).notNullable();
      table.string("password_salt", 256).notNullable();
      table.string("password_hash", 512).notNullable();
      table.string("invitation_token", 2048).nullable();
      table.string("invitation_source", 120).nullable();
      table.string("token_hash", 128).notNullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("expires_at").notNullable();
      table.unique(["token_hash"], "uq_auth_local_registrations_token_hash");
      table.index(["expires_at"], "idx_auth_local_registrations_expires");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(REGISTRATIONS_TABLE);
  await knex.schema.dropTableIfExists(SIGN_IN_FAILURES_TABLE);
};
