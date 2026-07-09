const USERS_TABLE = "auth_local_users";
const SESSIONS_TABLE = "auth_local_sessions";
const RECOVERY_TABLE = "auth_local_recovery";

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(USERS_TABLE))) {
    await knex.schema.createTable(USERS_TABLE, (table) => {
      table.string("id", 80).primary();
      table.string("email", 320).notNullable();
      table.string("display_name", 160).notNullable();
      table.string("password_algorithm", 64).notNullable();
      table.string("password_version", 32).notNullable();
      table.string("password_salt", 256).notNullable();
      table.string("password_hash", 512).notNullable();
      table.boolean("disabled").notNullable().defaultTo(false);
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.unique(["email"], "uq_auth_local_users_email");
    });
  }

  if (!(await knex.schema.hasTable(SESSIONS_TABLE))) {
    await knex.schema.createTable(SESSIONS_TABLE, (table) => {
      table.string("id", 80).primary();
      table.string("user_id", 80).notNullable();
      table.string("token_hash", 128).notNullable();
      table.string("purpose", 32).notNullable();
      table.timestamp("expires_at").notNullable();
      table.timestamp("revoked_at").nullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.unique(["token_hash"], "uq_auth_local_sessions_token_hash");
      table.index(["user_id"], "idx_auth_local_sessions_user");
      table.index(["expires_at"], "idx_auth_local_sessions_expires");
      table.foreign(["user_id"], "fk_auth_local_sessions_user").references(["id"]).inTable(USERS_TABLE).onUpdate("RESTRICT").onDelete("CASCADE");
    });
  }

  if (!(await knex.schema.hasTable(RECOVERY_TABLE))) {
    await knex.schema.createTable(RECOVERY_TABLE, (table) => {
      table.string("id", 80).primary();
      table.string("user_id", 80).notNullable();
      table.string("token_hash", 128).notNullable();
      table.timestamp("expires_at").notNullable();
      table.timestamp("used_at").nullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("updated_at").notNullable();
      table.unique(["token_hash"], "uq_auth_local_recovery_token_hash");
      table.index(["user_id"], "idx_auth_local_recovery_user");
      table.index(["expires_at"], "idx_auth_local_recovery_expires");
      table.foreign(["user_id"], "fk_auth_local_recovery_user").references(["id"]).inTable(USERS_TABLE).onUpdate("RESTRICT").onDelete("CASCADE");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(RECOVERY_TABLE);
  await knex.schema.dropTableIfExists(SESSIONS_TABLE);
  await knex.schema.dropTableIfExists(USERS_TABLE);
};
