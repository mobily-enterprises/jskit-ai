const REQUIRED_REPOSITORY_METHODS = [
  "listEntitlementDefinitions",
  "findEntitlementDefinitionByCode",
  "findEntitlementDefinitionById",
  "insertEntitlementGrant",
  "insertEntitlementConsumption",
  "findEntitlementBalance",
  "upsertEntitlementBalance",
  "listEntitlementBalancesForSubject",
  "listNextGrantBoundariesForSubjectDefinition"
];

const RECOMPUTE_SUPPORT_METHODS = {
  delegated: ["recomputeEntitlementBalance"],
  computed: ["sumEntitlementGrantAmount", "sumEntitlementConsumptionAmount"]
};

const OPTIONAL_REPOSITORY_METHODS = ["transaction"];

export function validateEntitlementsRepository(repository) {
  const target = repository && typeof repository === "object" ? repository : null;
  const missingMethods = [];

  for (const methodName of REQUIRED_REPOSITORY_METHODS) {
    if (!target || typeof target[methodName] !== "function") {
      missingMethods.push(methodName);
    }
  }

  const supportsDelegatedRecompute =
    target && typeof target[RECOMPUTE_SUPPORT_METHODS.delegated[0]] === "function";

  const supportsComputedRecompute =
    target && RECOMPUTE_SUPPORT_METHODS.computed.every((methodName) => typeof target[methodName] === "function");

  const missingOptionalMethods = OPTIONAL_REPOSITORY_METHODS.filter(
    (methodName) => !target || typeof target[methodName] !== "function"
  );

  return {
    valid: missingMethods.length < 1 && (supportsDelegatedRecompute || supportsComputedRecompute),
    missingMethods,
    missingOptionalMethods,
    supportsDelegatedRecompute,
    supportsComputedRecompute,
    recomputeSupport: supportsDelegatedRecompute
      ? "delegated"
      : supportsComputedRecompute
        ? "computed"
        : "none"
  };
}

export function assertEntitlementsRepository(repository, options = {}) {
  const validation = validateEntitlementsRepository(repository);
  if (validation.valid) {
    return repository;
  }

  const name = String(options.name || "repository").trim() || "repository";
  if (validation.missingMethods.length > 0) {
    throw new Error(`${name}.${validation.missingMethods[0]} must be a function.`);
  }

  throw new Error(
    `${name} must provide either recomputeEntitlementBalance() or both sumEntitlementGrantAmount() and sumEntitlementConsumptionAmount().`
  );
}

export {
  REQUIRED_REPOSITORY_METHODS,
  OPTIONAL_REPOSITORY_METHODS,
  RECOMPUTE_SUPPORT_METHODS
};
