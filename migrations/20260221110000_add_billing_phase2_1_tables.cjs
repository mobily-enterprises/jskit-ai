const PAYMENT_METHOD_STATUSES = ["active", "detached", "expired", "disabled"];
const PAYMENT_METHOD_SYNC_EVENT_STATUSES = ["succeeded", "failed", "skipped"];

exports.up = async function up(knex) {
  await knex.schema.createTable("billing_payment_methods", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("billing_customer_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_payment_method_id", 191).notNullable();
    table.string("type", 64).notNullable();
    table.string("brand", 64).nullable();
    table.string("last4", 4).nullable();
    table.integer("exp_month").unsigned().nullable();
    table.integer("exp_year").unsigned().nullable();
    table.boolean("is_default").notNullable().defaultTo(false);
    table.enu("status", PAYMENT_METHOD_STATUSES).notNullable().defaultTo("active");
    table.dateTime("last_provider_synced_at", { precision: 3 }).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_payment_method_id"], "uq_billing_payment_methods_provider_payment_method");
    table.index(["billable_entity_id", "status"], "idx_billing_payment_methods_entity_status");
    table.index(["billable_entity_id", "is_default"], "idx_billing_payment_methods_entity_default");
    table.index(["billing_customer_id", "provider"], "idx_billing_payment_methods_customer_provider");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign(["billing_customer_id", "billable_entity_id", "provider"])
      .references(["id", "billable_entity_id", "provider"])
      .inTable("billing_customers")
      .onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_payment_method_sync_events", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("billing_customer_id").unsigned().nullable();
    table.string("provider", 32).notNullable();
    table.string("event_type", 64).notNullable().defaultTo("manual_sync");
    table.string("provider_event_id", 191).nullable();
    table.enu("status", PAYMENT_METHOD_SYNC_EVENT_STATUSES).notNullable();
    table.text("error_text").nullable();
    table.json("payload_json").nullable();
    table.dateTime("processed_at", { precision: 3 }).nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.index(["billable_entity_id", "created_at"], "idx_billing_payment_method_sync_events_entity_created");
    table.index(["provider", "status", "created_at"], "idx_billing_payment_method_sync_events_provider_status_created");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("billing_customer_id").references("id").inTable("billing_customers").onDelete("SET NULL");
  });

  await knex.schema.createTable("billing_usage_counters", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.string("entitlement_code", 120).notNullable();
    table.dateTime("window_start_at", { precision: 3 }).notNullable();
    table.dateTime("window_end_at", { precision: 3 }).notNullable();
    table.bigInteger("usage_count").unsigned().notNullable().defaultTo(0);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["billable_entity_id", "entitlement_code", "window_start_at", "window_end_at"],
      "uq_billing_usage_counters_entity_code_window"
    );
    table.index(["billable_entity_id", "entitlement_code"], "idx_billing_usage_counters_entity_code");
    table.index(["window_end_at"], "idx_billing_usage_counters_window_end");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("billing_usage_counters");
  await knex.schema.dropTableIfExists("billing_payment_method_sync_events");
  await knex.schema.dropTableIfExists("billing_payment_methods");
};
