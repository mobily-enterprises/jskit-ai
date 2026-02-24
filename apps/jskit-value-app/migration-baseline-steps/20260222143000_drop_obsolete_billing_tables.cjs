exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists("billing_payments");
  await knex.schema.dropTableIfExists("billing_invoices");
  await knex.schema.dropTableIfExists("billing_subscription_items");
  await knex.schema.dropTableIfExists("billing_usage_events");
  await knex.schema.dropTableIfExists("billing_usage_counters");
  await knex.schema.dropTableIfExists("billing_entitlements");
  await knex.schema.dropTableIfExists("billing_outbox_jobs");
  await knex.schema.dropTableIfExists("billing_subscription_remediations");
  await knex.schema.dropTableIfExists("billing_reconciliation_runs");
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222143000_drop_obsolete_billing_tables is irreversible.");
};
