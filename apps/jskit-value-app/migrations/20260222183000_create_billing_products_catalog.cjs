exports.up = async function up(knex) {
  await knex.schema.createTable("billing_products", (table) => {
    table.bigIncrements("id").primary();
    table.string("code", 120).notNullable();
    table.string("name", 160).notNullable();
    table.text("description").nullable();
    table.string("product_kind", 64).notNullable().defaultTo("one_off");
    table.string("provider", 32).notNullable();
    table.string("provider_price_id", 191).notNullable();
    table.string("provider_product_id", 191).nullable();
    table.enu("price_interval", ["day", "week", "month", "year"]).nullable();
    table.integer("price_interval_count").unsigned().nullable();
    table.string("currency", 3).notNullable();
    table.bigInteger("unit_amount_minor").unsigned().notNullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["code"], "uq_billing_products_code");
    table.unique(["provider", "provider_price_id"], "uq_billing_products_provider_price");
    table.index(["is_active", "id"], "idx_billing_products_active_id");
    table.index(["product_kind", "is_active"], "idx_billing_products_kind_active");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("billing_products");
};

