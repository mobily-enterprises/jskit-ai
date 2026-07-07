/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable("users");
  if (!hasUsersTable) {
    return;
  }

  const hasUpdatedAt = await knex.schema.hasColumn("users", "updated_at");
  if (hasUpdatedAt) {
    return;
  }

  await knex.schema.alterTable("users", (table) => {
    table.timestamp("updated_at", { useTz: false }).nullable();
  });

  const hasCreatedAt = await knex.schema.hasColumn("users", "created_at");
  await knex("users").whereNull("updated_at").update({
    updated_at: hasCreatedAt
      ? knex.raw("COALESCE(??, CURRENT_TIMESTAMP)", ["created_at"])
      : knex.raw("CURRENT_TIMESTAMP")
  });

  await knex.schema.alterTable("users", (table) => {
    table.timestamp("updated_at", { useTz: false }).notNullable().defaultTo(knex.fn.now()).alter();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasUsersTable = await knex.schema.hasTable("users");
  if (!hasUsersTable) {
    return;
  }

  const hasUpdatedAt = await knex.schema.hasColumn("users", "updated_at");
  if (!hasUpdatedAt) {
    return;
  }

  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("updated_at");
  });
};
