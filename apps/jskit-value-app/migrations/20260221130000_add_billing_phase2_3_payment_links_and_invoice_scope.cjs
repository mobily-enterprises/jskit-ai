exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE billing_request_idempotency
    MODIFY COLUMN action ENUM('checkout', 'portal', 'payment_link') NOT NULL
  `);

  await knex.schema.alterTable("billing_invoices", (table) => {
    table.bigInteger("billable_entity_id").unsigned().nullable().after("subscription_id");
    table.bigInteger("billing_customer_id").unsigned().nullable().after("billable_entity_id");
  });

  await knex.raw(`
    UPDATE billing_invoices bi
    INNER JOIN billing_subscriptions bs
      ON bs.id = bi.subscription_id
     AND bs.provider = bi.provider
    SET
      bi.billable_entity_id = bs.billable_entity_id,
      bi.billing_customer_id = bs.billing_customer_id
    WHERE bi.billable_entity_id IS NULL
       OR bi.billing_customer_id IS NULL
  `);

  await knex.raw(`
    ALTER TABLE billing_invoices
    MODIFY COLUMN subscription_id BIGINT UNSIGNED NULL
  `);

  await knex.raw(`
    ALTER TABLE billing_invoices
    MODIFY COLUMN billable_entity_id BIGINT UNSIGNED NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE billing_invoices
    MODIFY COLUMN billing_customer_id BIGINT UNSIGNED NOT NULL
  `);

  await knex.schema.alterTable("billing_invoices", (table) => {
    table.index(["billable_entity_id", "updated_at"], "idx_billing_invoices_entity_updated");
    table.index(["billing_customer_id", "provider"], "idx_billing_invoices_customer_provider");

    table
      .foreign("billable_entity_id", "fk_billing_invoices_billable_entity")
      .references("id")
      .inTable("billable_entities")
      .onDelete("RESTRICT");

    table
      .foreign(
        ["billing_customer_id", "billable_entity_id", "provider"],
        "fk_billing_invoices_customer_entity_provider"
      )
      .references(["id", "billable_entity_id", "provider"])
      .inTable("billing_customers")
      .onDelete("RESTRICT");
  });
};

exports.down = async function down(knex) {
  await knex("billing_payments")
    .whereIn(
      "invoice_id",
      knex("billing_invoices")
        .whereNull("subscription_id")
        .select("id")
    )
    .delete();

  await knex("billing_invoices").whereNull("subscription_id").delete();

  await knex.schema.alterTable("billing_invoices", (table) => {
    table.dropForeign(
      ["billing_customer_id", "billable_entity_id", "provider"],
      "fk_billing_invoices_customer_entity_provider"
    );
    table.dropForeign("billable_entity_id", "fk_billing_invoices_billable_entity");
    table.dropIndex(["billable_entity_id", "updated_at"], "idx_billing_invoices_entity_updated");
    table.dropIndex(["billing_customer_id", "provider"], "idx_billing_invoices_customer_provider");
  });

  await knex.raw(`
    ALTER TABLE billing_invoices
    MODIFY COLUMN subscription_id BIGINT UNSIGNED NOT NULL
  `);

  await knex.schema.alterTable("billing_invoices", (table) => {
    table.dropColumn("billing_customer_id");
    table.dropColumn("billable_entity_id");
  });

  await knex("billing_request_idempotency").where({ action: "payment_link" }).delete();

  await knex.raw(`
    ALTER TABLE billing_request_idempotency
    MODIFY COLUMN action ENUM('checkout', 'portal') NOT NULL
  `);
};
