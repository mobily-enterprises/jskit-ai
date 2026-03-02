import {
  composeRealtimeTopicContributionsFromModules,
  composeRealtimeInvalidationDefinitionsFromModules
} from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function composeRealtimeTopicContributions({ enabledModuleIds } = {}) {
  return composeRealtimeTopicContributionsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    enabledModuleIds
  });
}

function composeRealtimeInvalidationDefinitions({ enabledModuleIds } = {}) {
  return composeRealtimeInvalidationDefinitionsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    enabledModuleIds
  });
}

export { composeRealtimeTopicContributions, composeRealtimeInvalidationDefinitions };
