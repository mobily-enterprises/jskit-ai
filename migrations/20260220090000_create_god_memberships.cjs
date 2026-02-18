exports.up = async function up(knex) {
  await knex.schema.createTable("god_memberships", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("role_id", 64).notNullable();
    table.enu("status", ["active", "suspended"]).notNullable().defaultTo("active");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    table.unique(["user_id"], "uq_god_memberships_user");
    table.index(["status"], "idx_god_memberships_status");
    table.index(["role_id", "status"], "idx_god_memberships_role_status");
  });

  await knex.raw(`
    ALTER TABLE god_memberships
    ADD COLUMN active_god_singleton TINYINT
      GENERATED ALWAYS AS (CASE WHEN status = 'active' AND role_id = 'god' THEN 1 ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE god_memberships
    ADD UNIQUE INDEX uq_god_memberships_active_god_singleton (active_god_singleton)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("god_memberships");
};
