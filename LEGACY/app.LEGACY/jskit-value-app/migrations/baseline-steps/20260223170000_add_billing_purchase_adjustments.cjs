exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("billing_purchase_adjustments");
  if (hasTable) {
    return;
  }

  await knex.schema.createTable("billing_purchase_adjustments", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("purchase_id").unsigned().notNullable();
    table.string("action_type", 64).notNullable();
    table.string("status", 32).notNullable().defaultTo("recorded");
    table.bigInteger("amount_minor").nullable();
    table.string("currency", 3).nullable();
    table.string("reason_code", 120).nullable();
    table.string("provider_reference", 191).nullable();
    table.bigInteger("requested_by_user_id").unsigned().nullable();
    table.string("request_idempotency_key", 191).notNullable();
    table.json("metadata_json").nullable();
    table.dateTime("created_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));
    table.dateTime("updated_at", { precision: 3 }).notNullable().defaultTo(knex.raw("UTC_TIMESTAMP(3)"));

    table.unique(["request_idempotency_key"], "uq_bpurchase_adj_req_idem");
    table.index(["purchase_id", "created_at"], "idx_bpurchase_adj_purchase_created");
    table.index(["action_type", "status", "created_at"], "idx_bpurchase_adj_type_status_created");

    table.foreign("purchase_id").references("id").inTable("billing_purchases").onDelete("RESTRICT");
    table.foreign("requested_by_user_id").references("id").inTable("user_profiles").onDelete("SET NULL");
  });
};

exports.down = async function down(knex) {
  void knex;
  throw new Error("Migration 20260223170000_add_billing_purchase_adjustments is irreversible.");
};
