exports.up = async function up(knex) {
  await knex.schema.alterTable("billing_plans", (table) => {
    table.dropUnique(["plan_family_code", "version"], "uq_billing_plans_family_version");
  });

  await knex.schema.alterTable("billing_plans", (table) => {
    table.dropColumn("plan_family_code");
    table.dropColumn("version");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("billing_plans", (table) => {
    table.string("plan_family_code", 120).nullable().after("code");
    table.integer("version").unsigned().nullable().after("plan_family_code");
  });

  await knex.raw(`
    UPDATE billing_plans
    SET plan_family_code = code
  `);

  await knex.raw(`
    UPDATE billing_plans
    SET version = 1
  `);

  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN plan_family_code VARCHAR(120) NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE billing_plans
    MODIFY COLUMN version INT UNSIGNED NOT NULL
  `);

  await knex.schema.alterTable("billing_plans", (table) => {
    table.unique(["plan_family_code", "version"], "uq_billing_plans_family_version");
  });
};
