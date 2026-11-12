const USERS_TABLE = "auth_local_users";
const SESSIONS_TABLE = "auth_local_sessions";
const SECOND_FACTORS_TABLE = "auth_local_second_factors";
const SESSION_SECOND_FACTOR_COLUMN = "second_factor_at";

exports.up = async function up(knex) {
  // An account's second factor: its authenticator secret, sealed with the
  // application's key; when its first code confirmed it (null while it is
  // being set up); the 30-second step of the last code accepted; the keyed
  // hashes of its unused recovery codes, comma-separated; and its wrong codes,
  // counted as failed sign-ins are. Deleting the account deletes it.
  if (!(await knex.schema.hasTable(SECOND_FACTORS_TABLE))) {
    await knex.schema.createTable(SECOND_FACTORS_TABLE, (table) => {
      table.string("user_id", 80).primary();
      table.string("secret_sealed", 255).notNullable();
      table.timestamp("confirmed_at").nullable();
      table.integer("last_used_step").unsigned().notNullable();
      table.string("recovery_code_hashes", 1024).notNullable();
      table.integer("failures").unsigned().notNullable();
      table.timestamp("last_failed_at").nullable();
      table.timestamp("locked_until").nullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.foreign(["user_id"], "fk_auth_local_second_factors_user").references(["id"]).inTable(USERS_TABLE).onUpdate("RESTRICT").onDelete("CASCADE");
    });
  }

  // When a session last proved its account's second factor; null when it has not.
  if (!(await knex.schema.hasColumn(SESSIONS_TABLE, SESSION_SECOND_FACTOR_COLUMN))) {
    await knex.schema.alterTable(SESSIONS_TABLE, (table) => {
      table.timestamp(SESSION_SECOND_FACTOR_COLUMN).nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn(SESSIONS_TABLE, SESSION_SECOND_FACTOR_COLUMN)) {
    await knex.schema.alterTable(SESSIONS_TABLE, (table) => {
      table.dropColumn(SESSION_SECOND_FACTOR_COLUMN);
    });
  }
  await knex.schema.dropTableIfExists(SECOND_FACTORS_TABLE);
};
