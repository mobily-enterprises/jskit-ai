const STRIPE_PROVIDER = "stripe";
const MONTHLY_INTERVAL = "month";

function formatPlanList(rows) {
  return rows
    .map((row) => `${Number(row.id)}:${String(row.code || "").trim()}`)
    .join(", ");
}

exports.up = async function up(knex) {
  await knex.schema.alterTable("billing_plans", (table) => {
    table.string("checkout_provider", 32).nullable().after("applies_to");
    table.string("checkout_provider_price_id", 191).nullable().after("checkout_provider");
    table.string("checkout_provider_product_id", 191).nullable().after("checkout_provider_price_id");
    table.enu("checkout_interval", ["day", "week", "month", "year"]).nullable().after("checkout_provider_product_id");
    table.integer("checkout_interval_count").unsigned().nullable().after("checkout_interval");
    table.string("checkout_currency", 3).nullable().after("checkout_interval_count");
    table.bigInteger("checkout_unit_amount_minor").unsigned().nullable().after("checkout_currency");
  });

  await knex.raw(`
    UPDATE billing_plans plans
    INNER JOIN (
      SELECT
        prices.plan_id,
        prices.provider,
        prices.provider_price_id,
        prices.provider_product_id,
        prices.interval,
        prices.interval_count,
        prices.currency,
        prices.unit_amount_minor
      FROM billing_plan_prices prices
      INNER JOIN (
        SELECT
          plan_id,
          provider,
          MIN(id) AS selected_price_id
        FROM billing_plan_prices
        WHERE is_active = 1
          AND billing_component = 'base'
          AND usage_type = 'licensed'
          AND provider = '${STRIPE_PROVIDER}'
        GROUP BY plan_id, provider
      ) selected
        ON selected.selected_price_id = prices.id
    ) core
      ON core.plan_id = plans.id
    SET
      plans.checkout_provider = core.provider,
      plans.checkout_provider_price_id = core.provider_price_id,
      plans.checkout_provider_product_id = core.provider_product_id,
      plans.checkout_interval = core.interval,
      plans.checkout_interval_count = core.interval_count,
      plans.checkout_currency = core.currency,
      plans.checkout_unit_amount_minor = core.unit_amount_minor
  `);

  const plansMissingCheckoutPrice = await knex("billing_plans")
    .select(["id", "code"])
    .whereNull("checkout_provider_price_id")
    .orderBy("id", "asc");
  if (plansMissingCheckoutPrice.length > 0) {
    throw new Error(
      `billing_plans core checkout price backfill failed. Missing base licensed stripe price for plans: ${formatPlanList(plansMissingCheckoutPrice)}`
    );
  }

  const plansWithNonMonthlyCheckoutPrice = await knex("billing_plans")
    .select(["id", "code"])
    .whereNot("checkout_interval", MONTHLY_INTERVAL)
    .orWhereNot("checkout_interval_count", 1)
    .orderBy("id", "asc");
  if (plansWithNonMonthlyCheckoutPrice.length > 0) {
    throw new Error(
      `billing_plans core checkout prices must be monthly. Invalid plans: ${formatPlanList(plansWithNonMonthlyCheckoutPrice)}`
    );
  }

  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_provider VARCHAR(32) NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_provider_price_id VARCHAR(191) NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_interval ENUM('day', 'week', 'month', 'year') NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_interval_count INT UNSIGNED NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_currency VARCHAR(3) NOT NULL
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN checkout_unit_amount_minor BIGINT UNSIGNED NOT NULL
  `);

  await knex.schema.alterTable("billing_plans", (table) => {
    table.unique(["checkout_provider", "checkout_provider_price_id"], "uq_billing_plans_checkout_provider_price");
    table.dropColumn("pricing_model");
  });

  await knex.raw(`
    ALTER TABLE billing_plans
    ADD CONSTRAINT chk_billing_plans_checkout_provider
      CHECK (checkout_provider = '${STRIPE_PROVIDER}')
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    ADD CONSTRAINT chk_billing_plans_checkout_interval
      CHECK (checkout_interval = '${MONTHLY_INTERVAL}' AND checkout_interval_count = 1)
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE billing_plans
    DROP CHECK chk_billing_plans_checkout_interval
  `);
  await knex.raw(`
    ALTER TABLE billing_plans
    DROP CHECK chk_billing_plans_checkout_provider
  `);

  await knex.schema.alterTable("billing_plans", (table) => {
    table.enu("pricing_model", ["flat", "per_seat", "usage", "hybrid"]).notNullable().defaultTo("flat").after("applies_to");
    table.dropUnique(["checkout_provider", "checkout_provider_price_id"], "uq_billing_plans_checkout_provider_price");
    table.dropColumn("checkout_unit_amount_minor");
    table.dropColumn("checkout_currency");
    table.dropColumn("checkout_interval_count");
    table.dropColumn("checkout_interval");
    table.dropColumn("checkout_provider_product_id");
    table.dropColumn("checkout_provider_price_id");
    table.dropColumn("checkout_provider");
  });
};
