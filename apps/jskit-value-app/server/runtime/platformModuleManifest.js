import { PLATFORM_REPOSITORY_DEFINITIONS } from "./repositories.js";
import { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS } from "./services.js";
import { PLATFORM_CONTROLLER_DEFINITIONS } from "./controllers.js";

const PLATFORM_RUNTIME_BUNDLE = Object.freeze({
  repositoryDefinitions: PLATFORM_REPOSITORY_DEFINITIONS,
  serviceDefinitions: PLATFORM_SERVICE_DEFINITIONS,
  controllerDefinitions: PLATFORM_CONTROLLER_DEFINITIONS,
  runtimeServiceIds: RUNTIME_SERVICE_EXPORT_IDS
});

export { PLATFORM_RUNTIME_BUNDLE };
