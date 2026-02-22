function tableExists(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function checkConstraintExists(knex, tableName, constraintName) {
  const rows = await knex("information_schema.TABLE_CONSTRAINTS")
    .select("CONSTRAINT_NAME")
    .where({
      TABLE_SCHEMA: knex.client.database(),
      TABLE_NAME: tableName,
      CONSTRAINT_NAME: constraintName
    })
    .limit(1);
  return rows.length > 0;
}

async function dropCheckConstraintIfExists(knex, tableName, constraintName) {
  if (!(await checkConstraintExists(knex, tableName, constraintName))) {
    return;
  }

  try {
    await knex.raw(`
      ALTER TABLE ${tableName}
      DROP CONSTRAINT ${constraintName}
    `);
    return;
  } catch (error) {
    const message = String(error?.message || "");
    const syntaxError = message.toLowerCase().includes("syntax");
    if (!syntaxError) {
      throw error;
    }
  }

  await knex.raw(`
    ALTER TABLE ${tableName}
    DROP CHECK ${constraintName}
  `);
}

exports.up = async function up(knex) {
  if (!(await tableExists(knex, "billing_plans"))) {
    throw new Error("Migration requires billing_plans to exist.");
  }
  if (!(await tableExists(knex, "billing_plan_assignments"))) {
    throw new Error("Migration requires billing_plan_assignments to exist.");
  }

  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_provider VARCHAR(32) NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_provider_price_id VARCHAR(191) NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_provider_product_id VARCHAR(191) NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_interval ENUM('day', 'week', 'month', 'year') NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_interval_count INT UNSIGNED NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_currency VARCHAR(3) NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_unit_amount_minor BIGINT UNSIGNED NULL
  `);

  await dropCheckConstraintIfExists(knex, "billing_plan_assignments", "chk_billing_plan_assignments_period_bounds");
  await knex.raw(`
    ALTER TABLE billing_plan_assignments
    MODIFY COLUMN period_end_at DATETIME(3) NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plan_assignments
    ADD CONSTRAINT chk_billing_plan_assignments_period_bounds
      CHECK (period_end_at IS NULL OR period_end_at > period_start_at)
  `);

  if (await tableExists(knex, "billing_plan_assignment_provider_details")) {
    await knex.raw(`
      UPDATE billing_plan_assignments assignments
      INNER JOIN billing_plans plans ON plans.id = assignments.plan_id
      LEFT JOIN billing_plan_assignment_provider_details provider_details
        ON provider_details.billing_plan_assignment_id = assignments.id
      SET assignments.period_end_at = NULL,
          assignments.updated_at = UTC_TIMESTAMP(3)
      WHERE assignments.status IN ('current', 'upcoming')
        AND provider_details.billing_plan_assignment_id IS NULL
        AND plans.checkout_provider_price_id IS NULL
        AND assignments.period_end_at IS NOT NULL
    `);
  } else {
    await knex.raw(`
      UPDATE billing_plan_assignments assignments
      INNER JOIN billing_plans plans ON plans.id = assignments.plan_id
      SET assignments.period_end_at = NULL,
          assignments.updated_at = UTC_TIMESTAMP(3)
      WHERE assignments.status IN ('current', 'upcoming')
        AND plans.checkout_provider_price_id IS NULL
        AND assignments.period_end_at IS NOT NULL
    `);
  }
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222201000_allow_free_plans_and_indefinite_assignments is irreversible.");
};
