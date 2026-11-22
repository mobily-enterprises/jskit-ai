import initial from "../../migrations/payments_core_initial.cjs";
import topUps from "../../migrations/payments_core_top_ups.cjs";

/**
 * Runs the package's migrations in the order Knex sorts them: the payment tables, then the top-ups table.
 * @param {import("knex").Knex} knex
 */
export async function migratePayments(knex) {
  await initial.up(knex);
  await topUps.up(knex);
}
