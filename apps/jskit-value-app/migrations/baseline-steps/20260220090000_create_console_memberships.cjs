exports.up = async function up(knex) {
  await knex.schema.createTable("console_memberships", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("user_id").unsigned().notNullable();
    table.string("role_id", 64).notNullable();
    table.enu("status", ["active", "suspended"]).notNullable().defaultTo("active");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("CASCADE");
    table.unique(["user_id"], "uq_console_memberships_user");
    table.index(["status"], "idx_console_memberships_status");
    table.index(["role_id", "status"], "idx_console_memberships_role_status");
  });

  await knex.raw(`
    ALTER TABLE console_memberships
    ADD COLUMN active_console_singleton TINYINT
      GENERATED ALWAYS AS (CASE WHEN status = 'active' AND role_id = 'console' THEN 1 ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE console_memberships
    ADD UNIQUE INDEX uq_console_memberships_active_console_singleton (active_console_singleton)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("console_memberships");
};
