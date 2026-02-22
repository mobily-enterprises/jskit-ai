async function requireBillingPlansTable(knex) {
  const hasTable = await knex.schema.hasTable("billing_plans");
  if (!hasTable) {
    throw new Error("Migration requires billing_plans to exist.");
  }
}

function hasNonNullCheckoutMapping(row) {
  if (!row || typeof row !== "object") {
    return false;
  }

  return [
    row.checkout_provider,
    row.checkout_provider_price_id,
    row.checkout_provider_product_id,
    row.checkout_interval,
    row.checkout_interval_count,
    row.checkout_currency,
    row.checkout_unit_amount_minor
  ].some((value) => value != null);
}

exports.up = async function up(knex) {
  await requireBillingPlansTable(knex);

  const existing = await knex("billing_plans").where({ code: "free" }).first();
  if (!existing) {
    await knex("billing_plans").insert({
      code: "free",
      name: "Free",
      description: "Free plan",
      applies_to: "workspace",
      checkout_provider: null,
      checkout_provider_price_id: null,
      checkout_provider_product_id: null,
      checkout_interval: null,
      checkout_interval_count: null,
      checkout_currency: null,
      checkout_unit_amount_minor: null,
      is_active: 1,
      metadata_json: JSON.stringify({
        seededByMigration: "20260222213000_ensure_free_billing_plan"
      }),
      created_at: knex.raw("UTC_TIMESTAMP(3)"),
      updated_at: knex.raw("UTC_TIMESTAMP(3)")
    });
    return;
  }

  if (hasNonNullCheckoutMapping(existing)) {
    throw new Error(
      "billing_plans code='free' exists but has provider checkout mapping. Free plan must not be mapped to Stripe pricing."
    );
  }

  if (existing.is_active !== 1) {
    await knex("billing_plans").where({ id: existing.id }).update({
      is_active: 1,
      updated_at: knex.raw("UTC_TIMESTAMP(3)")
    });
  }
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222213000_ensure_free_billing_plan is irreversible.");
};
