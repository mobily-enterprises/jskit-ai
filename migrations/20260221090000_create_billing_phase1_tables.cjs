const CHECKOUT_SESSION_STATUSES = [
  "open",
  "completed_pending_subscription",
  "recovery_verification_pending",
  "completed_reconciled",
  "expired",
  "abandoned"
];

const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "paused",
  "unpaid",
  "canceled",
  "incomplete_expired"
];

const NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUSES = ["incomplete", "trialing", "active", "past_due", "paused", "unpaid"];

exports.up = async function up(knex) {
  await knex.schema.createTable("billable_entities", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("workspace_id").unsigned().notNullable();
    table.bigInteger("owner_user_id").unsigned().notNullable();
    table.enu("status", ["active", "inactive"]).notNullable().defaultTo("active");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["workspace_id"], "uq_billable_entities_workspace_id");
    table.index(["owner_user_id"], "idx_billable_entities_owner_user_id");

    table.foreign("workspace_id").references("id").inTable("workspaces").onDelete("RESTRICT");
    table.foreign("owner_user_id").references("id").inTable("user_profiles").onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_customers", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_customer_id", 191).notNullable();
    table.string("email", 320).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_customer_id"], "uq_billing_customers_provider_customer");
    table.unique(["billable_entity_id", "provider"], "uq_billing_customers_entity_provider");
    table.unique(["id", "billable_entity_id", "provider"], "uq_billing_customers_id_entity_provider");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_plans", (table) => {
    table.bigIncrements("id").primary();
    table.string("code", 120).notNullable();
    table.string("plan_family_code", 120).notNullable();
    table.integer("version").unsigned().notNullable();
    table.string("name", 160).notNullable();
    table.text("description").nullable();
    table.enu("applies_to", ["workspace"]).notNullable().defaultTo("workspace");
    table.enu("pricing_model", ["flat", "per_seat", "usage", "hybrid"]).notNullable().defaultTo("flat");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["code"], "uq_billing_plans_code");
    table.unique(["plan_family_code", "version"], "uq_billing_plans_family_version");
  });

  await knex.schema.createTable("billing_plan_prices", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("plan_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.enu("billing_component", ["base", "seat", "metered", "add_on"]).notNullable();
    table.enu("usage_type", ["licensed", "metered"]).notNullable();
    table.enu("interval", ["day", "week", "month", "year"]).notNullable();
    table.integer("interval_count").unsigned().notNullable().defaultTo(1);
    table.string("currency", 3).notNullable();
    table.bigInteger("unit_amount_minor").unsigned().notNullable();
    table.string("provider_product_id", 191).nullable();
    table.string("provider_price_id", 191).notNullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_price_id"], "uq_billing_plan_prices_provider_price");
    table.unique(["id", "provider"], "uq_billing_plan_prices_id_provider");
    table.index(["plan_id", "is_active"], "idx_billing_plan_prices_plan_active");
    table.index(["plan_id", "provider"], "idx_billing_plan_prices_plan_provider");

    table.foreign("plan_id").references("id").inTable("billing_plans").onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_plan_prices
    ADD COLUMN phase1_sellable_price_key VARCHAR(255)
      GENERATED ALWAYS AS (
        CASE
          WHEN is_active = 1 AND usage_type = 'licensed' AND billing_component = 'base'
          THEN CONCAT(plan_id, ':', provider)
          ELSE NULL
        END
      ) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_plan_prices
    ADD UNIQUE INDEX uq_billing_plan_prices_phase1_sellable_price_key (phase1_sellable_price_key)
  `);

  await knex.schema.createTable("billing_entitlements", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("plan_id").unsigned().notNullable();
    table.string("code", 120).notNullable();
    table.string("schema_version", 120).notNullable();
    table.json("value_json").notNullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["plan_id", "code"], "uq_billing_entitlements_plan_code");
    table.foreign("plan_id").references("id").inTable("billing_plans").onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_subscriptions", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("plan_id").unsigned().notNullable();
    table.bigInteger("billing_customer_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_subscription_id", 191).notNullable();
    table.enu("status", SUBSCRIPTION_STATUSES).notNullable();
    table.dateTime("provider_subscription_created_at", { precision: 3 }).notNullable();
    table.dateTime("current_period_end", { precision: 3 }).nullable();
    table.dateTime("trial_end", { precision: 3 }).nullable();
    table.dateTime("canceled_at", { precision: 3 }).nullable();
    table.boolean("cancel_at_period_end").notNullable().defaultTo(false);
    table.dateTime("ended_at", { precision: 3 }).nullable();
    table.boolean("is_current").notNullable().defaultTo(false);
    table.dateTime("last_provider_event_created_at", { precision: 3 }).nullable();
    table.string("last_provider_event_id", 191).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_subscription_id"], "uq_billing_subscriptions_provider_subscription");
    table.unique(["id", "provider"], "uq_billing_subscriptions_id_provider");
    table.index(["billable_entity_id", "status"], "idx_billing_subscriptions_entity_status");

    table.foreign(["billing_customer_id", "billable_entity_id", "provider"])
      .references(["id", "billable_entity_id", "provider"])
      .inTable("billing_customers")
      .onDelete("RESTRICT");
    table.foreign("plan_id").references("id").inTable("billing_plans").onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_subscriptions
    ADD COLUMN current_subscription_key BIGINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN billable_entity_id ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_subscriptions
    ADD UNIQUE INDEX uq_billing_subscriptions_current_subscription_key (current_subscription_key)
  `);

  await knex.raw(`
    ALTER TABLE billing_subscriptions
    ADD CONSTRAINT chk_billing_subscriptions_is_current_status
      CHECK (is_current = 0 OR status IN (${NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUSES.map((value) => `'${value}'`).join(", ")}))
  `);

  await knex.schema.createTable("billing_subscription_items", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("subscription_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_subscription_item_id", 191).notNullable();
    table.bigInteger("billing_plan_price_id").unsigned().nullable();
    table.enu("billing_component", ["base", "seat", "metered", "add_on"]).notNullable();
    table.enu("usage_type", ["licensed", "metered"]).notNullable();
    table.integer("quantity").unsigned().nullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.dateTime("last_provider_event_created_at", { precision: 3 }).nullable();
    table.string("last_provider_event_id", 191).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_subscription_item_id"], "uq_billing_subscription_items_provider_item");
    table.index(["subscription_id", "is_active"], "idx_billing_subscription_items_subscription_active");
    table.index(["billing_plan_price_id"], "idx_billing_subscription_items_plan_price_id");

    table.foreign(["subscription_id", "provider"])
      .references(["id", "provider"])
      .inTable("billing_subscriptions")
      .onDelete("RESTRICT");
    table.foreign(["billing_plan_price_id", "provider"])
      .references(["id", "provider"])
      .inTable("billing_plan_prices")
      .onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_invoices", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("subscription_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_invoice_id", 191).notNullable();
    table.string("status", 64).notNullable();
    table.bigInteger("amount_due_minor").unsigned().notNullable().defaultTo(0);
    table.bigInteger("amount_paid_minor").unsigned().notNullable().defaultTo(0);
    table.bigInteger("amount_remaining_minor").unsigned().notNullable().defaultTo(0);
    table.string("currency", 3).notNullable();
    table.dateTime("issued_at", { precision: 3 }).nullable();
    table.dateTime("due_at", { precision: 3 }).nullable();
    table.dateTime("paid_at", { precision: 3 }).nullable();
    table.dateTime("last_provider_event_created_at", { precision: 3 }).nullable();
    table.string("last_provider_event_id", 191).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_invoice_id"], "uq_billing_invoices_provider_invoice");
    table.unique(["id", "provider"], "uq_billing_invoices_id_provider");

    table.foreign(["subscription_id", "provider"])
      .references(["id", "provider"])
      .inTable("billing_subscriptions")
      .onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_payments", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("invoice_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_payment_id", 191).notNullable();
    table.string("type", 64).notNullable();
    table.string("status", 64).notNullable();
    table.bigInteger("amount_minor").unsigned().notNullable();
    table.string("currency", 3).notNullable();
    table.dateTime("paid_at", { precision: 3 }).nullable();
    table.dateTime("last_provider_event_created_at", { precision: 3 }).nullable();
    table.string("last_provider_event_id", 191).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_payment_id"], "uq_billing_payments_provider_payment");

    table.foreign(["invoice_id", "provider"])
      .references(["id", "provider"])
      .inTable("billing_invoices")
      .onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_webhook_events", (table) => {
    table.bigIncrements("id").primary();
    table.string("provider", 32).notNullable();
    table.string("provider_event_id", 191).notNullable();
    table.bigInteger("billable_entity_id").unsigned().nullable();
    table.string("operation_key", 64).nullable();
    table.string("event_type", 120).notNullable();
    table.dateTime("provider_created_at", { precision: 3 }).notNullable();
    table.enu("status", ["received", "processing", "processed", "failed"]).notNullable().defaultTo("received");
    table.dateTime("received_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("processing_started_at", { precision: 3 }).nullable();
    table.dateTime("processed_at", { precision: 3 }).nullable();
    table.dateTime("last_failed_at", { precision: 3 }).nullable();
    table.integer("attempt_count").unsigned().notNullable().defaultTo(0);
    table.json("payload_json").notNullable();
    table.dateTime("payload_retention_until", { precision: 3 }).nullable();
    table.text("error_text").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_event_id"], "uq_billing_webhook_events_provider_event");
    table.index(["billable_entity_id", "updated_at"], "idx_billing_webhook_events_entity_updated");
    table.index(["operation_key", "updated_at"], "idx_billing_webhook_events_operation_updated");
    table.index(["status", "updated_at"], "idx_billing_webhook_events_status_updated");
    table.index(["received_at"], "idx_billing_webhook_events_received_at");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_request_idempotency", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.enu("action", ["checkout", "portal"]).notNullable();
    table.string("client_idempotency_key", 191).notNullable();
    table.string("request_fingerprint_hash", 64).notNullable();
    table.json("normalized_request_json").notNullable();
    table.string("operation_key", 64).notNullable();
    table.json("provider_request_params_json").nullable();
    table.string("provider_request_hash", 64).nullable();
    table.string("provider_request_schema_version", 120).nullable();
    table.string("provider_sdk_name", 64).nullable();
    table.string("provider_sdk_version", 32).nullable();
    table.string("provider_api_version", 32).nullable();
    table.dateTime("provider_request_frozen_at", { precision: 3 }).nullable();
    table.string("provider", 32).notNullable().defaultTo("stripe");
    table.string("provider_idempotency_key", 191).notNullable();
    table.dateTime("provider_idempotency_replay_deadline_at", { precision: 3 }).nullable();
    table.dateTime("provider_checkout_session_expires_at_upper_bound", { precision: 3 }).nullable();
    table.string("provider_session_id", 191).nullable();
    table.json("response_json").nullable();
    table.enu("status", ["pending", "succeeded", "failed", "expired"]).notNullable().defaultTo("pending");
    table.dateTime("pending_lease_expires_at", { precision: 3 }).nullable();
    table.dateTime("pending_last_heartbeat_at", { precision: 3 }).nullable();
    table.string("lease_owner", 120).nullable();
    table.integer("lease_version").unsigned().notNullable().defaultTo(1);
    table.integer("recovery_attempt_count").unsigned().notNullable().defaultTo(0);
    table.dateTime("last_recovery_attempt_at", { precision: 3 }).nullable();
    table.string("failure_code", 96).nullable();
    table.text("failure_reason").nullable();
    table.dateTime("expires_at", { precision: 3 }).nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["billable_entity_id", "action", "client_idempotency_key"],
      "uq_billing_request_idempotency_entity_action_client_key"
    );
    table.unique(["action", "operation_key"], "uq_billing_request_idempotency_action_operation_key");
    table.unique(["provider", "provider_idempotency_key"], "uq_billing_request_idempotency_provider_idempotency_key");
    table.index(["billable_entity_id", "action", "created_at"], "idx_billing_request_idempotency_entity_action_created");
    table.index(["status", "pending_lease_expires_at"], "idx_billing_request_idempotency_status_lease");
    table.index(
      ["provider_idempotency_replay_deadline_at"],
      "idx_billing_request_idempotency_provider_replay_deadline"
    );
    table.index(["expires_at"], "idx_billing_request_idempotency_expires_at");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_request_idempotency
    ADD COLUMN active_checkout_pending_key BIGINT UNSIGNED
      GENERATED ALWAYS AS (
        CASE
          WHEN action = 'checkout' AND status = 'pending'
          THEN billable_entity_id
          ELSE NULL
        END
      ) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_request_idempotency
    ADD UNIQUE INDEX uq_billing_request_idempotency_active_checkout_pending_key (active_checkout_pending_key)
  `);

  await knex.schema.createTable("billing_reconciliation_runs", (table) => {
    table.bigIncrements("id").primary();
    table.string("provider", 32).notNullable();
    table.string("scope", 64).notNullable();
    table.enu("status", ["running", "succeeded", "failed"]).notNullable().defaultTo("running");
    table.string("runner_id", 120).nullable();
    table.dateTime("lease_expires_at", { precision: 3 }).nullable();
    table.integer("lease_version").unsigned().notNullable().defaultTo(1);
    table.dateTime("started_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("finished_at", { precision: 3 }).nullable();
    table.json("cursor_json").nullable();
    table.json("summary_json").nullable();
    table.integer("scanned_count").unsigned().notNullable().defaultTo(0);
    table.integer("drift_detected_count").unsigned().notNullable().defaultTo(0);
    table.integer("repaired_count").unsigned().notNullable().defaultTo(0);
    table.text("error_text").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.index(["provider", "started_at"], "idx_billing_reconciliation_runs_provider_started");
    table.index(["status", "updated_at"], "idx_billing_reconciliation_runs_status_updated");
  });

  await knex.raw(`
    ALTER TABLE billing_reconciliation_runs
    ADD COLUMN active_run_key VARCHAR(160)
      GENERATED ALWAYS AS (
        CASE
          WHEN status = 'running'
          THEN CONCAT(provider, ':', scope)
          ELSE NULL
        END
      ) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_reconciliation_runs
    ADD UNIQUE INDEX uq_billing_reconciliation_runs_active_run_key (active_run_key)
  `);

  await knex.schema.createTable("billing_subscription_remediations", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("operation_key", 64).nullable();
    table.string("provider_event_id", 191).nullable();
    table.string("canonical_provider_subscription_id", 191).notNullable();
    table.bigInteger("canonical_subscription_id").unsigned().nullable();
    table.string("duplicate_provider_subscription_id", 191).notNullable();
    table.enu("action", ["cancel_duplicate_subscription"]).notNullable().defaultTo("cancel_duplicate_subscription");
    table.enu("status", ["pending", "in_progress", "succeeded", "failed", "dead_letter"]).notNullable().defaultTo("pending");
    table.string("selection_algorithm_version", 64).notNullable();
    table.integer("attempt_count").unsigned().notNullable().defaultTo(0);
    table.dateTime("next_attempt_at", { precision: 3 }).nullable();
    table.dateTime("last_attempt_at", { precision: 3 }).nullable();
    table.dateTime("resolved_at", { precision: 3 }).nullable();
    table.string("lease_owner", 120).nullable();
    table.dateTime("lease_expires_at", { precision: 3 }).nullable();
    table.integer("lease_version").unsigned().notNullable().defaultTo(1);
    table.text("error_text").nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["provider", "duplicate_provider_subscription_id", "action"],
      "uq_billing_subscription_remediations_provider_duplicate_action"
    );
    table.index(["billable_entity_id", "status", "updated_at"], "idx_billing_subscription_remediations_entity_status_updated");
    table.index(
      ["billable_entity_id", "provider_event_id"],
      "idx_billing_subscription_remediations_entity_provider_event"
    );
    table.index(["status", "next_attempt_at"], "idx_billing_subscription_remediations_status_next_attempt");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("canonical_subscription_id").references("id").inTable("billing_subscriptions").onDelete("SET NULL");
  });

  await knex.raw(`
    ALTER TABLE billing_subscription_remediations
    ADD CONSTRAINT chk_billing_subscription_remediations_distinct_provider_subscriptions
      CHECK (canonical_provider_subscription_id <> duplicate_provider_subscription_id)
  `);

  await knex.schema.createTable("billing_outbox_jobs", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().nullable();
    table.string("operation_key", 64).nullable();
    table.string("provider_event_id", 191).nullable();
    table.string("job_type", 96).notNullable();
    table.string("dedupe_key", 191).notNullable();
    table.json("payload_json").notNullable();
    table.enu("status", ["pending", "leased", "succeeded", "failed", "dead_letter"]).notNullable().defaultTo("pending");
    table.dateTime("available_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.integer("attempt_count").unsigned().notNullable().defaultTo(0);
    table.string("lease_owner", 120).nullable();
    table.dateTime("lease_expires_at", { precision: 3 }).nullable();
    table.integer("lease_version").unsigned().notNullable().defaultTo(1);
    table.text("last_error_text").nullable();
    table.dateTime("finished_at", { precision: 3 }).nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["job_type", "dedupe_key"], "uq_billing_outbox_jobs_type_dedupe");
    table.index(["billable_entity_id", "status", "updated_at"], "idx_billing_outbox_jobs_entity_status_updated");
    table.index(["status", "available_at"], "idx_billing_outbox_jobs_status_available_at");
    table.index(["job_type", "status", "updated_at"], "idx_billing_outbox_jobs_type_status_updated");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_checkout_sessions", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.string("provider", 32).notNullable();
    table.string("provider_checkout_session_id", 191).nullable();
    table.bigInteger("idempotency_row_id").unsigned().nullable();
    table.string("operation_key", 64).notNullable();
    table.string("provider_customer_id", 191).nullable();
    table.string("provider_subscription_id", 191).nullable();
    table.enu("status", CHECKOUT_SESSION_STATUSES).notNullable();
    table.text("checkout_url").nullable();
    table.dateTime("expires_at", { precision: 3 }).nullable();
    table.dateTime("completed_at", { precision: 3 }).nullable();
    table.dateTime("last_provider_event_created_at", { precision: 3 }).nullable();
    table.string("last_provider_event_id", 191).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["provider", "provider_checkout_session_id"], "uq_billing_checkout_sessions_provider_session");
    table.unique(["provider", "operation_key"], "uq_billing_checkout_sessions_provider_operation_key");
    table.unique(["idempotency_row_id"], "uq_billing_checkout_sessions_idempotency_row_id");
    table.unique(["provider", "provider_subscription_id"], "uq_billing_checkout_sessions_provider_subscription");
    table.index(["billable_entity_id", "status"], "idx_billing_checkout_sessions_entity_status");
    table.index(["status", "expires_at"], "idx_billing_checkout_sessions_status_expires_at");

    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("idempotency_row_id").references("id").inTable("billing_request_idempotency").onDelete("SET NULL");
  });

  await knex.raw(`
    ALTER TABLE billing_checkout_sessions
    ADD COLUMN active_checkout_block_key BIGINT UNSIGNED
      GENERATED ALWAYS AS (
        CASE
          WHEN status IN ('open', 'completed_pending_subscription', 'recovery_verification_pending')
          THEN billable_entity_id
          ELSE NULL
        END
      ) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_checkout_sessions
    ADD UNIQUE INDEX uq_billing_checkout_sessions_active_checkout_block_key (active_checkout_block_key)
  `);
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS billing_checkout_sessions");
  await knex.raw("DROP TABLE IF EXISTS billing_outbox_jobs");
  await knex.raw("DROP TABLE IF EXISTS billing_subscription_remediations");
  await knex.raw("DROP TABLE IF EXISTS billing_reconciliation_runs");
  await knex.raw("DROP TABLE IF EXISTS billing_request_idempotency");
  await knex.raw("DROP TABLE IF EXISTS billing_webhook_events");
  await knex.raw("DROP TABLE IF EXISTS billing_payments");
  await knex.raw("DROP TABLE IF EXISTS billing_invoices");
  await knex.raw("DROP TABLE IF EXISTS billing_subscription_items");
  await knex.raw("DROP TABLE IF EXISTS billing_subscriptions");
  await knex.raw("DROP TABLE IF EXISTS billing_entitlements");
  await knex.raw("DROP TABLE IF EXISTS billing_plan_prices");
  await knex.raw("DROP TABLE IF EXISTS billing_plans");
  await knex.raw("DROP TABLE IF EXISTS billing_customers");
  await knex.raw("DROP TABLE IF EXISTS billable_entities");
};
