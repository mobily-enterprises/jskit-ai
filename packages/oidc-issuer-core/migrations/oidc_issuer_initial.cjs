const ACCOUNTS = "oidc_issuer_accounts";
const MODELS = "oidc_issuer_models";
const CLIENTS = "oidc_issuer_clients";
const SIGNING_KEYS = "oidc_issuer_signing_keys";
const EMAIL_TOKENS = "oidc_issuer_email_tokens";
const RATE_LIMITS = "oidc_issuer_rate_limits";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(ACCOUNTS))) {
    await knex.schema.createTable(ACCOUNTS, (table) => {
      table.string("id", 80).primary();
      table.string("email", 320).notNullable();
      table.boolean("email_verified").notNullable().defaultTo(false);
      table.string("display_name", 160).notNullable();
      table.string("password_algorithm", 64).nullable();
      table.string("password_version", 32).nullable();
      table.string("password_salt", 256).nullable();
      table.string("password_hash", 512).nullable();
      table.string("google_sub", 255).nullable();
      table.boolean("disabled").notNullable().defaultTo(false);
      table.integer("failed_logins").notNullable().defaultTo(0);
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.unique(["email"], "uq_oidc_issuer_accounts_email");
      table.unique(["google_sub"], "uq_oidc_issuer_accounts_google_sub");
    });
  }

  if (!(await knex.schema.hasTable(MODELS))) {
    await knex.schema.createTable(MODELS, (table) => {
      table.string("id", 255).notNullable();
      table.string("kind", 64).notNullable();
      table.text("payload", "mediumtext").notNullable();
      table.string("grant_id", 255).nullable();
      table.string("user_code", 255).nullable();
      table.string("uid", 255).nullable();
      table.string("account_id", 80).nullable();
      table.timestamp("expires_at").nullable();
      table.timestamp("consumed_at").nullable();
      table.primary(["kind", "id"], "pk_oidc_issuer_models");
      table.index(["grant_id"], "idx_oidc_issuer_models_grant");
      table.index(["uid"], "idx_oidc_issuer_models_uid");
      table.index(["user_code"], "idx_oidc_issuer_models_user_code");
      table.index(["account_id"], "idx_oidc_issuer_models_account");
      table.index(["expires_at"], "idx_oidc_issuer_models_expires");
    });
  }

  if (!(await knex.schema.hasTable(CLIENTS))) {
    await knex.schema.createTable(CLIENTS, (table) => {
      table.string("client_id", 255).primary();
      table.string("origin", 512).notNullable();
      table.string("client_name", 80).notNullable();
      table.string("status", 16).notNullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("approved_at").nullable();
      table.string("approved_by", 80).nullable();
      table.timestamp("last_used_at").nullable();
      table.index(["origin"], "idx_oidc_issuer_clients_origin");
      table.index(["status"], "idx_oidc_issuer_clients_status");
    });
  }

  if (!(await knex.schema.hasTable(SIGNING_KEYS))) {
    await knex.schema.createTable(SIGNING_KEYS, (table) => {
      table.string("kid", 80).primary();
      table.string("alg", 16).notNullable();
      table.text("private_jwk_encrypted").notNullable();
      table.string("state", 16).notNullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("retire_after").nullable();
    });
  }

  if (!(await knex.schema.hasTable(EMAIL_TOKENS))) {
    await knex.schema.createTable(EMAIL_TOKENS, (table) => {
      table.string("token_hash", 128).primary();
      table.string("account_id", 80).notNullable();
      table.string("purpose", 32).notNullable();
      table.text("payload").nullable();
      table.timestamp("expires_at").notNullable();
      table.timestamp("used_at").nullable();
      table.timestamp("created_at").notNullable();
      table.index(["account_id"], "idx_oidc_issuer_email_tokens_account");
      table.foreign(["account_id"], "fk_oidc_issuer_email_tokens_account")
        .references(["id"]).inTable(ACCOUNTS).onUpdate("RESTRICT").onDelete("CASCADE");
    });
  }

  if (!(await knex.schema.hasTable(RATE_LIMITS))) {
    await knex.schema.createTable(RATE_LIMITS, (table) => {
      table.string("bucket", 255).primary();
      table.integer("hits").notNullable();
      table.timestamp("window_ends_at").notNullable();
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(RATE_LIMITS);
  await knex.schema.dropTableIfExists(EMAIL_TOKENS);
  await knex.schema.dropTableIfExists(SIGNING_KEYS);
  await knex.schema.dropTableIfExists(CLIENTS);
  await knex.schema.dropTableIfExists(MODELS);
  await knex.schema.dropTableIfExists(ACCOUNTS);
};
