exports.up = async function up(knex) {
  await knex.schema.createTable("billing_events", (table) => {
    table.bigIncrements("id").primary();
    table.string("event_type", 64).notNullable();
    table.string("event_name", 120).nullable();
    table.bigInteger("billable_entity_id").unsigned().nullable();
    table.bigInteger("workspace_id").unsigned().nullable();
    table.bigInteger("user_id").unsigned().nullable();
    table.bigInteger("billing_customer_id").unsigned().nullable();
    table.string("provider", 32).nullable();
    table.string("provider_event_id", 191).nullable();
    table.string("operation_key", 64).nullable();
    table.string("status", 64).nullable();
    table.bigInteger("from_plan_id").unsigned().nullable();
    table.bigInteger("to_plan_id").unsigned().nullable();
    table.bigInteger("schedule_id").unsigned().nullable();
    table.dateTime("effective_at", { precision: 3 }).nullable();
    table.dateTime("provider_created_at", { precision: 3 }).nullable();
    table.dateTime("received_at", { precision: 3 }).nullable();
    table.dateTime("processing_started_at", { precision: 3 }).nullable();
    table.dateTime("processed_at", { precision: 3 }).nullable();
    table.dateTime("last_failed_at", { precision: 3 }).nullable();
    table.integer("attempt_count").unsigned().notNullable().defaultTo(0);
    table.json("payload_json").nullable();
    table.json("metadata_json").nullable();
    table.dateTime("payload_retention_until", { precision: 3 }).nullable();
    table.text("error_text").nullable();
    table.dateTime("occurred_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.index(["event_type", "occurred_at"], "idx_billing_events_type_occurred");
    table.index(["billable_entity_id", "occurred_at"], "idx_billing_events_entity_occurred");
    table.index(["workspace_id", "occurred_at"], "idx_billing_events_workspace_occurred");
    table.index(["user_id", "occurred_at"], "idx_billing_events_user_occurred");
    table.index(["provider", "provider_event_id"], "idx_billing_events_provider_event");
    table.index(["operation_key", "occurred_at"], "idx_billing_events_operation_occurred");
    table.index(["event_type", "status", "updated_at"], "idx_billing_events_type_status_updated");
    table.index(["event_type", "payload_retention_until"], "idx_billing_events_type_retention");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("SET NULL");
    table.foreign("user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.foreign("billing_customer_id").references("id").inTable("billing_customers").onDelete("SET NULL");
    table.foreign("from_plan_id").references("id").inTable("billing_plans").onDelete("SET NULL");
    table.foreign("to_plan_id").references("id").inTable("billing_plans").onDelete("SET NULL");
    table.foreign("schedule_id").references("id").inTable("billing_plan_change_schedules").onDelete("SET NULL");
  });

  await knex.raw(`
    ALTER TABLE billing_events
    ADD COLUMN webhook_dedupe_key VARCHAR(256)
      GENERATED ALWAYS AS (
        CASE
          WHEN event_type = 'webhook' AND provider IS NOT NULL AND provider_event_id IS NOT NULL
          THEN CONCAT(provider, ':', provider_event_id)
          ELSE NULL
        END
      ) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_events
    ADD UNIQUE INDEX uq_billing_events_webhook_dedupe (webhook_dedupe_key)
  `);

  const hasWebhookEvents = await knex.schema.hasTable("billing_webhook_events");
  if (hasWebhookEvents) {
    await knex.raw(`
      INSERT INTO billing_events (
        event_type,
        event_name,
        billable_entity_id,
        workspace_id,
        provider,
        provider_event_id,
        operation_key,
        status,
        provider_created_at,
        received_at,
        processing_started_at,
        processed_at,
        last_failed_at,
        attempt_count,
        payload_json,
        payload_retention_until,
        error_text,
        occurred_at,
        created_at,
        updated_at
      )
      SELECT
        'webhook',
        bwe.event_type,
        bwe.billable_entity_id,
        be.workspace_id,
        bwe.provider,
        bwe.provider_event_id,
        bwe.operation_key,
        bwe.status,
        bwe.provider_created_at,
        bwe.received_at,
        bwe.processing_started_at,
        bwe.processed_at,
        bwe.last_failed_at,
        bwe.attempt_count,
        bwe.payload_json,
        bwe.payload_retention_until,
        bwe.error_text,
        COALESCE(bwe.provider_created_at, bwe.received_at, bwe.updated_at, bwe.created_at),
        bwe.created_at,
        bwe.updated_at
      FROM billing_webhook_events bwe
      LEFT JOIN billable_entities be ON be.id = bwe.billable_entity_id
    `);

    await knex.schema.dropTableIfExists("billing_webhook_events");
  }

  const hasPaymentMethodSyncEvents = await knex.schema.hasTable("billing_payment_method_sync_events");
  if (hasPaymentMethodSyncEvents) {
    await knex.raw(`
      INSERT INTO billing_events (
        event_type,
        event_name,
        billable_entity_id,
        workspace_id,
        billing_customer_id,
        provider,
        provider_event_id,
        operation_key,
        status,
        processed_at,
        payload_json,
        error_text,
        occurred_at,
        created_at,
        updated_at
      )
      SELECT
        'payment_method_sync',
        bpmse.event_type,
        bpmse.billable_entity_id,
        be.workspace_id,
        bpmse.billing_customer_id,
        bpmse.provider,
        bpmse.provider_event_id,
        JSON_UNQUOTE(JSON_EXTRACT(bpmse.payload_json, '$.operation_key')),
        bpmse.status,
        bpmse.processed_at,
        bpmse.payload_json,
        bpmse.error_text,
        COALESCE(bpmse.processed_at, bpmse.updated_at, bpmse.created_at),
        bpmse.created_at,
        bpmse.updated_at
      FROM billing_payment_method_sync_events bpmse
      LEFT JOIN billable_entities be ON be.id = bpmse.billable_entity_id
    `);

    await knex.schema.dropTableIfExists("billing_payment_method_sync_events");
  }

  const hasPlanChangeHistory = await knex.schema.hasTable("billing_plan_change_history");
  if (hasPlanChangeHistory) {
    await knex.raw(`
      INSERT INTO billing_events (
        event_type,
        event_name,
        billable_entity_id,
        workspace_id,
        user_id,
        from_plan_id,
        to_plan_id,
        schedule_id,
        effective_at,
        payload_json,
        metadata_json,
        status,
        occurred_at,
        created_at,
        updated_at
      )
      SELECT
        'plan_change',
        bph.change_kind,
        bph.billable_entity_id,
        be.workspace_id,
        bph.applied_by_user_id,
        bph.from_plan_id,
        bph.to_plan_id,
        bph.schedule_id,
        bph.effective_at,
        bph.metadata_json,
        bph.metadata_json,
        'applied',
        COALESCE(bph.effective_at, bph.updated_at, bph.created_at),
        bph.created_at,
        bph.updated_at
      FROM billing_plan_change_history bph
      LEFT JOIN billable_entities be ON be.id = bph.billable_entity_id
    `);

    await knex.schema.dropTableIfExists("billing_plan_change_history");
  }
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222154000_unify_billing_event_tables is irreversible.");
};
