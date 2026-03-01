import { resolveDependencyGraph } from "./dependencyGraph.js";
import { resolveCapabilityGraph } from "./capabilityGraph.js";
import { mergeDisabled, moduleSignature } from "./composeUtils.js";

function resolveComposedModules({ modules, mode, context, diagnostics }) {
  const disabledById = new Map();
  let activeModules = modules.slice();
  let capabilityProviders = {};

  while (true) {
    const before = moduleSignature(activeModules);

    const dependencyResult = resolveDependencyGraph({
      modules: activeModules,
      mode,
      context,
      diagnostics
    });
    activeModules = dependencyResult.modules;
    mergeDisabled(disabledById, dependencyResult.disabledModules);

    const capabilityResult = resolveCapabilityGraph({
      modules: activeModules,
      mode,
      diagnostics
    });
    activeModules = capabilityResult.modules;
    capabilityProviders = capabilityResult.capabilityProviders;
    mergeDisabled(disabledById, capabilityResult.disabledModules);

    const after = moduleSignature(activeModules);
    if (before === after) {
      break;
    }
  }

  return {
    modules: activeModules,
    capabilityProviders,
    disabledModules: Array.from(disabledById.values()).sort((left, right) => left.id.localeCompare(right.id))
  };
}

export { resolveComposedModules };
