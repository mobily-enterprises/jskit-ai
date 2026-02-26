import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function resolveActiveClientModules(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return resolveClientModuleRegistry();
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
  return resolveClientModuleRegistry().filter((entry) => enabledSet.has(entry.id));
}

function composeGuardPolicies({ enabledModuleIds } = {}) {
  const policies = {};

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const guardPolicies =
      moduleEntry?.client?.guardPolicies && typeof moduleEntry.client.guardPolicies === "object"
        ? moduleEntry.client.guardPolicies
        : null;
    if (!guardPolicies) {
      continue;
    }

    for (const [policyId, policy] of Object.entries(guardPolicies)) {
      const normalizedPolicyId = String(policyId || "").trim();
      if (!normalizedPolicyId) {
        continue;
      }

      const normalizedPolicy = policy && typeof policy === "object" ? policy : {};
      if (Object.hasOwn(policies, normalizedPolicyId)) {
        throw new Error(`Duplicate guard policy "${normalizedPolicyId}" in client module registry.`);
      }

      policies[normalizedPolicyId] = Object.freeze({
        ...normalizedPolicy,
        moduleId: moduleEntry.id
      });
    }
  }

  return Object.freeze(policies);
}

export { composeGuardPolicies };
