const TOP_UPS_TABLE = "payment_top_ups";

// One prepaid top-up: the merchant's and top-up's key, and its state as JSON (its billable subject, amount, status
// and Checkout session), written before the provider hears of it.
async function createTopUps(knex) {
  if (!(await knex.schema.hasTable(TOP_UPS_TABLE))) {
    await knex.schema.createTable(TOP_UPS_TABLE, (table) => {
      table.string("top_up_key", 64).primary();
      table.text("payload", "mediumtext").notNullable();
    });
  }
}

exports.up = async function up(knex) {
  // On MySQL and MariaDB the table takes the collation of the payment tables already there.
  const { migrateInExistingCollation } = await import("@jskit-ai/database-runtime/server/tableCollationMigrations");
  await migrateInExistingCollation(knex, {
    migration: "payments_core_top_ups.cjs",
    up: createTopUps,
    tables: [TOP_UPS_TABLE],
    referenceTables: ["payment_accounts"]
  });
  await createTopUps(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TOP_UPS_TABLE);
};
