const USERS_TABLE = "auth_local_users";
const IDENTITIES_TABLE = "auth_local_identities";
const OAUTH_ATTEMPTS_TABLE = "auth_local_oauth_attempts";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(IDENTITIES_TABLE))) {
    await knex.schema.createTable(IDENTITIES_TABLE, (table) => {
      table.string("user_id", 80).notNullable();
      table.string("provider", 32).notNullable();
      table.string("provider_subject", 255).notNullable();
      table.string("email", 320).notNullable();
      table.timestamp("created_at").notNullable();
      table.primary(["provider", "provider_subject"], "pk_auth_local_identities");
      table.index(["user_id"], "idx_auth_local_identities_user");
      table.foreign(["user_id"], "fk_auth_local_identities_user").references(["id"]).inTable(USERS_TABLE).onUpdate("RESTRICT").onDelete("CASCADE");
    });
  }

  // One pending provider sign-in or link, keyed by the hash of the starting
  // browser's cookie; it is deleted when used and expires after ten minutes.
  if (!(await knex.schema.hasTable(OAUTH_ATTEMPTS_TABLE))) {
    await knex.schema.createTable(OAUTH_ATTEMPTS_TABLE, (table) => {
      table.string("browser_key_hash", 128).primary();
      table.string("provider", 32).notNullable();
      table.string("intent", 16).notNullable();
      table.string("user_id", 80).nullable();
      table.string("state", 128).notNullable();
      table.string("nonce", 128).notNullable();
      table.string("code_verifier", 128).notNullable();
      table.text("return_to").notNullable();
      table.timestamp("expires_at").notNullable();
      table.timestamp("created_at").notNullable();
      table.index(["expires_at"], "idx_auth_local_oauth_attempts_expires");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(OAUTH_ATTEMPTS_TABLE);
  await knex.schema.dropTableIfExists(IDENTITIES_TABLE);
};
