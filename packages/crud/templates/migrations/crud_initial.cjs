// JSKIT_MIGRATION_ID: crud_initial_${option:namespace}

const RAW_NAMESPACE = "${option:namespace}";

function resolveTableName() {
  const normalizedNamespace = String(RAW_NAMESPACE || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalizedNamespace) {
    throw new Error("crud_initial migration requires option:namespace.");
  }

  return "crud_" + normalizedNamespace.replace(/-/g, "_");
}

const TABLE_NAME = resolveTableName();

exports.up = async function up(knex) {
  const hasCrudTable = await knex.schema.hasTable(TABLE_NAME);
  if (hasCrudTable) {
    return;
  }

  await knex.schema.createTable(TABLE_NAME, (table) => {
    table.increments("id").unsigned().primary();
    table.integer("workspace_owner_id").unsigned().nullable().index();
    table.integer("user_owner_id").unsigned().nullable().index();
    table.string("text_field", 160).notNullable();
    table.timestamp("date_field").notNullable();
    table.double("number_field").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
