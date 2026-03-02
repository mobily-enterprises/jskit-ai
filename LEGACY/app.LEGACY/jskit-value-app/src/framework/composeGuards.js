import { composeGuardPoliciesFromModules } from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function composeGuardPolicies({ enabledModuleIds } = {}) {
  return composeGuardPoliciesFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    enabledModuleIds
  });
}

export { composeGuardPolicies };
