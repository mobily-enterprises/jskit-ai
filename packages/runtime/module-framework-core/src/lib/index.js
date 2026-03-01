export {
  MODULE_TIERS,
  MODULE_ENABLEMENT_MODES,
  defineModule,
  validateModuleDescriptor,
  validateModuleDescriptors
} from "./descriptor.js";

export { resolveDependencyGraph, satisfiesVersion } from "./dependencyGraph.js";
export { resolveCapabilityGraph } from "./capabilityGraph.js";
export { resolveMounts } from "./mountResolver.js";
export {
  resolveConflicts,
  detectRouteConflicts,
  detectActionConflicts,
  detectTopicConflicts,
  assertUniqueModuleIds
} from "./conflicts.js";
export { composeServerModules } from "./composeServer.js";
export { composeClientModules } from "./composeClient.js";
export { normalizeMode, addDiagnosticForMode } from "./compositionMode.js";
export {
  DIAGNOSTIC_LEVELS,
  createDiagnostic,
  createDiagnosticsCollector,
  throwOnDiagnosticErrors
} from "./diagnostics.js";
export { loadServerAppDropins, loadClientAppDropinsFromModules, mergeClientModuleRegistry } from "./appDropins.js";
