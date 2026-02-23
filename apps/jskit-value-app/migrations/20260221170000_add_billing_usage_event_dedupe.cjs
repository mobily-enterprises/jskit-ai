exports.up = async function up(knex) {
  await knex.schema.createTable("billing_usage_events", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.string("entitlement_code", 120).notNullable();
    table.string("usage_event_key", 191).notNullable();
    table.dateTime("window_start_at", { precision: 3 }).notNullable();
    table.dateTime("window_end_at", { precision: 3 }).notNullable();
    table.bigInteger("amount").unsigned().notNullable().defaultTo(1);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["billable_entity_id", "entitlement_code", "usage_event_key", "window_start_at", "window_end_at"],
      "uq_billing_usage_events_entity_code_key_window"
    );
    table.index(["billable_entity_id", "entitlement_code", "created_at"], "idx_billing_usage_events_entity_code_created");
    table.index(["window_end_at"], "idx_billing_usage_events_window_end");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("billing_usage_events");
};
