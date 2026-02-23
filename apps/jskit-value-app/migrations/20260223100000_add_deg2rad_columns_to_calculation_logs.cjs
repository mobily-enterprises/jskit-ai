exports.up = async function up(knex) {
  await knex.schema.alterTable("calculation_logs", (table) => {
    table.string("deg2rad_operation", 16).nullable();
    table.string("deg2rad_formula", 120).nullable();
    table.decimal("deg2rad_degrees", 20, 12).nullable();
    table.decimal("deg2rad_radians", 36, 12).nullable();
  });

  await knex("calculation_logs").update({
    deg2rad_operation: knex.raw("COALESCE(deg2rad_operation, 'DEG2RAD')"),
    deg2rad_formula: knex.raw("COALESCE(deg2rad_formula, 'DEG2RAD(x) = x * PI / 180')"),
    deg2rad_degrees: knex.raw("COALESCE(deg2rad_degrees, payment)"),
    deg2rad_radians: knex.raw("COALESCE(deg2rad_radians, value)")
  });

  await knex.schema.alterTable("calculation_logs", (table) => {
    table.string("deg2rad_operation", 16).notNullable().alter();
    table.string("deg2rad_formula", 120).notNullable().alter();
    table.decimal("deg2rad_degrees", 20, 12).notNullable().alter();
    table.decimal("deg2rad_radians", 36, 12).notNullable().alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("calculation_logs", (table) => {
    table.dropColumn("deg2rad_radians");
    table.dropColumn("deg2rad_degrees");
    table.dropColumn("deg2rad_formula");
    table.dropColumn("deg2rad_operation");
  });
};
