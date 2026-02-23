const LIFETIME_WINDOW_START = "1970-01-01 00:00:00.000";
const LIFETIME_WINDOW_END = "9999-12-31 23:59:59.999";

exports.up = async function up(knex) {
  await knex.schema.createTable("billing_entitlement_definitions", (table) => {
    table.bigIncrements("id").primary();
    table.string("code", 120).notNullable();
    table.string("name", 191).notNullable();
    table.text("description").nullable();
    table
      .enu("entitlement_type", ["capacity", "metered_quota", "balance", "state"])
      .notNullable();
    table.string("unit", 64).notNullable();
    table.enu("window_interval", ["day", "week", "month", "year"]).nullable();
    table.enu("window_anchor", ["calendar_utc", "rolling"]).nullable();
    table
      .enu("aggregation_mode", ["sum", "max", "boolean_any_true"])
      .notNullable()
      .defaultTo("sum");
    table
      .enu("enforcement_mode", ["hard_deny", "hard_lock_resource", "soft_warn"])
      .notNullable()
      .defaultTo("hard_deny");
    table
      .enu("scope_type", ["billable_entity", "workspace", "user"])
      .notNullable()
      .defaultTo("billable_entity");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["code"], "uq_bed_code");
    table.index(["entitlement_type", "is_active"], "idx_bed_type_active");
  });

  await knex.raw(`
    ALTER TABLE billing_entitlement_definitions
    ADD CONSTRAINT chk_bed_metered_window
    CHECK (
      entitlement_type <> 'metered_quota'
      OR (window_interval IS NOT NULL AND window_anchor IS NOT NULL)
    )
  `);
  await knex.raw(`
    ALTER TABLE billing_entitlement_definitions
    ADD CONSTRAINT chk_bed_nonwindow_types
    CHECK (
      entitlement_type = 'metered_quota'
      OR (window_interval IS NULL AND window_anchor IS NULL)
    )
  `);

  await knex.schema.createTable("billing_plan_entitlement_templates", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("plan_id").unsigned().notNullable();
    table.bigInteger("entitlement_definition_id").unsigned().notNullable();
    table.bigInteger("amount").unsigned().notNullable();
    table.enu("grant_kind", ["plan_base", "plan_bonus"]).notNullable().defaultTo("plan_base");
    table
      .enu("effective_policy", ["on_assignment_current", "on_period_paid"])
      .notNullable()
      .defaultTo("on_assignment_current");
    table
      .enu("duration_policy", ["while_current", "period_window", "fixed_duration"])
      .notNullable()
      .defaultTo("while_current");
    table.integer("duration_days").unsigned().nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["plan_id", "entitlement_definition_id", "grant_kind"], "uq_bpet_plan_def_kind");
    table.index(["plan_id"], "idx_bpet_plan");
    table.index(["entitlement_definition_id"], "idx_bpet_def");

    table
      .foreign("plan_id", "fk_bpet_plan")
      .references("id")
      .inTable("billing_plans")
      .onDelete("CASCADE");
    table
      .foreign("entitlement_definition_id", "fk_bpet_def")
      .references("id")
      .inTable("billing_entitlement_definitions")
      .onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_plan_entitlement_templates
    ADD CONSTRAINT chk_bpet_duration_days
    CHECK (
      (duration_policy IN ('while_current', 'period_window') AND duration_days IS NULL)
      OR (duration_policy = 'fixed_duration' AND duration_days IS NOT NULL AND duration_days > 0)
    )
  `);

  await knex.schema.createTable("billing_product_entitlement_templates", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billing_product_id").unsigned().notNullable();
    table.bigInteger("entitlement_definition_id").unsigned().notNullable();
    table.bigInteger("amount").unsigned().notNullable();
    table.enu("grant_kind", ["one_off_topup", "timeboxed_addon"]).notNullable();
    table.integer("duration_days").unsigned().nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["billing_product_id", "entitlement_definition_id", "grant_kind"],
      "uq_bpret_product_def_kind"
    );
    table.index(["billing_product_id"], "idx_bpret_product");
    table.index(["entitlement_definition_id"], "idx_bpret_def");

    table
      .foreign("billing_product_id", "fk_bpret_product")
      .references("id")
      .inTable("billing_products")
      .onDelete("CASCADE");
    table
      .foreign("entitlement_definition_id", "fk_bpret_def")
      .references("id")
      .inTable("billing_entitlement_definitions")
      .onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_product_entitlement_templates
    ADD CONSTRAINT chk_bpret_duration_days
    CHECK (
      (grant_kind = 'one_off_topup' AND duration_days IS NULL)
      OR (grant_kind = 'timeboxed_addon' AND duration_days IS NOT NULL AND duration_days > 0)
    )
  `);

  await knex.schema.createTable("billing_entitlement_grants", (table) => {
    table.bigIncrements("id").primary();
    table.enu("subject_type", ["billable_entity"]).notNullable().defaultTo("billable_entity");
    table.bigInteger("subject_id").unsigned().notNullable();
    table.bigInteger("entitlement_definition_id").unsigned().notNullable();
    table.bigInteger("amount").notNullable();
    table
      .enu("kind", ["plan_base", "addon_timeboxed", "topup", "promo", "manual_adjustment", "correction"])
      .notNullable();
    table.dateTime("effective_at", { precision: 3 }).notNullable();
    table.dateTime("expires_at", { precision: 3 }).nullable();
    table
      .enu("source_type", ["plan_assignment", "billing_purchase", "billing_event", "manual_console", "system_worker"])
      .notNullable();
    table.bigInteger("source_id").unsigned().nullable();
    table.string("operation_key", 191).nullable();
    table.string("provider", 32).nullable();
    table.string("provider_event_id", 191).nullable();
    table.string("dedupe_key", 191).notNullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["dedupe_key"], "uq_beg_dedupe");
    table.index(
      ["subject_type", "subject_id", "entitlement_definition_id", "effective_at"],
      "idx_beg_subject_def_effective"
    );
    table.index(["subject_type", "subject_id", "expires_at"], "idx_beg_subject_expires");
    table.index(["source_type", "source_id"], "idx_beg_source");

    table
      .foreign("entitlement_definition_id", "fk_beg_def")
      .references("id")
      .inTable("billing_entitlement_definitions")
      .onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_entitlement_grants
    ADD CONSTRAINT chk_beg_expires_after_effective
    CHECK (expires_at IS NULL OR expires_at > effective_at)
  `);

  await knex.schema.createTable("billing_entitlement_consumptions", (table) => {
    table.bigIncrements("id").primary();
    table.enu("subject_type", ["billable_entity"]).notNullable().defaultTo("billable_entity");
    table.bigInteger("subject_id").unsigned().notNullable();
    table.bigInteger("entitlement_definition_id").unsigned().notNullable();
    table.bigInteger("amount").unsigned().notNullable();
    table.dateTime("occurred_at", { precision: 3 }).notNullable();
    table.string("reason_code", 120).notNullable();
    table.string("operation_key", 191).nullable();
    table.string("usage_event_key", 191).nullable();
    table.string("provider_event_id", 191).nullable();
    table.string("request_id", 128).nullable();
    table.string("dedupe_key", 191).notNullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["dedupe_key"], "uq_bec_dedupe");
    table.index(
      ["subject_type", "subject_id", "entitlement_definition_id", "occurred_at"],
      "idx_bec_subject_def_occurred"
    );
    table.index(["usage_event_key"], "idx_bec_usage_event");

    table
      .foreign("entitlement_definition_id", "fk_bec_def")
      .references("id")
      .inTable("billing_entitlement_definitions")
      .onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_entitlement_balances", (table) => {
    table.bigIncrements("id").primary();
    table.enu("subject_type", ["billable_entity"]).notNullable().defaultTo("billable_entity");
    table.bigInteger("subject_id").unsigned().notNullable();
    table.bigInteger("entitlement_definition_id").unsigned().notNullable();
    table.dateTime("window_start_at", { precision: 3 }).notNullable().defaultTo(LIFETIME_WINDOW_START);
    table.dateTime("window_end_at", { precision: 3 }).notNullable().defaultTo(LIFETIME_WINDOW_END);
    table.bigInteger("granted_amount").notNullable().defaultTo(0);
    table.bigInteger("consumed_amount").notNullable().defaultTo(0);
    table.bigInteger("effective_amount").notNullable().defaultTo(0);
    table.bigInteger("hard_limit_amount").nullable();
    table.boolean("over_limit").notNullable().defaultTo(false);
    table.enu("lock_state", ["none", "projects_locked_over_cap", "workspace_expired"]).nullable();
    table.dateTime("next_change_at", { precision: 3 }).nullable();
    table.dateTime("last_recomputed_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.bigInteger("version").unsigned().notNullable().defaultTo(0);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(
      ["subject_type", "subject_id", "entitlement_definition_id", "window_start_at", "window_end_at"],
      "uq_beb_subject_def_window"
    );
    table.index(["next_change_at"], "idx_beb_next_change");
    table.index(["subject_type", "subject_id", "entitlement_definition_id"], "idx_beb_subject_def");

    table
      .foreign("entitlement_definition_id", "fk_beb_def")
      .references("id")
      .inTable("billing_entitlement_definitions")
      .onDelete("RESTRICT");
  });

  await knex.schema.createTable("billing_resource_snapshots", (table) => {
    table.bigIncrements("id").primary();
    table.enu("subject_type", ["billable_entity"]).notNullable().defaultTo("billable_entity");
    table.bigInteger("subject_id").unsigned().notNullable();
    table.string("resource_code", 120).notNullable();
    table.bigInteger("resource_count").unsigned().notNullable().defaultTo(0);
    table.dateTime("snapshot_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.enu("source", ["event_driven", "repair_recount"]).notNullable().defaultTo("event_driven");
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["subject_type", "subject_id", "resource_code"], "uq_brs_subject_resource");
    table.index(["resource_code"], "idx_brs_resource");
  });
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222230000_create_billing_entitlements_engine_tables is irreversible.");
};
