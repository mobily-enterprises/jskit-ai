const USED_PASSES_TABLE = "auth_local_used_passes";

exports.up = async function up(knex) {
  // A one-time sign-in pass that signed someone in, or was refused after its
  // first use was recorded: the hash of the pass's id, kept until the pass
  // could no longer be used anyway, so every server sharing the database
  // refuses it again.
  if (!(await knex.schema.hasTable(USED_PASSES_TABLE))) {
    await knex.schema.createTable(USED_PASSES_TABLE, (table) => {
      table.string("id", 64).primary();
      table.timestamp("expires_at").notNullable();
      table.timestamp("created_at").notNullable();
      table.index(["expires_at"], "idx_auth_local_used_passes_expires");
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(USED_PASSES_TABLE);
};
