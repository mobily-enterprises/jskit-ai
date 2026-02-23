exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists("billing_plan_prices");
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260222150000_drop_billing_plan_prices is irreversible.");
};
