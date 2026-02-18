exports.up = async function up(knex) {
  await knex.schema.createTable("god_invites", (table) => {
    table.bigIncrements("id").primary();
    table.string("email", 320).notNullable();
    table.string("role_id", 64).notNullable();
    table.string("token_hash", 128).notNullable().unique();
    table.bigInteger("invited_by_user_id").unsigned().nullable();
    table.dateTime("expires_at", { precision: 3 }).notNullable();
    table.enu("status", ["pending", "accepted", "revoked", "expired"]).notNullable().defaultTo("pending");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("invited_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.index(["email", "status"], "idx_god_invites_email_status");
    table.index(["expires_at", "status"], "idx_god_invites_expires_status");
  });

  await knex.raw(`
    ALTER TABLE god_invites
    ADD COLUMN pending_email VARCHAR(320)
      GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN email ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE god_invites
    ADD UNIQUE INDEX uq_god_invites_pending_email (pending_email)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("god_invites");
};
