import { toNonEmptyString } from "@jskit-ai/billing-core/server";

const DEFAULT_TABLE_NAMES = Object.freeze({
  entitlementDefinitions: "billing_entitlement_definitions",
  entitlementGrants: "billing_entitlement_grants",
  entitlementConsumptions: "billing_entitlement_consumptions",
  entitlementBalances: "billing_entitlement_balances"
});

function normalizeTableNames(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    entitlementDefinitions: toNonEmptyString(source.entitlementDefinitions) || DEFAULT_TABLE_NAMES.entitlementDefinitions,
    entitlementGrants: toNonEmptyString(source.entitlementGrants) || DEFAULT_TABLE_NAMES.entitlementGrants,
    entitlementConsumptions: toNonEmptyString(source.entitlementConsumptions) || DEFAULT_TABLE_NAMES.entitlementConsumptions,
    entitlementBalances: toNonEmptyString(source.entitlementBalances) || DEFAULT_TABLE_NAMES.entitlementBalances
  };
}

export { DEFAULT_TABLE_NAMES, normalizeTableNames };
