const PLAN_ASSIGNMENT_SOURCES = ["internal", "promo", "manual"];
const PLAN_CHANGE_KINDS = ["downgrade", "promo_fallback"];
const PLAN_CHANGE_STATUSES = ["pending", "canceled", "applied"];

exports.up = async function up(knex) {
  await knex.schema.createTable("billing_plan_assignments", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("plan_id").unsigned().notNullable();
    table.enu("source", PLAN_ASSIGNMENT_SOURCES).notNullable().defaultTo("internal");
    table.dateTime("period_start_at", { precision: 3 }).notNullable();
    table.dateTime("period_end_at", { precision: 3 }).notNullable();
    table.boolean("is_current").notNullable().defaultTo(true);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.index(["billable_entity_id", "period_end_at"], "idx_billing_plan_assignments_entity_period_end");
    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("plan_id").references("id").inTable("billing_plans").onDelete("RESTRICT");
  });

  await knex.raw(`
    ALTER TABLE billing_plan_assignments
    ADD COLUMN current_assignment_key BIGINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN billable_entity_id ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_plan_assignments
    ADD UNIQUE INDEX uq_billing_plan_assignments_current_key (current_assignment_key)
  `);

  await knex.raw(`
    ALTER TABLE billing_plan_assignments
    ADD CONSTRAINT chk_billing_plan_assignments_period_bounds
      CHECK (period_end_at > period_start_at)
  `);

  await knex.schema.createTable("billing_plan_change_schedules", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("from_plan_id").unsigned().nullable();
    table.bigInteger("target_plan_id").unsigned().notNullable();
    table.enu("change_kind", PLAN_CHANGE_KINDS).notNullable().defaultTo("downgrade");
    table.dateTime("effective_at", { precision: 3 }).notNullable();
    table.enu("status", PLAN_CHANGE_STATUSES).notNullable().defaultTo("pending");
    table.bigInteger("requested_by_user_id").unsigned().nullable();
    table.bigInteger("canceled_by_user_id").unsigned().nullable();
    table.dateTime("applied_at", { precision: 3 }).nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.index(["status", "effective_at"], "idx_billing_plan_change_schedules_status_effective");
    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("from_plan_id").references("id").inTable("billing_plans").onDelete("SET NULL");
    table.foreign("target_plan_id").references("id").inTable("billing_plans").onDelete("RESTRICT");
    table.foreign("requested_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.foreign("canceled_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
  });

  await knex.raw(`
    ALTER TABLE billing_plan_change_schedules
    ADD COLUMN pending_schedule_key BIGINT UNSIGNED
      GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN billable_entity_id ELSE NULL END) STORED
  `);

  await knex.raw(`
    ALTER TABLE billing_plan_change_schedules
    ADD UNIQUE INDEX uq_billing_plan_change_schedules_pending_key (pending_schedule_key)
  `);

  await knex.schema.createTable("billing_plan_change_history", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("billable_entity_id").unsigned().notNullable();
    table.bigInteger("from_plan_id").unsigned().nullable();
    table.bigInteger("to_plan_id").unsigned().notNullable();
    table.string("change_kind", 64).notNullable();
    table.dateTime("effective_at", { precision: 3 }).notNullable();
    table.bigInteger("applied_by_user_id").unsigned().nullable();
    table.bigInteger("schedule_id").unsigned().nullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.index(["billable_entity_id", "effective_at"], "idx_billing_plan_change_history_entity_effective");
    table.foreign("billable_entity_id").references("id").inTable("billable_entities").onDelete("RESTRICT");
    table.foreign("from_plan_id").references("id").inTable("billing_plans").onDelete("SET NULL");
    table.foreign("to_plan_id").references("id").inTable("billing_plans").onDelete("RESTRICT");
    table.foreign("applied_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
    table.foreign("schedule_id").references("id").inTable("billing_plan_change_schedules").onDelete("SET NULL");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("billing_plan_change_history");
  await knex.schema.dropTableIfExists("billing_plan_change_schedules");
  await knex.schema.dropTableIfExists("billing_plan_assignments");
};
