const BILLABLE_ENTITY_TYPES = ["workspace", "user", "organization", "external"];

exports.up = async function up(knex) {
  await knex.schema.alterTable("billable_entities", (table) => {
    table.enu("entity_type", BILLABLE_ENTITY_TYPES).notNullable().defaultTo("workspace").after("id");
    table.string("entity_ref", 191).nullable().after("entity_type");
  });

  await knex.raw(`
    ALTER TABLE billable_entities
    MODIFY COLUMN workspace_id BIGINT UNSIGNED NULL
  `);

  await knex.raw(`
    ALTER TABLE billable_entities
    MODIFY COLUMN owner_user_id BIGINT UNSIGNED NULL
  `);

  await knex.schema.alterTable("billable_entities", (table) => {
    table.unique(["entity_type", "entity_ref"], "uq_billable_entities_type_ref");
    table.index(["entity_type", "status"], "idx_billable_entities_type_status");
  });
};

exports.down = async function down(knex) {
  await knex("billable_entities")
    .whereNot({ entity_type: "workspace" })
    .delete();

  await knex("billable_entities")
    .whereNull("workspace_id")
    .orWhereNull("owner_user_id")
    .delete();

  await knex.schema.alterTable("billable_entities", (table) => {
    table.dropUnique(["entity_type", "entity_ref"], "uq_billable_entities_type_ref");
    table.dropIndex(["entity_type", "status"], "idx_billable_entities_type_status");
  });

  await knex.raw(`
    ALTER TABLE billable_entities
    MODIFY COLUMN workspace_id BIGINT UNSIGNED NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE billable_entities
    MODIFY COLUMN owner_user_id BIGINT UNSIGNED NOT NULL
  `);

  await knex.schema.alterTable("billable_entities", (table) => {
    table.dropColumn("entity_ref");
    table.dropColumn("entity_type");
  });
};
