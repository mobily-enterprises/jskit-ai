import { readFileSync } from "node:fs";

const SCHEMA_SQL_TEMPLATE = readFileSync(new URL("./sql/schema.sql", import.meta.url), "utf8");
const INDEXES_SQL_TEMPLATE = readFileSync(new URL("./sql/indexes.sql", import.meta.url), "utf8");

const DEFAULT_TABLE_NAMES = Object.freeze({
  entitlementDefinitions: "billing_entitlement_definitions",
  entitlementGrants: "billing_entitlement_grants",
  entitlementConsumptions: "billing_entitlement_consumptions",
  entitlementBalances: "billing_entitlement_balances"
});

function toNonEmptyString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeTableNames(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    entitlementDefinitions: toNonEmptyString(source.entitlementDefinitions) || DEFAULT_TABLE_NAMES.entitlementDefinitions,
    entitlementGrants: toNonEmptyString(source.entitlementGrants) || DEFAULT_TABLE_NAMES.entitlementGrants,
    entitlementConsumptions:
      toNonEmptyString(source.entitlementConsumptions) || DEFAULT_TABLE_NAMES.entitlementConsumptions,
    entitlementBalances: toNonEmptyString(source.entitlementBalances) || DEFAULT_TABLE_NAMES.entitlementBalances
  };
}

function escapeIdentifier(identifier) {
  return `\`${String(identifier || "").replace(/`/g, "``")}\``;
}

function renderSqlTemplate(template, tableNames) {
  return String(template || "")
    .replaceAll("{{entitlementDefinitions}}", escapeIdentifier(tableNames.entitlementDefinitions))
    .replaceAll("{{entitlementGrants}}", escapeIdentifier(tableNames.entitlementGrants))
    .replaceAll("{{entitlementConsumptions}}", escapeIdentifier(tableNames.entitlementConsumptions))
    .replaceAll("{{entitlementBalances}}", escapeIdentifier(tableNames.entitlementBalances));
}

function resolveKnexClient({ knexFromFactory, knexFromCall }) {
  const knex = knexFromCall || knexFromFactory;
  if (!knex || (typeof knex !== "function" && typeof knex !== "object")) {
    throw new Error("A Knex instance is required. Pass it to createEntitlementMigrations({ knex }) or up(knex).");
  }
  return knex;
}

export function createEntitlementMigrations(options = {}) {
  const tableNames = normalizeTableNames(options.tableNames);
  const schemaSql = renderSqlTemplate(SCHEMA_SQL_TEMPLATE, tableNames);
  const indexesSql = renderSqlTemplate(INDEXES_SQL_TEMPLATE, tableNames);
  const knexFromFactory = options.knex || null;

  async function up(knexFromCall = null) {
    const knex = resolveKnexClient({ knexFromFactory, knexFromCall });
    await knex.raw(schemaSql);
    await knex.raw(indexesSql);
  }

  async function down(knexFromCall = null) {
    const knex = resolveKnexClient({ knexFromFactory, knexFromCall });
    await knex.schema.dropTableIfExists(tableNames.entitlementBalances);
    await knex.schema.dropTableIfExists(tableNames.entitlementConsumptions);
    await knex.schema.dropTableIfExists(tableNames.entitlementGrants);
    await knex.schema.dropTableIfExists(tableNames.entitlementDefinitions);
  }

  return {
    tableNames,
    schemaSql,
    indexesSql,
    up,
    down
  };
}
