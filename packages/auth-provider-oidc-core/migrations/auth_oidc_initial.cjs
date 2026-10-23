const CLIENTS_TABLE = "auth_oidc_clients";
const SESSIONS_TABLE = "auth_oidc_sessions";
const LOGOUT_TOKENS_TABLE = "auth_oidc_logout_tokens";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(CLIENTS_TABLE))) {
    await knex.schema.createTable(CLIENTS_TABLE, (table) => {
      table.increments("id").primary();
      table.string("issuer", 255).notNullable();
      table.string("origin", 255).notNullable();
      table.string("client_id", 255).notNullable();
      table.text("client_secret").nullable();
      table.text("registration_access_token").nullable();
      table.string("registration_client_uri", 1024).nullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.unique(["issuer", "origin"], "uq_auth_oidc_clients_issuer_origin");
    });
  }

  if (!(await knex.schema.hasTable(SESSIONS_TABLE))) {
    await knex.schema.createTable(SESSIONS_TABLE, (table) => {
      table.string("id", 80).primary();
      table.string("token_hash", 128).notNullable();
      table.string("issuer", 255).notNullable();
      table.string("client_id", 255).nullable();
      table.string("sub", 255).notNullable();
      table.string("sid", 255).nullable();
      table.string("email", 320).notNullable();
      table.string("display_name", 160).notNullable();
      table.text("id_token").nullable();
      table.string("purpose", 32).notNullable();
      table.timestamp("expires_at").notNullable();
      table.timestamp("revoked_at").nullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.unique(["token_hash"], "uq_auth_oidc_sessions_token_hash");
      table.index(["issuer", "sub"], "idx_auth_oidc_sessions_subject");
      table.index(["issuer", "sid"], "idx_auth_oidc_sessions_sid");
      table.index(["expires_at"], "idx_auth_oidc_sessions_expires");
    });
  }

  if (!(await knex.schema.hasTable(LOGOUT_TOKENS_TABLE))) {
    await knex.schema.createTable(LOGOUT_TOKENS_TABLE, (table) => {
      table.string("issuer", 255).notNullable();
      table.string("jti", 255).notNullable();
      table.timestamp("expires_at").notNullable();
      table.primary(["issuer", "jti"]);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(LOGOUT_TOKENS_TABLE);
  await knex.schema.dropTableIfExists(SESSIONS_TABLE);
  await knex.schema.dropTableIfExists(CLIENTS_TABLE);
};
